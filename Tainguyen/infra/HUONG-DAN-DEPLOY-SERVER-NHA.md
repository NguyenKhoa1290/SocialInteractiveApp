# Hướng dẫn deploy lên server nhà (Windows, k3s qua WSL2)

Tiếp nối `HUONG-DAN-TRIEN-KHAI-PHASE0.md` và `HUONG-DAN-TRIEN-KHAI-PHASE1.md`. Mục tiêu: chuyển
từ môi trường dev (Docker Desktop K8s + nhiều cluster `kind` trên máy làm việc) sang **1 cluster
K8s thật (k3s)** chạy trên server nhà — máy chủ vật lý riêng, hoạt động 24/7.

## Vì sao k3s thay vì Docker Desktop K8s

Toàn bộ "cạm bẫy" gặp phải khi làm trên Docker Desktop K8s (NodePort không tự forward ra
`localhost`, `podHostNetwork` không hoạt động, phải patch Service thủ công...) đều là **giới hạn
riêng của Docker Desktop** — nó chỉ định hướng cho dev/test 1-node. `k3s` là bản phân phối K8s
**thật, đầy đủ tính năng, nhẹ** (1 binary, RAM thấp) — dùng phổ biến cho production/home-lab, hành
xử đúng chuẩn K8s (NodePort/hostNetwork/LoadBalancer hoạt động như tài liệu K8s mô tả, không cần
workaround).

## Vì sao 1 cluster (không tách 3 cluster như máy dev)

Máy dev tách 3 cluster `kind` (chính, livekit, messaging) là vì **Docker Desktop chỉ cho 1 cluster
K8s**, nên phải dùng `kind` tạo thêm cluster giả lập việc tách biệt. Trên server nhà chạy k3s thật,
**không cần workaround đó** — dùng đúng cách K8s được thiết kế: **1 cluster, nhiều namespace**,
cô lập tài nguyên bằng `ResourceQuota`/`LimitRange`, cô lập theo node (nếu sau này thêm node) bằng
`nodeSelector`/`taints`. Tách nhiều cluster trên cùng 1 máy vật lý không chống được lỗi phần cứng
(máy chết thì cả 3 cluster chết như nhau) — chỉ 1 cluster sạch hơn, dễ vận hành hơn.

---

## 1. Cài WSL2 + Ubuntu trên server nhà

k3s cần kernel Linux thật — chạy trong WSL2 (không cần Hyper-V VM riêng, WSL2 đủ dùng).

```powershell
# Chay PowerShell voi quyen Administrator
wsl --install -d Ubuntu-22.04
# Khoi dong lai may neu duoc yeu cau, roi mo Ubuntu tu Start Menu de hoan tat setup
# (tao username/password cho Linux - khac voi user Windows)
```

**Quan trọng — bật `mirrored` networking mode** (WSL 0.67+) để service trong WSL2 truy cập được
trực tiếp qua IP LAN của server, không bị NAT 2 lớp (Windows → WSL2) gây khó truy cập từ máy khác
trong mạng:

Tạo/sửa file `C:\Users\<user>\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
Sau đó: `wsl --shutdown` rồi mở lại Ubuntu.

Verify trong Ubuntu: `ip addr` phải thấy IP LAN thật của server (không phải dải NAT riêng
`172.x` hay `192.168.x` tách biệt khỏi mạng nhà).

## 2. Cài k3s

Trong Ubuntu (WSL2):
```bash
curl -sfL https://get.k3s.io | sh -
sudo systemctl status k3s   # phai la active (running)
```

Lấy kubeconfig để dùng từ máy làm việc hiện tại (không bắt buộc, nhưng tiện quản lý từ xa):
```bash
sudo cat /etc/rancher/k3s/k3s.yaml
```
Copy nội dung, sửa `server: https://127.0.0.1:6443` thành `server: https://<IP-LAN-server-nha>:6443`,
lưu vào máy làm việc, gộp vào `kubectl config` hiện có với tên context riêng (vd `home-server-k3s`)
bằng cách thêm vào `KUBECONFIG` env var (path nối bằng `;` trên Windows, `:` trên Linux/WSL) rồi
`kubectl config view --merge --flatten`.

**k3s đã có sẵn Metrics Server** (built-in addon, khác với Docker Desktop phải cài tay ở
Phase 0) — verify: `kubectl top nodes`.

