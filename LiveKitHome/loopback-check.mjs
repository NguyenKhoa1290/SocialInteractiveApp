// Linux CI: real LiveKit and two browser clients, without contacting Pinggy.
import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const image = 'livekit/livekit-server:v1.9.12@sha256:2c13cbf2edcbf13ea7b20d05c10b394d04d8fb3fe358269cff845a90b4de9576';
const name = `callimeet-loopback-check-${process.pid}`;
const dir = await mkdtemp(join(tmpdir(), 'callimeet-loopback-'));
const key = 'loopback-check';
const secret = 'loopback-check-only-not-a-production-secret';
const now = Math.floor(Date.now() / 1000);
const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = (sub) => {
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ iss: key, sub, nbf: now - 5, exp: now + 180, video: { roomJoin: true, room: name, canPublish: true, canSubscribe: true } })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
try {
  execFileSync('docker', ['run', '-d', '--name', name, '--network', 'host',
    '-v', `${resolve('livekit.template.yaml')}:/etc/livekit.yaml:ro`,
    '-e', `LIVEKIT_KEYS=${key}: ${secret}`, image, '--config', '/etc/livekit.yaml'], { stdio: 'pipe' });
  let available = false;
  for (let i = 0; i < 30; i++) {
    try { await fetch('http://127.0.0.1:7880', { signal: AbortSignal.timeout(1000) }); available = true; break; }
    catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!available) throw new Error('Diagnostic LiveKit did not start');
  const config = join(dir, 'probe.json');
  await writeFile(config, JSON.stringify({ url: 'ws://127.0.0.1:7880', tokens: [token('a'), token('b')] }), { mode: 0o600 });
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['connectivity-check.mjs', config], { stdio: 'inherit' });
    child.on('error', reject); child.on('exit', done);
  });
  if (code !== 0) throw new Error('Loopback audio/video check failed');
} finally {
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' }); } catch { /* not started */ }
  await rm(dir, { recursive: true, force: true });
}
