# Kiến trúc mạng hiện tại (Phase 0)

Ghi lại đúng thực trạng đã verify — **không phải** kế hoạch expose toàn bộ ra LAN (đã thử và xác
nhận không đúng chủ đích ban đầu, giữ nguyên phần Docker/K8s chạy local).

## Sơ đồ

| Thành phần | Chạy ở đâu | Truy cập qua |
|---|---|---|
| Docker Desktop K8s (cluster chính): Ingress-Nginx, Metrics Server | Local, máy đang dùng | `localhost` |
| `kind-livekit-cluster`: LiveKit Server | Local, máy đang dùng (cluster `kind` riêng) | `localhost:7880/7881/7882/3478` |
| MinIO | **Máy/thiết bị khác** trong mạng LAN | `http://192.168.50.10:9000` (API), `http://192.168.50.10:9001` (Console) |

**Lưu ý quan trọng đã phát hiện lúc verify:** địa chỉ `192.168.50.10` KHÔNG phải là IP của máy
đang chạy Docker/K8s này — IP của máy này trên mạng `192.168.50.0/24` (adapter "StaticNAT") là
`192.168.50.1`. `192.168.50.10` là một máy/thiết bị hoàn toàn khác, hiện chỉ chạy MinIO. Do đó:

- `curl http://192.168.50.10:9000/minio/health/live` → **200 OK** (MinIO, máy khác) ✅
- `curl http://192.168.50.10/` (Ingress-Nginx) → **000, không kết nối được** — vì Ingress-Nginx
  không chạy ở máy `.10`, nó chạy local ở máy này (`localhost`).
- `curl http://192.168.50.10:7880/` (LiveKit) → **000, không kết nối được** — tương tự, LiveKit
  chạy local, không phải trên máy `.10`.

## Cấu hình endpoint MinIO cho các service sau này

Khi triển khai Identity/Chat/Media Service ở các Phase sau, cấu hình biến môi trường trỏ MinIO
vào:
```
MINIO_ENDPOINT=192.168.50.10:9000
MINIO_CONSOLE=192.168.50.10:9001
```
(Access key/secret lấy theo cấu hình MinIO đã tự cài trên máy `.10`, không quản lý trong repo này.)

## Khi nào cần viết lại hướng dẫn expose Ingress/LiveKit ra LAN

Nếu sau này bạn quyết định cho máy Docker/K8s này (hoặc 1 máy chủ khác) truy cập được từ các
thiết bị khác trong mạng — không chỉ `localhost` — cần làm lại các bước: đặt IP tĩnh cho đúng máy
đó, mở Windows Firewall, và **quan trọng nhất với LiveKit**: quyết định dùng STUN tự dò IP
(`use_external_ip: true`, hợp khi cần truy cập từ Internet) hay gán thẳng `node_ip` bằng IP LAN
(`use_external_ip: false`, hợp khi chỉ dùng trong LAN nội bộ — STUN sẽ trả về IP public của
Internet, không phải IP LAN, khiến client cùng LAN không kết nối được media do NAT hairpin thường
không hoạt động trên router gia đình).

Hiện tại **chưa cần** vì Docker/K8s đang chạy local theo đúng ý định.