## 3. Deploy lại các thành phần (dùng đúng file đã có trong `Tainguyen/infra/`)

Copy toàn bộ thư mục `Tainguyen/infra/` sang server (hoặc chạy `kubectl`/`helm` từ xa trỏ vào
context `home-server-k3s`).

### 3.1 Ingress-Nginx
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.ingressClassResource.default=true
```
k3s có sẵn **ServiceLB** (klipper-lb) — tự bind `LoadBalancer` Service vào IP thật của node, truy
cập được ngay từ LAN qua `http://<IP-server-nha>/`, không cần cơ chế "forward ra localhost" đặc
thù như Docker Desktop.

### 3.2 Identity DB
```bash
kubectl create namespace identity-db
kubectl create secret generic identity-db-credentials -n identity-db \
  --from-literal=POSTGRES_DB=identity \
  --from-literal=POSTGRES_USER=identity_admin \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 16)"
kubectl create configmap identity-db-init -n identity-db --from-file=init.sql=identity-db-init.sql
kubectl apply -f identity-db.yaml
```
Có thể đổi `type: LoadBalancer` lại thành `NodePort` trong `identity-db.yaml` nếu muốn — trên k3s
**cả 2 loại đều hoạt động đúng chuẩn** (khác Docker Desktop, nơi chỉ LoadBalancer mới tự forward).

### 3.3 LiveKit — KHÔNG deploy ở đây

**Quyết định đã chốt:** LiveKit chạy trên **VPS cloud riêng** (DigitalOcean/Vultr/Linode...), không
chạy trên server nhà. Lý do: server nhà bị NAT (không có IP public thật, nhà mạng không cấp hoặc
không tiện mở port-forward) — LiveKit cần IP public thật để WebRTC/TURN hoạt động ổn định cho
client ngoài mạng, một VPS giá rẻ có sẵn IP public là giải pháp đơn giản hơn nhiều so với vật lộn
NAT traversal. Xem hướng dẫn riêng: `HUONG-DAN-LIVEKIT-VPS.md`.

### 3.4 Redis + Kafka + RabbitMQ
```bash
kubectl apply -f redis.yaml
kubectl apply -f kafka.yaml   # SUA truoc: xem ghi chu ben duoi
kubectl apply -f rabbitmq.yaml
```

**Phải sửa `kafka.yaml` trước khi apply:** `KAFKA_ADVERTISED_LISTENERS` hiện đang trỏ
`172.18.0.7:30909` (IP container Docker network `kind` trên máy dev — không tồn tại trên server
nhà). Đổi thành IP LAN thật của server nhà + NodePort tương ứng, ví dụ:
```yaml
- name: KAFKA_ADVERTISED_LISTENERS
  value: "PLAINTEXT://<IP-LAN-server-nha>:30909"
```
(Vẫn giữ nguyên bài học cũ: phải là NodePort thật, không phải cổng nội bộ `9092` — xem
`HUONG-DAN-TRIEN-KHAI-PHASE0.md` mục 6 nếu quên lý do.)

### 3.5 MinIO
Giữ nguyên như đang làm — cài trực tiếp trên hệ điều hành, không qua K8s. Có thể cài luôn trên
server nhà này (cùng máy) hoặc giữ ở máy `192.168.50.10` như hiện tại, miễn cùng mạng LAN reach
được.

---

## 4. Chia tài nguyên: 60% Database / 30% Service / 10% dự trữ hệ thống

**Lý do chia theo tỉ lệ này:** Database (Identity DB, và các DB khác sau này — mỗi service 1 DB
riêng theo kiến trúc "Database per Service") **không scale ngang được** (không sharding vì tốn
công + rủi ro, chỉ 1 instance/DB) — cần cấp tài nguyên đủ lớn, cố định, ổn định. Service (Identity
Service, Chat Service...) là stateless, tự scale ngang bằng HPA — chỉ cần đủ tài nguyên nền, phần
"đông user" sẽ tự dàn thêm replica trong đúng phần được cấp. 10% còn lại dành cho hệ thống K8s
(kube-system, Ingress-Nginx, Metrics Server...) — không cấp hết 100% cho workload vì node cần chỗ
thở cho chính nó, hết sạch tài nguyên node sẽ không ổn định (kể cả gây crash kube-scheduler như đã
gặp ở máy dev khi thiếu RAM).

