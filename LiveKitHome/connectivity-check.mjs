// Optional end-to-end check. Config contains short-lived tokens, never API
// secrets: {url, tokens: [jwtA, jwtB]}. Keep it outside the repository.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_MODULE_PATH || import.meta.url);
const { chromium } = require('playwright');
const config = JSON.parse((await fs.readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
const sdk = await fs.readFile(fileURLToPath(new URL('../Frontend/node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url)));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': req.url === '/sdk.js' ? 'text/javascript' : 'text/html' });
  res.end(req.url === '/sdk.js' ? sdk : '<!doctype html><script src="/sdk.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const pages = await Promise.all(config.tokens.map(async (token) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async ({ url, token }) => {
      window.peers = [];
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) {
          super(...args); window.peers.push(this);
          this.probeStats = [];
          const timer = setInterval(async () => {
            if (this.connectionState === 'closed') { clearInterval(timer); return; }
            const entries = [];
            (await this.getStats()).forEach((s) => {
              if (s.type === 'remote-candidate' || s.type === 'candidate-pair') entries.push({
                type: s.type, address: s.address, port: s.port, protocol: s.protocol,
                state: s.state, requestsSent: s.requestsSent, responsesReceived: s.responsesReceived,
              });
            });
            this.probeStats = entries;
          }, 500);
        }
      };
      const { Room, RoomEvent, LocalAudioTrack, LocalVideoTrack } = window.LivekitClient;
      window.room = new Room({ adaptiveStream: false, dynacast: false });
      window.events = [];
      for (const event of [RoomEvent.Reconnecting, RoomEvent.Reconnected, RoomEvent.Disconnected]) {
        room.on(event, () => events.push({ event, time: Date.now() }));
      }
      room.on(RoomEvent.TrackSubscribed, (track) => { const el = track.attach(); document.body.append(el); });
      try { await room.connect(url, token); }
      catch {
        const diagnostics = await Promise.all(peers.map(async (pc) => {
          const entries = [];
          try { (await pc.getStats()).forEach((s) => {
            if (s.type === 'remote-candidate' || s.type === 'candidate-pair') {
              entries.push({ type: s.type, address: s.address, port: s.port, protocol: s.protocol, state: s.state, requestsSent: s.requestsSent, responsesReceived: s.responsesReceived });
            }
          }); } catch { /* already closed */ }
          return { state: pc.connectionState, ice: pc.iceConnectionState, entries: entries.length ? entries : pc.probeStats };
        }));
        throw new Error('Peer connection failed: ' + JSON.stringify(diagnostics));
      }
      window.audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); await audio.resume();
      await room.localParticipant.publishTrack(new LocalAudioTrack(destination.stream.getAudioTracks()[0]));
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      window.paintTimer = setInterval(() => { ctx.fillStyle = `hsl(${Date.now() % 360},70%,50%)`; ctx.fillRect(0, 0, 320, 180); }, 100);
      await room.localParticipant.publishTrack(new LocalVideoTrack(canvas.captureStream(10).getVideoTracks()[0]));
      window.readStats = async () => {
        let audioBytes = 0, videoBytes = 0;
        const pairs = [];
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (!pub.track) continue;
            const stats = await pub.track.getRTCStatsReport();
            stats?.forEach((s) => {
              if (s.type === 'inbound-rtp') {
                if (s.kind === 'audio') audioBytes += s.bytesReceived || 0;
                if (s.kind === 'video') videoBytes += s.bytesReceived || 0;
              }
              if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
                const remote = stats.get(s.remoteCandidateId);
                pairs.push({ address: remote?.address, port: remote?.port, protocol: remote?.protocol });
              }
            });
          }
        }
        return { state: room.state, remotes: room.remoteParticipants.size, audioBytes, videoBytes, pairs, events };
      };
    }, { url: config.url, token });
    return page;
  }));
  const deadline = Date.now() + Number(process.env.CHECK_SECONDS || 30) * 1000;
  let results;
  do {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    results = await Promise.all(pages.map((p) => p.evaluate(() => window.readStats())));
    if (results.every((r) => r.audioBytes > 0 && r.videoBytes > 0)) break;
  } while (Date.now() < deadline);
  console.log(JSON.stringify(results, null, 2));
  assert(results.every((r) => r.state === 'connected' && r.remotes === 1 && r.audioBytes > 0 && r.videoBytes > 0), 'Both clients must receive audio and video');
  const watch = Number(process.env.WATCH_ROTATION_SECONDS || 0);
  if (watch) {
    const until = Date.now() + watch * 1000;
    while (Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 1000));
    results = await Promise.all(pages.map((p) => p.evaluate(() => window.readStats())));
    console.log('After rotation:', JSON.stringify(results, null, 2));
    assert(results.every((r) => r.state === 'connected' && r.events.some((e) => e.event === 'reconnected') && r.audioBytes > 0 && r.videoBytes > 0), 'Both clients must reconnect with media');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const continuing = await Promise.all(pages.map((p) => p.evaluate(() => window.readStats())));
    assert(continuing.every((r, i) => r.audioBytes > results[i].audioBytes && r.videoBytes > results[i].videoBytes), 'Media must continue increasing after reconnect');
    for (const [i, r] of results.entries()) {
      const start = r.events.find((e) => e.event === 'reconnecting');
      const end = r.events.find((e) => e.event === 'reconnected' && e.time >= start?.time);
      console.log(`Client ${i + 1}: reconnect ${end.time - start.time} ms`);
    }
  }
} finally {
  await browser.close(); server.close();
}
