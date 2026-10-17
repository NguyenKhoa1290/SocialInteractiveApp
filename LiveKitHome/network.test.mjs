import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFingerprint, RecoveryState } from './network.mjs';

const header = 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n';
const wired = 'eth0 00000000 0101A8C0 0003 0 0 100 00000000 0 0 0';
const wifi = 'wlan0 00000000 0101A8C0 0003 0 0 600 00000000 0 0 0';
const interfaces = { eth0: [{ family: 'IPv4', address: '192.168.1.2' }], wlan0: [{ family: 'IPv4', address: '192.168.1.3' }] };

test('detects preferred route, fallback, new DHCP address and no route', () => {
  const a = routeFingerprint(header + wifi + '\n' + wired, interfaces);
  assert.equal(a, routeFingerprint(header + wired + '\n' + wifi, interfaces));
  assert.notEqual(a, routeFingerprint(header + wifi, interfaces));
  assert.notEqual(a, routeFingerprint(header + wired, { eth0: [{ family: 'IPv4', address: '192.168.1.4' }] }));
  assert.equal(routeFingerprint(header, interfaces), null);
  assert.equal(routeFingerprint(header + wired, {}), null);
  assert.equal(a, routeFingerprint(header + wired + '\nveth0 00002A0A 00000000 0001 0 0 0 00FFFFFF 0 0 0', interfaces));
});

test('network changes debounce, invalidate readiness and rotate even if Pinggy says running', () => {
  const s = new RecoveryState();
  assert.equal(s.observe('wifi'), false);
  assert.equal(s.observe('wifi'), true);
  assert.equal(s.needsRotation(0, true, Infinity), true);
  s.recovered();
  assert.equal(s.ready, true);
  assert.equal(s.needsRotation(0, true, Infinity), false);
  assert.equal(s.observe('wired'), false);
  assert.equal(s.ready, false);
  assert.equal(s.observe('wired'), true);
  assert.equal(s.needsRotation(0, true, Infinity), true);
  s.recovered();
  assert.equal(s.observe(null), false);
  assert.equal(s.ready, false);
  assert.equal(s.observe('wired'), false);
  assert.equal(s.observe('wired'), true);
  assert.equal(s.needsRotation(0, true, Infinity), true);
});

test('outages back off to 30 seconds and successful recovery resets backoff', () => {
  const s = new RecoveryState();
  s.observe('wired'); s.observe('wired');
  let now = 0;
  for (const delay of [5000, 10000, 20000, 30000, 30000]) {
    s.failed(now);
    assert.equal(s.retryAt, now + delay);
    assert.equal(s.needsRotation(now, false, 0), false);
    now += delay;
    assert.equal(s.needsRotation(now, false, 0), true);
  }
  s.recovered();
  assert.equal(s.needsRotation(now, false, Infinity), true);
  assert.equal(s.needsRotation(now, true, now), true);
  s.failed(now);
  assert.equal(s.retryAt, now + 5000);
});
