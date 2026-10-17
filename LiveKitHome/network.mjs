import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

// Only the default route matters. Docker/veth creation must not rotate calls.
export function routeFingerprint(routes, interfaces) {
  const defaults = routes.trim().split('\n').slice(1).map((line) => line.trim().split(/\s+/))
    .filter((r) => r[1] === '00000000' && r[7] === '00000000' && (parseInt(r[3], 16) & 1))
    .sort((a, b) => Number(a[6]) - Number(b[6]) || a[0].localeCompare(b[0]));
  for (const r of defaults) {
    const ips = (interfaces[r[0]] || []).filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => a.address).sort();
    if (ips.length) return JSON.stringify([r[0], r[2], ...ips]);
  }
  return null;
}

export async function defaultRoute() {
  return routeFingerprint(await readFile('/proc/net/route', 'utf8'), networkInterfaces());
}

// A changed route must survive two samples. A lost route makes readiness fail
// immediately, but never restarts the SFU or the pod during an Internet outage.
export class RecoveryState {
  committed = undefined;
  observed = undefined;
  samples = 0;
  ready = false;
  retryAt = 0;
  failures = 0;

  observe(route) {
    if (route === this.observed) this.samples++;
    else { this.observed = route; this.samples = 1; }
    if (route === null || route !== this.committed) this.ready = false;
    return route !== null && this.samples >= 2;
  }

  needsRotation(now, running, expiresAt) {
    return now >= this.retryAt && (!this.ready || !running || this.observed !== this.committed || now >= expiresAt);
  }

  recovered() {
    this.committed = this.observed;
    this.ready = true;
    this.failures = 0;
    this.retryAt = 0;
  }

  failed(now) {
    this.ready = false;
    this.retryAt = now + Math.min(30_000, 5000 * 2 ** Math.min(this.failures++, 3));
  }
}
