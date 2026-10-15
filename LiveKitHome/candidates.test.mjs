import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignalResponse, TrickleRequest, SessionDescription, LeaveRequest_Action } from '@livekit/protocol';
import { mapCandidate, mapSignal, reconnectSignal } from './candidates.mjs';

const endpoints = { udp: { address: '203.0.113.4', port: 40100 }, tcp: { address: '203.0.113.5', port: 40200 } };
const candidate = 'candidate:1 1 udp 2130706431 192.168.1.10 7882 typ host';
test('maps UDP and TCP ports independently, preserving TCP attributes', () => {
  assert.equal(mapCandidate(candidate, endpoints), 'candidate:1 1 udp 2130706431 203.0.113.4 40100 typ host');
  assert.match(mapCandidate(candidate.replace('udp', 'tcp').replace('7882', '7881') + ' tcptype passive', endpoints), /203\.0\.113\.5 40200 typ host tcptype passive$/);
  assert.equal(mapCandidate(candidate.replace('7882', '30000'), endpoints), candidate.replace('7882', '30000'));
});
test('maps binary trickle while preserving target and m-line', () => {
  const input = new SignalResponse({ message: { case: 'trickle', value: new TrickleRequest({
    target: 1, candidateInit: JSON.stringify({ candidate, sdpMid: '0', sdpMLineIndex: 0 }),
  }) } });
  const result = SignalResponse.fromBinary(mapSignal(input.toBinary(), true, endpoints));
  assert.equal(result.message.value.target, 1);
  const ice = JSON.parse(result.message.value.candidateInit);
  assert.equal(ice.sdpMid, '0');
  assert.match(ice.candidate, /203\.0\.113\.4 40100/);
});
test('maps candidates embedded in SDP without changing other SDP lines', () => {
  const input = new SignalResponse({ message: { case: 'offer', value: new SessionDescription({
    type: 'offer', sdp: `v=0\r\na=${candidate}\r\na=ice-ufrag:test\r\n`,
  }) } });
  const result = SignalResponse.fromJsonString(mapSignal(Buffer.from(input.toJsonString()), false, endpoints));
  assert.equal(result.message.value.sdp, `v=0\r\na=candidate:1 1 udp 2130706431 203.0.113.4 40100 typ host\r\na=ice-ufrag:test\r\n`);
});
test('rotation requests SDK full reconnect in JSON and binary modes', () => {
  for (const binary of [true, false]) {
    const data = reconnectSignal(binary);
    const result = binary ? SignalResponse.fromBinary(data) : SignalResponse.fromJsonString(data);
    assert.equal(result.message.case, 'leave');
    assert.equal(result.message.value.action, LeaveRequest_Action.RECONNECT);
  }
});