### 4.1 Đo tổng tài nguyên node trước

```bash
kubectl describe node <ten-node> | grep -A 5 "Allocatable"
# hoac
kubectl top nodes
```
Lấy số CPU (core) và RAM (Gi) thật của node, tính ra số tuyệt đối theo tỉ lệ 60/30/10. Ví dụ node
có 16 core / 32Gi RAM:
- Database: 60% → 9.6 core / 19.2Gi → làm tròn `9500m` CPU / `19Gi` RAM
- Service: 30% → 4.8 core / 9.6Gi → làm tròn `4800m` CPU / `9Gi` RAM
- Còn lại ~10%: không cấp quota, để trống cho hệ thống

### 4.2 Áp `ResourceQuota` theo nhóm namespace

Gộp các namespace DB vào 1 nhóm, namespace service vào 1 nhóm (K8s không có "namespace nhóm" thật
sự — cách làm chuẩn là gắn `ResourceQuota` riêng cho **từng namespace**, cộng lại đúng bằng ngân
sách nhóm đó). Ví dụ 1 DB (Identity) + 1 Service (Identity Service) với số ở trên:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: db-quota
  namespace: identity-db
spec:
  hard:
    requests.cpu: "9500m"
    requests.memory: "19Gi"
    limits.cpu: "9500m"
    limits.memory: "19Gi"
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: service-quota
  namespace: identity-service      # namespace se tao khi co code that
spec:
  hard:
    requests.cpu: "4800m"
    requests.memory: "9Gi"
    limits.cpu: "4800m"
    limits.memory: "9Gi"
```

Khi có thêm DB/Service khác (WorkSpace DB, Chat Service...), **chia nhỏ tiếp trong đúng ngân sách
60%/30%** — ví dụ 2 DB thì mỗi DB namespace nhận 1 phần của khoản 60% đó, không phải mỗi cái lại
được thêm 60% mới.

### 4.3 HPA cho Service (nằm trong quota, không vượt)

```bash
kubectl autoscale deployment chat-service -n chat-service --cpu-percent=70 --min=1 --max=5
```
HPA tự tăng replica khi tải cao, nhưng bị chặn cứng bởi `ResourceQuota` của namespace đó (mục
4.2) — không thể vượt quá 30% tổng tài nguyên node dành cho toàn bộ nhóm Service, đúng như thiết
kế ban đầu.

---

## 5. Backup định kỳ lên AWS S3 hoặc S3-tương-thích khác (phương án dự phòng đã chọn)

Chưa triển khai trong tài liệu này — sẽ làm ở bước riêng sau khi cluster trên server nhà chạy ổn
định. Ý tưởng: cron job trong cluster (K8s `CronJob`) chạy `pg_dump` (Identity DB, và các DB khác
sau này) + `mc mirror` (MinIO) định kỳ, đẩy lên 1 S3 bucket. Chi phí gần như chỉ tính theo dung
lượng lưu trữ S3, không cần EC2/compute nào chạy thường trực bên AWS.

---

## 6. Việc cần làm khi thực sự bắt tay vào (checklist)

- [ ] WSL2 + Ubuntu cài xong, `networkingMode=mirrored` đã bật
- [ ] k3s cài xong, `kubectl get nodes` thấy `Ready`
- [ ] `kubectl top nodes` chạy được (Metrics Server có sẵn trong k3s)
- [ ] Ingress-Nginx cài, `curl http://<IP-server-nha>/` trả 404 từ máy khác trong LAN
- [ ] Identity DB deploy lại, schema verify giống Phase 1
- [ ] Redis/Kafka/RabbitMQ deploy lại, **đã sửa `KAFKA_ADVERTISED_LISTENERS`** đúng IP server nhà
- [ ] Đo tổng CPU/RAM node, tính `ResourceQuota` 60/30/10, áp cho từng namespace (mục 4)
- [ ] HPA cấu hình cho từng Service khi có code thật (mục 4.3)
- [ ] Windows Firewall trên server nhà mở đúng port cần thiết (80/443, 5432, 6379, 9092, 5672,
      15672 — **không cần port LiveKit nữa, đã chuyển sang VPS riêng**)
- [ ] LiveKit: xem checklist riêng trong `HUONG-DAN-LIVEKIT-VPS.md`
- [ ] (Sau này) CronJob backup Postgres/MinIO lên S3
