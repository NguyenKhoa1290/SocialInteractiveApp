# Hướng dẫn deploy LiveKit trên VPS cloud riêng

Tiếp nối `HUONG-DAN-DEPLOY-SERVER-NHA.md`. LiveKit **không** chạy trên server nhà — server nhà bị
NAT (không có IP public thật), trong khi LiveKit (WebRTC/TURN) cần IP public thật để client ngoài
mạng kết nối media ổn định. Một VPS giá rẻ có sẵn IP public là cách đơn giản nhất, tránh phải vật
lộn port-forward/NAT hairpin/CGNAT như đã phân tích ở `HUONG-DAN-EXPOSE-LAN.md`.

## 1. Chọn VPS

Yêu cầu tối thiểu cho LiveKit dev/nhỏ: 2 vCPU, 4GB RAM, **có IP public thật** (mặc định với hầu
hết VPS — khác hẳn server nhà). Nhà cung cấp gợi ý: DigitalOcean, Vultr, Linode — đều có gói theo
giờ/tháng rẻ, tạo/xoá nhanh để test trước khi cam kết dài hạn.

**Mở port trên Firewall của VPS** (hầu hết nhà cung cấp có Cloud Firewall riêng, cộng thêm
`ufw`/`iptables` trong OS):
- TCP 80, 443 (nếu dùng domain + TLS cho signaling API)
- TCP 7880 (LiveKit HTTP/WebSocket API)
- TCP 7881 (RTC TCP fallback)
- UDP 50000-60000 (dải ICE port — VPS có IP public thật nên dùng được dải port range gốc, không
  cần workaround UDP-mux-1-cổng như lúc làm trên Docker Desktop)
- UDP 3478 (TURN), TCP 5349 (TURN over TLS, nếu bật)

## 2. Cài Docker + k3s (hoặc chạy thẳng Docker, không cần K8s)

LiveKit ở đây chỉ 1 instance, không cần cả bộ máy K8s nếu không muốn — 2 lựa chọn:

**Cách A — k3s (đồng bộ pattern với server nhà, dễ maintain chung):**
```bash
curl -sfL https://get.k3s.io | sh -
```
Cài Helm rồi deploy y hệt cách đã làm ở máy dev, chỉ đổi values:
```bash
helm repo add livekit https://helm.livekit.io
helm repo update
helm install livekit livekit/livekit-server -n livekit --create-namespace -f livekit-values-vps.yaml
```

**Cách B — Docker Compose thuần (đơn giản hơn, ít lớp trừu tượng hơn cho 1 VM):**
```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    network_mode: host
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
```

Cả 2 cách đều dùng được `podHostNetwork: true` (hoặc `network_mode: host`) đúng như tài liệu LiveKit
khuyến nghị — **VPS có IP public thật nên không dính giới hạn đã gặp trên Docker Desktop** (nơi
`hostNetwork` không bind được ra ngoài). Đây là điểm khác biệt lớn nhất so với máy dev.

## 3. Cấu hình `livekit-values-vps.yaml` (nếu chọn Cách A)

Dựa trên `livekit-values.yaml` đã có, sửa lại:

```yaml
podHostNetwork: true   # hoat dong dung tren VPS (khac Docker Desktop)

livekit:
  keys:
    <api-key-moi>: <api-secret-moi>   # SINH LAI, khong dung key demo cu
  rtc:
    tcp_port: 7881
    port_range_start: 50000
    port_range_end: 60000
    use_external_ip: true             # VPS co IP public that, STUN se tra dung
  turn:
    enabled: true
    domain: turn.<domain-cua-ban>.com # can domain that + cert that (khac dev)
    tls_port: 5349
    udp_port: 3478

loadBalancer:
  type: disable
```

Khác với máy dev: **có thể bật TURN qua TLS thật** (`tls_port`) vì giờ có domain + có thể xin cert
Let's Encrypt qua ACME thật (dev trước đây phải tắt vì không có domain/cert offline).

## 4. Trỏ Media Service (sau này) vào LiveKit VPS

Khi viết code Media Service (Phase 5 theo roadmap), cấu hình LiveKit server URL trỏ vào
`https://<domain-hoac-IP-VPS>:7880` (hoặc qua domain nếu đã set DNS) — khác với các thành phần
khác (Redis/Kafka/Identity DB) nằm cùng server nhà nên gọi qua IP LAN, LiveKit giờ ở ngoài Internet
nên gọi qua domain/IP public + phải bảo vệ bằng chính API key/secret của LiveKit (không cần thêm
VPN vì đây vốn là endpoint API công khai có xác thực, giống các REST API khác qua Ingress).

## 5. Checklist

- [ ] VPS đã tạo, có IP public, ghi lại IP/domain
- [ ] Firewall VPS mở đủ port (mục 1)
- [ ] Cài Docker/k3s trên VPS
- [ ] Deploy LiveKit (Cách A hoặc B), sinh API key/secret mới (không dùng key demo)
- [ ] `curl http://<IP-VPS>:7880/` trả `OK`
- [ ] (Nếu có domain) TURN qua TLS hoạt động với cert Let's Encrypt thật
- [ ] Test WebRTC thật từ 2 client ở 2 mạng khác nhau (không cùng LAN với VPS) để xác nhận NAT
      traversal hoạt động đúng — đây là mục tiêu chính của việc chuyển LiveKit ra VPS
