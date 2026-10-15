import { SignalResponse, LeaveRequest, LeaveRequest_Action } from '@livekit/protocol';

// Only server -> browser candidates are mapped. The SFU continues listening on
// fixed local ports, so rotating a tunnel never restarts LiveKit or loses rooms.
export function mapCandidate(candidate, endpoints) {
  const parts = candidate.trim().split(/\s+/);
  if (!/^candidate:/.test(parts[0]) || parts.length < 8) return candidate;
  const protocol = parts[2].toLowerCase();
  const expectedPort = protocol === 'udp' ? '7882' : protocol === 'tcp' ? '7881' : null;
  if (parts[5] !== expectedPort || !endpoints[protocol]) return candidate;
  parts[4] = endpoints[protocol].address;
  parts[5] = String(endpoints[protocol].port);
  return parts.join(' ');
}

export function mapSignal(data, isBinary, endpoints) {
  const response = isBinary ? SignalResponse.fromBinary(data) : SignalResponse.fromJsonString(data.toString());
  const { message } = response;
  if (message.case === 'trickle') {
    const candidate = JSON.parse(message.value.candidateInit);
    if (typeof candidate.candidate === 'string') {
      candidate.candidate = mapCandidate(candidate.candidate, endpoints);
      message.value.candidateInit = JSON.stringify(candidate);
    }
  } else if (message.case === 'offer' || message.case === 'answer') {
    message.value.sdp = message.value.sdp.replace(/^a=(candidate:[^\r\n]*)/gm,
      (_, candidate) => `a=${mapCandidate(candidate, endpoints)}`);
  } else {
    return data;
  }
  return isBinary ? Buffer.from(response.toBinary()) : response.toJsonString();
}

export function reconnectSignal(isBinary) {
  const response = new SignalResponse({ message: { case: 'leave', value: new LeaveRequest({
    action: LeaveRequest_Action.RECONNECT, canReconnect: true,
  }) } });
  return isBinary ? Buffer.from(response.toBinary()) : response.toJsonString();
}
