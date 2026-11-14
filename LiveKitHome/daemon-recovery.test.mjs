import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearUnreachableDaemon } from './daemon-recovery.mjs';

test('preserves live daemon but clears refused control endpoint despite a live PID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinggy-recovery-'));
  const server = createServer((socket) => socket.end());
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    await writeFile(join(dir, 'daemon.json'), JSON.stringify({ pid: process.pid, port }));
    await writeFile(join(dir, 'daemon-state.json'), '{}');
    await writeFile(join(dir, 'daemon-config.json'), '{}');
    assert.equal(await clearUnreachableDaemon(dir), false);
    await new Promise((r) => server.close(r));
    assert.equal(await clearUnreachableDaemon(dir), true);
    await assert.rejects(access(join(dir, 'daemon.json')));
    await assert.rejects(access(join(dir, 'daemon-state.json')));
    await access(join(dir, 'daemon-config.json'));
    assert.equal(await clearUnreachableDaemon(dir), false);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});
