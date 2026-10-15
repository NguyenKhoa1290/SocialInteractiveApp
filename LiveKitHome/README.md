# LiveKit on the home server

LiveKit keeps its rooms and local ports (`7880` HTTP, `7881` ICE/TCP,
`7882` ICE/UDP). `server.mjs` proxies signaling on loopback port `7883` and
maps server ICE candidates to the current Pinggy public TCP/UDP endpoints.
The existing Cloudflare tunnel carries signaling only, at
`wss://media.callimeet.com/livekit`. Audio/video travels through Pinggy.

Every 50 minutes the proxy opens a new pair of tunnels, switches the ICE
mapping and requests a full reconnect through the LiveKit SDK protocol.
The old tunnels remain open for another minute. LiveKit itself stays running.
Tunnel status is checked every 15 seconds; a failed pair is replaced early.
Free tunnels do not require two accounts for this implementation.

## Server prerequisites

The deployment targets the existing single-node k3s server, LAN IP
`192.168.101.18`. Change `SFU_MEDIA_HOST`, `rtc.node_ip` and host paths if moving
to another server. Pinggy must forward UDP to the LAN interface: LiveKit does
not bind UDP to loopback with this configuration.

Keep these files outside the repository:

- `/home/nguyenkhoa/callimeet-home/bin/pinggy`: Pinggy CLI v0.6.1, executable.
- `/home/nguyenkhoa/callimeet-home/livekit.yaml`: mode 600, with fresh API keys.

Example structure, replacing placeholders locally:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: 192.168.101.18
keys:
  <api-key>: <api-secret>
```

Place this rule before the existing catch-all rule for `media.callimeet.com`
in `/etc/cloudflared/config.yml`. Back up and validate the config before loading it.
The SSH ingress rule must remain intact.

```yaml
  - hostname: media.callimeet.com
    path: ^/livekit(/.*)?$
    service: http://127.0.0.1:7883
```

Update the existing `livekit-credentials` Kubernetes Secret locally, preserving
a protected backup, with `LiveKit__ServerUrl=http://192.168.101.18:7880`,
`LiveKit__ClientUrl=wss://media.callimeet.com/livekit`, and the keys above.
Set `LiveKit__HomeEnabled=true` after connectivity checks pass. Restart Media
Service to load the Secret; no API secrets belong in Git or the browser.

## CI/CD and deployment

GitHub Actions builds `ghcr.io/nguyenkhoa1290/chat-app-livekit-home-proxy:latest`.
The package must be readable by the server (public or with an image pull secret).
Apply `deployment.yaml` once, then include `livekit-home-proxy` in the existing
`image-watcher` CronJob's deployment loop so it refreshes this image as well.
The deployment uses `Recreate` because the SFU and proxy use host ports.
It also expands the application namespace memory quota to accommodate the new
SFU and proxy. Apply it after the base manifests, whose quota covers API services.

`compose.yml` is an alternative for isolated testing. Stop that stack before
applying the Kubernetes deployment; both use the same host ports. Do not run
both supervisors at once.

## Verification

`npm ci && npm test` checks candidate rewriting and SDK reconnect messages.
The optional `connectivity-check.mjs` requires Playwright and the frontend's
installed SDK. Supply a JSON file outside Git containing `url` and two short-lived
participant JWTs in `tokens`. It checks that both clients receive audio/video;
`WATCH_ROTATION_SECONDS` additionally verifies reconnection and increasing
received media bytes after rotation. It never needs an API secret.

On 2026-10-15, two Chrome sessions received audio/video through Pinggy TCP and
survived a shortened 120-second rotation, reconnecting in 2571 and 2708 ms.
This does not establish UDP quality, capacity for large meetings, or guaranteed
recovery time on other networks. Actual 60-minute expiry was not waited out.

References: [LiveKit ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
[Pinggy UDP](https://pinggy.io/docs/udp_tunnels/), [Pinggy CLI](https://pinggy.io/docs/cli/).
