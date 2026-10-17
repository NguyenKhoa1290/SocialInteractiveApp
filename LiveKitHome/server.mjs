import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { mapSignal, reconnectSignal } from './candidates.mjs';
import { defaultRoute, RecoveryState } from './network.mjs';

const execute = promisify(execFile);
const cli = process.env.PINGGY_BIN || '/app/node_modules/.bin/pinggy';
const rotationMs = Number(process.env.ROTATION_SECONDS || 3000) * 1000;
if (!Number.isFinite(rotationMs) || rotationMs < 30_000 || rotationMs > 3_300_000) {
  throw new Error('ROTATION_SECONDS must be between 30 and 3300');
}
const upstream = 'http://127.0.0.1:7880';
const mediaHost = process.env.SFU_MEDIA_HOST || '127.0.0.1';
const clients = new Set();
let endpoints = null;
let stopping = false;
const owned = new Set();
const retiring = new Map();
const retiredNames = new Set();
const recovery = new RecoveryState();
let commandQueue = Promise.resolve();

function run(...args) {
  // Retirement timers can overlap recovery. Serialize config-store writes.
  const command = commandQueue.then(async () => {
    const { stdout, stderr } = await execute(cli, args, { timeout: 90_000, maxBuffer: 1_048_576 });
    return (stdout + '\n' + stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  });
  commandQueue = command.catch(() => {});
  return command;
}

async function stopTunnel(name) {
  try { await run('stop', name); } catch { /* daemon may have already stopped */ }
  try { await run('config', 'delete', name); } catch { /* best effort */ }
  owned.delete(name);
}

async function openTunnel(type, port, generation) {
  const name = `callimeet-${generation}-${type}`;
  owned.add(name);
  await run('config', 'save', name, '--type', type, '-l', `${mediaHost}:${port}`, '-a');
  const output = await run('start', name, '--b');
  const match = output.match(new RegExp(`${type}:\\/\\/([a-zA-Z0-9.-]+):(\\d+)`));
  if (!match) throw new Error(`Pinggy did not provide a ${type} endpoint`);
  const { address } = await lookup(match[1], { family: 4 });
  const id = output.match(/ID:\s*([a-f0-9-]+)/i)?.[1];
  if (!id) throw new Error('Pinggy did not provide a tunnel ID');
  return { name, id, host: match[1], address, port: Number(match[2]) };
}

async function rotate() {
  const generation = Date.now().toString(36);
  // Sequential startup avoids races in the CLI config store and daemon.
  const udp = await openTunnel('udp', 7882, generation);
  let tcp;
  try { tcp = await openTunnel('tcp', 7881, generation); }
  catch (error) { await stopTunnel(udp.name); throw error; }
  if (stopping) { await stopTunnel(udp.name); await stopTunnel(tcp.name); return; }
  if (await defaultRoute() !== recovery.observed) {
    await stopTunnel(udp.name); await stopTunnel(tcp.name);
    throw Object.assign(new Error('Route changed during startup'), { code: 'ROUTE_CHANGED' });
  }
  const previous = endpoints;
  endpoints = { udp, tcp };
  recovery.recovered();
  console.log(`Media tunnels ready (${generation}); ${clients.size} signaling connections`);
  if (previous) {
    retiredNames.add(previous.udp.name);
    retiredNames.add(previous.tcp.name);
    // Tell SDKs to republish to the same SFU using fresh ICE endpoints. Keep
    // the old tunnels for another minute so in-flight media is not cut first.
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(reconnectSignal(client.signalBinary ?? true), { binary: client.signalBinary ?? true });
      }
    }
    const timer = setTimeout(async () => {
      await stopTunnel(previous.udp.name);
      await stopTunnel(previous.tcp.name);
      retiredNames.delete(previous.udp.name);
      retiredNames.delete(previous.tcp.name);
      retiring.delete(generation);
    }, 60_000);
    retiring.set(generation, timer);
  }
}

function rtcPath(url) {
  return url.replace(/^\/livekit(?=\/|\?|$)/, '') || '/';
}

