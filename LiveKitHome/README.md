# LiveKit on the home server

Cloudflare carries signaling at `wss://media.callimeet.com/livekit`; Pinggy
carries audio/video. The proxy forwards signaling to LiveKit on port 7880 and
rewrites ICE candidates to the current public UDP/TCP endpoints.

## Automatic recovery

LiveKit and Pinggy exchange media on loopback (127.0.0.1, interface lo, ports
7881/7882). No LAN IP or physical interface name is embedded in this path.
Switching Ethernet/Wi-Fi does not require restarting the SFU or losing rooms.

The proxy samples the Linux IPv4 default route every five seconds. A changed
interface, gateway or source IP must persist for two samples before it opens
fresh tunnels. It also checks Pinggy status every 15 seconds and rotates every
50 minutes. Failed attempts back off from 5 to 30 seconds and keep retrying.
Readiness fails while disconnected; Internet loss does not fail liveness.

After opening both tunnels, the proxy requests an SDK reconnect/republish and
keeps the old pair for another minute. WebSocket ping/pong detects half-open
signaling in roughly 10-20 seconds. Meeting clients retry recoverable failures
for up to three minutes, with at most five seconds between attempts. Leaving
or being removed still ends the session.

Media pauses during an outage; these polling intervals are not a recovery-time
guarantee. A full machine/SFU reboot loses LiveKit's in-memory state. Client
recovery requires the server to return within the retry window and valid room
authorization. Existing meeting ownership/disconnection grace is unchanged.

## Kubernetes installation and migration

Use Linux single-node k3s with a stable node address. Enable k3s and cloudflared
as system services. Kubernetes restores the Deployment after boot and restarts
crashed containers; the proxy waits for network access and opens fresh tunnels.
OS routing, Wi-Fi credentials and the k3s node address still need configuring
on a new machine.

Keep credentials in the existing `chat-app/livekit-credentials` Secret:

- `LiveKit__ApiKey`, `LiveKit__ApiSecret`: SFU/API credentials.
- `LiveKit__ClientUrl`: your public signaling URL.
- `LiveKit__HomeEnabled`: true after verification.
- `LiveKit__ServerUrl`: http://livekit-home:7880.

Apply the base application manifests, then `LiveKitHome/deployment.yaml` and
`Tainguyen/infra/k8s/image-watcher.yaml`. The home manifest supplies a ConfigMap,
internal API Service and Deployment. Keys come from the Secret; Pinggy CLI
0.6.1 is packaged in the image. There are no machine-specific host file mounts.
The namespace quota increase accommodates the SFU/proxy. On an existing server,
apply the new image-watcher once to grant manifest deployment permissions.

Add this ingress before the media hostname's catch-all in cloudflared, changing
the hostname on another deployment. Validate before loading the configuration:

```yaml
  - hostname: media.callimeet.com
    path: ^/livekit(/.*)?$
    service: http://127.0.0.1:7883
```

cloudflared runs on the same host. Existing SSH/RDP ingress rules can remain.
The Linux Compose alternative uses `livekit.template.yaml`: supply protected
LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables. Its restart policy
is unless-stopped. Do not run both supervisors on the same host ports.

## CI/CD and verification

CI runs recovery tests, a real SFU/two-browser loopback audio/video check on
Linux, and builds the proxy to verify its native Pinggy CLI. Automatic image
publishing waits for successful push CI. Images carry a source revision and
SHA tag. The image-watcher polls GHCR every two minutes, downloads the LiveKit
manifest from that exact revision, applies it, pins the proxy digest and waits
for readiness. It switches Media's API URL to the internal Service. Failed
apply/rollout does not mark the digest deployed, so the next job retries.
The GHCR package must be publicly readable or registry access configured.

`npm ci && npm test` checks ICE rewriting, SDK reconnect, route selection,
DHCP changes, route loss and retry backoff. `npm run test:loopback` requires
Linux, Docker, Playwright Chromium and the frontend's installed SDK.

For production, `connectivity-check.mjs <config.json>` accepts a protected file
outside Git: {url, tokens: [jwtA, jwtB]}. Use short-lived tokens for a separate
diagnostic room. WATCH_ROTATION_SECONDS verifies reconnect events and increasing
received audio/video after recovery. Never supply API secrets to the browser.

References: [LiveKit configuration](https://github.com/livekit/livekit/blob/v1.9.12/config-sample.yaml),
[LiveKit ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
[Pinggy UDP](https://pinggy.io/docs/udp_tunnels/), [Pinggy CLI](https://pinggy.io/docs/cli/).
