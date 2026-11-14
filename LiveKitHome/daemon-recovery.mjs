import { readFile, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';

// Pinggy checks only the recorded PID. Container restarts can reuse that PID
// for another process, leaving the CLI attached to a closed control port.
export async function clearUnreachableDaemon(directory) {
  let info;
  try { info = JSON.parse(await readFile(join(directory, 'daemon.json'), 'utf8')); }
  catch { return false; }
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return false;
  const reachable = await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: info.port });
    socket.setTimeout(1500);
    const finish = (result) => { socket.destroy(); resolve(result); };
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(error.code !== 'ECONNREFUSED'));
    // A timeout is not proof of a dead daemon; preserve state in that case.
    socket.once('timeout', () => finish(true));
  });
  if (reachable) return false;
  // Avoid deleting metadata replaced by a newly started daemon.
  try {
    const current = JSON.parse(await readFile(join(directory, 'daemon.json'), 'utf8'));
    if (current.pid !== info.pid || current.port !== info.port) return false;
    await rm(join(directory, 'daemon-state.json'), { force: true });
    await rm(join(directory, 'daemon.json'), { force: true });
    return true;
  } catch { return false; }
}