const server = http.createServer((req, res) => {
  const path = rtcPath(req.url || '/');
  if (path === '/live') { res.writeHead(200); res.end('ok'); return; }
  if (path === '/health') {
    res.writeHead(recovery.ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ready: recovery.ready }));
    return;
  }
  if (!recovery.ready || !/^\/rtc(?:[/?]|$)/.test(path)) {
    res.writeHead(recovery.ready ? 404 : 503); res.end(); return;
  }
  const headers = { ...req.headers, host: '127.0.0.1:7880' };
  const proxy = http.request(upstream + path, { method: req.method, headers }, (response) => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('aborted', () => proxy.destroy());
  req.pipe(proxy);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const path = rtcPath(req.url || '/');
  if (!recovery.ready || !/^\/rtc(?:[/?]|$)/.test(path)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (client) => {
    const remote = new WebSocket(`ws://127.0.0.1:7880${path}`, { handshakeTimeout: 15_000, maxPayload: 10 * 1024 * 1024 });
    clients.add(client);
    let pending = [];
    let pendingBytes = 0;
    client.on('message', (data, binary) => {
      if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary });
      else if (remote.readyState === WebSocket.CONNECTING && pendingBytes + data.length <= 1_048_576) {
        pending.push([data, binary]); pendingBytes += data.length;
      } else client.close(1013);
    });
    remote.on('open', () => {
      for (const [data, binary] of pending) remote.send(data, { binary });
      pending = []; pendingBytes = 0;
    });
    remote.on('message', (data, binary) => {
      if (client.readyState !== WebSocket.OPEN) return;
      client.signalBinary = binary;
      try { client.send(mapSignal(data, binary, endpoints), { binary }); }
      catch { client.close(1011); } // fail closed rather than advertise stale/private ICE
    });
    const close = () => { clients.delete(client); remote.terminate(); };
    client.on('close', close);
    client.on('error', close);
    remote.on('close', () => { clients.delete(client); client.close(1012); });
    remote.on('error', () => { clients.delete(client); client.close(1011); });
    // Detect half-open signaling after a route change without waiting for TCP
    // keepalive. LiveKit SDK resumes/reconnects after a terminated WebSocket.
    client.alive = true;
    client.on('pong', () => { client.alive = true; });
  });
});

server.listen(7883, '127.0.0.1');
const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (!client.alive) { client.terminate(); continue; }
    client.alive = false;
    client.ping();
  }
}, 10_000);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  server.close();
  for (const timer of retiring.values()) clearTimeout(timer);
  for (const client of clients) client.terminate();
  await Promise.allSettled([...owned].map(stopTunnel));
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let rotatedAt = 0;
let checkedAt = 0;
let running = false;
while (!stopping) {
  try {
    const stable = recovery.observe(await defaultRoute());
    if (!stable) { await delay(5000); continue; }
    if (endpoints && Date.now() - checkedAt >= 15_000) {
      const rows = (await run('ps')).split('\n');
      running = [endpoints.udp, endpoints.tcp].every((tunnel) =>
        rows.some((row) => row.trimStart().startsWith(tunnel.id.slice(0, 12)) && /\brunning\b/.test(row)));
      checkedAt = Date.now();
      if (!running) recovery.ready = false;
    }
    if (recovery.needsRotation(Date.now(), running, rotatedAt + rotationMs)) {
      console.log('Refreshing media tunnels after startup, expiry, failure or route change');
      await rotate();
      // Startup may take long enough for the route to change again. Never
      // declare an old-route generation healthy in that case.
      if (await defaultRoute() !== recovery.observed) { running = false; continue; }
      rotatedAt = Date.now(); running = true; checkedAt = 0;
      recovery.recovered();
    }
    await delay(5000);
  }
  catch (error) {
    // No command output/URLs containing authentication are logged.
    recovery.failed(Date.now());
    console.error(`Unable to open media tunnels (${error.code || error.name}); retrying with backoff`);
    // Clean up incomplete generations, retaining the current usable pair.
    const activeNames = new Set(endpoints ? [endpoints.udp.name, endpoints.tcp.name] : []);
    for (const name of [...owned]) {
      if (!activeNames.has(name) && !retiredNames.has(name)) await stopTunnel(name);
    }
    await delay(5000);
  }
}
