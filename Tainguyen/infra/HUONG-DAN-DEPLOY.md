# Hướng dẫn triển khai hạ tầng — tổng hợp

Gộp toàn bộ các tài liệu hướng dẫn hạ tầng của dự án vào 1 file duy nhất (trước đây tách thành 8
file riêng — `HUONG-DAN-TRIEN-KHAI-PHASE0/1/2.md`, `HUONG-DAN-EXPOSE-LAN.md`,
`HUONG-DAN-DONG-GOI-SERVICE.md`, `HUONG-DAN-DEPLOY-SERVER-NHA.md`, `HUONG-DAN-LIVEKIT-VPS.md`,
`HUONG-DAN-TU-DONG-MO-RONG-AWS.md` — nay không còn tồn tại riêng lẻ, nội dung đã chuyển hết vào đây).
Tham chiếu kiến trúc gốc: `Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md`.

## Mục lục

0. [Tổng quan kiến trúc & 2 môi trường](#0-tổng-quan-kiến-trúc--2-môi-trường) · [0.1 Docker Compose](#01-chạy-tầng-ứng-dụng-bằng-docker-compose-đường-chính-khi-dev)
1. [Máy dev — Hạ tầng nền (Docker Desktop + kind, 3 cluster)](#1-máy-dev--hạ-tầng-nền)
2. [Máy dev — Cơ sở dữ liệu từng service](#2-máy-dev--cơ-sở-dữ-liệu-từng-service)
3. [Máy dev — MinIO & mạng LAN](#3-máy-dev--minio--mạng-lan)
4. [Đóng gói & đẩy image lên GHCR](#4-đóng-gói--đẩy-image-lên-ghcr)
5. [Deploy lên server nhà (k3s thật)](#5-deploy-lên-server-nhà-k3s-thật)
6. [LiveKit — chạy trên cloud](#6-livekit--chạy-trên-cloud)
7. [Tự động mở rộng (burst) sang AWS khi quá tải](#7-tự-động-mở-rộng-burst-sang-aws-khi-quá-tải)
8. [Cạm bẫy đã gặp — tổng hợp](#8-cạm-bẫy-đã-gặp--tổng-hợp)
9. [Checklist tổng hợp](#9-checklist-tổng-hợp)

---

## 0. Tổng quan kiến trúc & 2 môi trường

**Môi trường dev** (máy làm việc hiện tại, Windows + Docker Desktop): **3 cluster K8s tách biệt**
(`docker-desktop`, `kind-livekit-cluster`, `kind-messaging-cluster`) — vì Docker Desktop chỉ chạy
được 1 cluster K8s qua toggle "Enable Kubernetes", nên dùng thêm `kind` CLI tạo cluster độc lập cho
LiveKit và cho nhóm hạ tầng nhắn tin (Redis/Kafka/RabbitMQ).

**Môi trường thật (server nhà):** **1 cluster k3s duy nhất** trên server nhà; LiveKit dùng
**LiveKit Cloud managed** (mục 6.0 — đã chốt, không tự dựng vì server nhà bị CGNAT). Không cần tách
nhiều cluster như máy dev — đó chỉ là workaround riêng của Docker Desktop.

### 0.1 Chạy tầng ứng dụng bằng Docker Compose (đường chính khi dev)

Cả 6 service + frontend chạy trong Docker qua `docker-compose.yml` ở thư mục gốc. **Hạ tầng
không nằm trong compose** — Postgres/Redis/Kafka/RabbitMQ/LiveKit vẫn ở các cluster K8s, MinIO ở
máy LAN riêng. Compose chỉ chạy tầng ứng dụng.

```bash
docker compose up -d --build      # bật tất cả (lần đầu)
docker compose ps                 # xem sống/chết + healthcheck
docker compose logs -f chat       # xem log 1 service
docker compose up -d --build chat # build lại 1 service sau khi sửa code
docker compose down               # tắt tất cả
```

| Service | Cổng ra host | Service | Cổng ra host |
|---|---|---|---|
| identity | 5194 | media | 5300 |
| workspace | 5153 | admin | 5230 |
| chat | 5261 | spamtracking | 5160 |
| frontend (Vite) | 5173 | | |

**`host.docker.internal` ở khắp nơi:** hạ tầng publish cổng ra Windows host, mà trong container
`localhost` là chính container đó. Đây là đường duy nhất container gọi ngược ra host.

**Ba chỗ CỐ Ý không dùng `host.docker.internal`** — vì giá trị đó đi tới trình duyệt chứ không phải
tới backend:

| Cấu hình | Giá trị | Lý do |
|---|---|---|
| `LiveKit__ClientUrl` | `ws://localhost:7880` | trả về trong `livekitUrl` cho trình duyệt tự kết nối |
| `LiveKit__ServerUrl` | `http://host.docker.internal:7880` | Media Service gọi Server API từ trong container |
| `Storage__Providers__home__Endpoint` | `http://192.168.50.10:9000` | URL presign trả cho trình duyệt; backend không bao giờ nối tới MinIO |

Đổi nhầm `ClientUrl` thành `host.docker.internal` là phòng họp không vào được, mà log backend
hoàn toàn sạch — rất khó truy.

**Service gọi nhau bằng tên container + cổng nội bộ 8080** (`http://identity:8080`), không vòng ra
host. Không đặt `depends_on` giữa chúng vì workspace↔chat phụ thuộc vòng — các service tự retry.

**Admin Service và kubeconfig:** Admin cần đọc K8s cho `/admin/system/resources`, nhưng kubeconfig
của Docker Desktop trỏ `https://127.0.0.1:<cổng ngẫu nhiên>` — cổng đổi mỗi lần Docker Desktop khởi
động lại, và `127.0.0.1` trong container là chính container. Job `kubeconfig-init` chạy trước Admin
mỗi lần `up`, chép kubeconfig và đổi địa chỉ thành `host.docker.internal` + bật
`insecure-skip-tls-verify` (cert API server không ký cho tên đó). **Volume phải gắn vào đúng
`/home/appuser/.kube`** — biến `KUBECONFIG` không ăn, vì
`KubernetesClientConfiguration.BuildConfigFromConfigFile()` không tham số đọc thẳng
`$HOME/.kube/config`.

**Sửa code thì phải build lại image** (`docker compose up -d --build <service>`) — chậm hơn
`dotnet run` trên máy. Khi cần gắn debugger hoặc lặp nhanh 1 service, `dev-start.ps1 -Only <key>`
vẫn dùng được, chỉ cần `docker compose stop <service>` trước để nhả cổng.

| | Môi trường dev | Môi trường thật |
|---|---|---|
| Số cluster K8s | 3 (`docker-desktop`, `kind-livekit-cluster`, `kind-messaging-cluster`) | 1 (k3s, server nhà) |
| Cách cô lập tài nguyên | Tách cluster | Namespace + `ResourceQuota`/`LimitRange` trong cùng 1 cluster |
| LiveKit | `kind-livekit-cluster`, `localhost:7880` | VPS riêng có IP public thật |
| Giao tiếp cross-cluster | `<IP container node>:<NodePort>` qua Docker network `kind` chung | DNS nội bộ K8s (`<svc>.<ns>.svc.cluster.local`), cùng 1 cluster |
| Mở rộng khi quá tải | Không áp dụng | Node AWS tạm thời (mục 7) |

---

## 1. Máy dev — Hạ tầng nền

**Kiến trúc 3 cluster:**

| Cluster | Công cụ tạo | Chứa gì | Lý do tách riêng |
|---|---|---|---|
| **Cluster chính** (`docker-desktop`) | Docker Desktop → Enable Kubernetes | Ingress-Nginx, Metrics Server, các service nghiệp vụ (Identity, WorkSpace, Chat, SpamTracking, Admin, Media), toàn bộ Postgres DB | Nhóm service nghiệp vụ, scale cùng nhau |
| **livekit-cluster** | `kind` CLI | LiveKit Server (WebRTC/TURN) | Nặng nhất CPU/network, cần scale độc lập |
| **messaging-cluster** | `kind` CLI | Redis, Kafka (KRaft), RabbitMQ | Tách khỏi service nghiệp vụ để không cạnh tranh tài nguyên, gộp chung với nhau vì không cần scale riêng lẻ |

MinIO: **không qua Docker/K8s** — cài trực tiếp trên hệ điều hành, xem mục 3.

**Giao tiếp giữa các cluster:** vì tách biệt hoàn toàn, không dùng chung DNS/mạng nội bộ K8s. Mọi
node container (Docker Desktop lẫn `kind`) nằm chung 1 Docker network tên `kind`
(`docker network inspect kind`) — service ở cluster A gọi sang cluster B qua
**`<IP container node cụm B>:<NodePort>`** (ví dụ Kafka ở `messaging-cluster`:
`172.18.0.7:30909`), KHÔNG qua `localhost`, KHÔNG qua K8s Service DNS. IP container có thể đổi nếu
cluster bị xoá tạo lại — kiểm tra lại bằng `docker network inspect kind`.

### 1.1 Yêu cầu tài nguyên máy

Chạy 3 control-plane K8s cùng lúc cần tối thiểu **12-16GB RAM** cấp cho Docker Desktop (RAM mặc
định thấp ~2GB khiến `kube-scheduler` crash loop âm thầm → mọi pod kẹt `Pending` mãi mãi, triệu
chứng dễ nhầm là "pod bug"). Cấp qua Docker Desktop → ⚙️ Settings → Resources → Memory → Apply & Restart.

### 1.2 Cài `kubectl`, `helm`, `kind` (portable, không cần admin)

`kubectl` có sẵn kèm Docker Desktop. `helm`/`kind` tải portable:

```powershell
$dest = "$env:LOCALAPPDATA\helm"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Invoke-WebRequest -Uri "https://get.helm.sh/helm-v3.16.4-windows-amd64.zip" -OutFile "$dest\helm.zip"
Expand-Archive -Path "$dest\helm.zip" -DestinationPath $dest -Force
Copy-Item "$dest\windows-amd64\helm.exe" "$dest\helm.exe" -Force
Remove-Item "$dest\helm.zip"

Invoke-WebRequest -Uri "https://kind.sigs.k8s.io/dl/v0.24.0/kind-windows-amd64" -OutFile "$dest\kind.exe"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
```

Git Bash/WSL bash cần export PATH thủ công mỗi phiên mới (không tự lan từ biến PATH Windows):
`export PATH="$PATH:/c/Users/<user>/AppData/Local/helm"`.

### 1.3 Cluster chính: Metrics Server + Ingress-Nginx

```bash
kubectl config use-context docker-desktop

# Metrics Server - can cho Admin Service (GET /admin/system/resources, Phase 4)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl rollout status deployment/metrics-server -n kube-system --timeout=120s
kubectl top nodes

# Ingress-Nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.ingressClassResource.default=true
```

Docker Desktop tự forward Service `LoadBalancer` ra `localhost`. Verify: `curl http://localhost/` →
`404` (đúng, chưa có Ingress rule nào).

### 1.4 Cluster LiveKit (`kind`)

**Vì sao `kind` chứ không phải Docker Desktop K8s:** `podHostNetwork: true` (cách LiveKit khuyến
nghị chính thức) không hoạt động trên Docker Desktop — node chạy trong 1 container ẩn,
`hostNetwork` chỉ bind vào namespace container đó, không bind ra Windows host thật. `kind` hỗ trợ
`extraPortMappings` publish thẳng port ra host, dùng NodePort thay vì hostNetwork.

```yaml
# kind-livekit-cluster.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: livekit-cluster
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30880
        hostPort: 7880
        protocol: TCP
      - containerPort: 30881
        hostPort: 7881
        protocol: TCP
      - containerPort: 30882
        hostPort: 7882
        protocol: UDP
      - containerPort: 30478
        hostPort: 3478
        protocol: UDP
```

```bash
kind create cluster --config kind-livekit-cluster.yaml
kubectl config use-context kind-livekit-cluster

helm repo add livekit https://helm.livekit.io
helm repo update
helm install livekit livekit/livekit-server -n livekit --create-namespace -f livekit-values.yaml
```

`livekit-values.yaml` điểm mấu chốt: `podHostNetwork: false` (lý do ở trên); dùng **UDP mux 1
cổng** (`rtc.udp_port: 7882`) thay vì dải port range (không thực tế NodePort-từng-port cho dải
50000-50100); `loadBalancer.type: disable` (chart không tự đặt NodePort, phải patch tay); STUN dùng
server của Google (`stun.l.google.com:19302`, miễn phí không giới hạn) qua `rtc.stun_servers`.

Patch Service sang NodePort cố định (verify thứ tự port bằng
`kubectl get svc livekit-livekit-server -n livekit -o jsonpath='{range .spec.ports[*]}{.name}{"\t"}{.nodePort}{"\n"}{end}'`
trước nếu chart version khác):
```bash
kubectl patch service livekit-livekit-server -n livekit --type='json' -p='[
  {"op":"replace","path":"/spec/type","value":"NodePort"},
  {"op":"add","path":"/spec/ports/0/nodePort","value":30880},
  {"op":"add","path":"/spec/ports/1/nodePort","value":30881},
  {"op":"add","path":"/spec/ports/2/nodePort","value":30882}
]'
```

Chart **không tự tạo Service cho TURN UDP thường** (chỉ có TURN qua TLS/443, cần cert thật) — áp
`livekit-turn-service.yaml` riêng: `kubectl apply -f livekit-turn-service.yaml`.

Nếu rolling-update bị `Pending` (pod mới kẹt vì pod cũ giữ chỗ hostPort trên cluster 1-node), xoá
pod cũ tay: `kubectl delete pod -n livekit <ten-pod-cu>`.

Verify: `curl http://localhost:7880/` → `OK`; `kubectl logs -n livekit deployment/livekit-livekit-server --tail=20` không có `ERROR`.

### 1.5 Cluster messaging (`kind`, gộp Redis + Kafka + RabbitMQ)

```yaml
# kind-messaging-cluster.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: messaging-cluster
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30637
        hostPort: 6379
        protocol: TCP
      - containerPort: 30909
        hostPort: 9092
        protocol: TCP
      - containerPort: 30567
        hostPort: 5672
        protocol: TCP
      - containerPort: 31567
        hostPort: 15672
        protocol: TCP
```

**Không dùng Helm chart Bitnami** (phần lớn image bị khoá từ 8/2025, xem mục 8) — dùng manifest
YAML thuần, image chính thức: `redis:7-alpine`, `apache/kafka:3.8.0` (KRaft, không cần Zookeeper),
`rabbitmq:3.13-management-alpine`.

```bash
kind create cluster --config kind-messaging-cluster.yaml
kubectl config use-context kind-messaging-cluster

# Redis
REDIS_PASS=$(openssl rand -hex 16)
kubectl create namespace redis
kubectl create secret generic redis-credentials -n redis --from-literal=REDIS_PASSWORD="$REDIS_PASS"
kubectl apply -f redis.yaml

# Kafka
kubectl apply -f kafka.yaml

# RabbitMQ
RABBIT_PASS=$(openssl rand -hex 16)
kubectl create namespace rabbitmq
kubectl create secret generic rabbitmq-credentials -n rabbitmq \
  --from-literal=RABBITMQ_DEFAULT_USER=admin \
  --from-literal=RABBITMQ_DEFAULT_PASS="$RABBIT_PASS"
kubectl apply -f rabbitmq.yaml
```

**Điểm mấu chốt `kafka.yaml` — `KAFKA_ADVERTISED_LISTENERS` phải dùng NodePort, không dùng cổng nội
bộ:**
```yaml
- name: KAFKA_ADVERTISED_LISTENERS
  value: "PLAINTEXT://172.18.0.7:30909"   # NodePort 30909, KHONG phai 9092
```
Client Kafka làm việc 2 bước: (1) bootstrap tới địa chỉ được cho, (2) nhận metadata trả về địa chỉ
"advertised" của broker rồi **mở kết nối MỚI** tới đúng địa chỉ đó. Nếu advertised khai cổng nội bộ
`9092`, bước (2) luôn timeout vì `9092` không được expose ra ngoài container. `172.18.0.7` = IP
container `messaging-cluster-control-plane` trên network `kind` — verify lại bằng
`docker network inspect kind` nếu IP đổi.

Verify:
```bash
kubectl exec -n redis deploy/redis -- redis-cli -a "$REDIS_PASS" ping   # PONG
MSYS_NO_PATHCONV=1 kubectl exec -n kafka deployment/kafka -- /opt/kafka/bin/kafka-topics.sh \
  --list --bootstrap-server localhost:9092
curl http://localhost:15672/   # RabbitMQ management UI, HTTP 200
```
(`MSYS_NO_PATHCONV=1` trên Git Bash Windows — tự động convert đường dẫn Unix thành Windows, gây lỗi.)

Verify cross-cluster (mô phỏng service ở cluster chính gọi vào):
```bash
kubectl config use-context docker-desktop
kubectl run redis-test --rm -i --restart=Never --image=redis:7-alpine -- \
  redis-cli -h 172.18.0.7 -p 30637 -a "$REDIS_PASS" ping        # PONG
kubectl run kafka-test --rm -i --restart=Never --image=apache/kafka:3.8.0 -- \
  /opt/kafka/bin/kafka-topics.sh --list --bootstrap-server 172.18.0.7:30909
kubectl run rabbit-test --rm -i --restart=Never --image=busybox -- \
  sh -c "nc -zv -w3 172.18.0.7 30567"
```

---

## 2. Máy dev — Cơ sở dữ liệu từng service

**"Database per Service"** — mỗi service 1 Postgres riêng, namespace riêng, trong cluster chính
(`docker-desktop`). Cùng 1 quy trình lặp lại cho từng DB: tạo namespace → tạo Secret (mật khẩu random)
→ tạo ConfigMap từ file `*-db-init.sql` → `kubectl apply -f *-db.yaml`.

### 2.1 Vì sao Service phải là `LoadBalancer`, không phải `NodePort`

**Đã verify:** trên `docker-desktop`, `NodePort` KHÔNG được Docker Desktop tự forward ra
`localhost` (khác `kind`, nơi `extraPortMappings` làm việc này). Chỉ `LoadBalancer` mới tự forward.
Dưới lớp `LoadBalancer`, K8s vẫn cấp 1 NodePort song song (`kubectl get svc` cột `PORT(S)` dạng
`5432:XXXXX/TCP`) — NodePort này mới dùng để truy cập **cross-cluster**, còn port chính
(`LoadBalancer`) chỉ hoạt động qua cơ chế forward riêng của Docker Desktop cho `localhost`.

| Ai kết nối | Địa chỉ |
|---|---|
| Công cụ dev trên máy này (psql, DBeaver...) | `localhost:<port>` |
| Service ở cluster khác (`livekit-cluster`, `messaging-cluster`) | `<IP container node desktop-control-plane>:<NodePort>` |

### 2.2 Bảng tổng hợp các DB (port `localhost`, namespace)

| Service | DB namespace | Port `localhost` | Bảng chính |
|---|---|---|---|
| Identity | `identity-db` | 5432 | `users`, `oauth_links` |
| WorkSpace | `workspace-db` | 5433 | `workspaces`, `workspace_members` |
| Chat | `chat-db` | 5434 | `conversations`, `messages`, `group_chat_settings`, `muted_members`, `files` |
| SpamTracking | `spamtracking-db` | 5435 | `violations` |
| Media | `media-db` | 5436 | `meetings`, `meeting_participants`, `meeting_invites`, `meeting_permissions` |
| MiniApp (IPTV) | `miniapp-db` | 5437 | `iptv_channel_lists`, `iptv_channel_groups`, `iptv_channels` |

*(Admin Service không có DB riêng — hoạt động thuần lớp điều phối, xem roadmap mục 4.)*

Ví dụ deploy 1 DB (lặp lại đúng pattern này cho từng dòng ở bảng trên, đổi tên service/port):
```bash
kubectl create namespace identity-db
DB_PASS=$(openssl rand -hex 16)
kubectl create secret generic identity-db-credentials -n identity-db \
  --from-literal=POSTGRES_DB=identity \
  --from-literal=POSTGRES_USER=identity_admin \
  --from-literal=POSTGRES_PASSWORD="$DB_PASS"
# Luu DB_PASS vao .identity-db-credentials.txt (KHONG commit git - da co trong .gitignore)
kubectl create configmap identity-db-init -n identity-db --from-file=init.sql=identity-db-init.sql
kubectl apply -f identity-db.yaml
```

Init script chạy **1 lần duy nhất** lúc container Postgres khởi tạo lần đầu (cơ chế chuẩn image
`postgres`: file trong `/docker-entrypoint-initdb.d/` chạy khi `pgdata` còn trống). Muốn chạy lại
từ đầu phải xoá PVC tương ứng trước.

**Lưu ý schema Chat DB dùng chung P2P + Group:** bảng `conversations`/`messages`/`files` phục vụ cả
2 loại chat qua cột `type`; `group_chat_settings`/`muted_members` chỉ có ý nghĩa với `type='group'`
— 1 schema thống nhất, không tách bảng riêng theo phase.

### 2.3 Verify nhanh (ví dụ Identity DB)

```bash
DB_PASS=$(cat .identity-db-credentials.txt | grep POSTGRES_PASSWORD | cut -d= -f2)
kubectl exec -n identity-db deployment/identity-db -- env PGPASSWORD="$DB_PASS" \
  psql -U identity_admin -d identity -c "\dt"

# Constraint hoat dong dung: Guest co email PHAI bi tu choi
kubectl exec -n identity-db deployment/identity-db -- env PGPASSWORD="$DB_PASS" \
  psql -U identity_admin -d identity -c \
  "INSERT INTO users (user_type, nickname, email) VALUES ('guest','x','a@b.com');"
# Ky vong: ERROR chk_guest_no_credentials
```

---

## 3. Máy dev — MinIO & mạng LAN

MinIO **không qua Docker/K8s** — cài trực tiếp trên hệ điều hành, theo lựa chọn riêng của người vận
hành, chạy trên 1 máy/thiết bị khác trong mạng LAN (không phải máy đang chạy Docker/K8s này).

**Kiến trúc mạng đã verify:**

| Thành phần | Chạy ở đâu | Truy cập qua |
|---|---|---|
| Docker Desktop K8s (cluster chính) | Local, máy đang dùng | `localhost` |
| `kind-livekit-cluster` | Local, máy đang dùng | `localhost:7880/7881/7882/3478` |
| MinIO | Máy/thiết bị khác trong LAN | `http://192.168.50.10:9000` (API), `:9001` (Console) |

Địa chỉ MinIO **không phải** IP của máy chạy Docker/K8s — là 1 máy hoàn toàn khác trong cùng LAN.
Cấu hình biến môi trường cho các service cần MinIO:
```
MINIO_ENDPOINT=192.168.50.10:9000
MINIO_CONSOLE=192.168.50.10:9001
```

**Bug đã gặp — presigned URL luôn trả `https://` dù server chỉ nghe HTTP:** `AWSSDK.S3` (dùng
trong Chat Service) luôn generate `https://` bất kể `AmazonS3Config.UseHttp = true` — phải tự thay
chuỗi `https://` → `http://` sau khi generate (xem `StorageService.cs`).

### 3.1. Nhiều kho lưu trữ — file nhỏ ở nhà, file lớn lên cloud

Băng thông upload của đường truyền nhà là tài nguyên khan hiếm nhất, và **presigned URL không cứu
được nó**: presign chỉ chuyển phần xác thực sang API, còn bytes vẫn đi ra từ MinIO nhà mỗi lần có
người tải về. Cách duy nhất để tiết kiệm băng thông cho một file là bản thân file đó nằm trên cloud.

**Cách giải quyết hiện tại là BÓP TỐC ĐỘ, không phải chặn kích thước.** File lớn vẫn gửi được — chặn
duy nhất là hạn mức của nhóm — nhưng MinIO chỉ được dùng ~4 MB/s nên không cướp hết đường truyền của
các service khác. `HomeMaxBytes = 0` nghĩa là không giới hạn kích thước; đặt > 0 nếu sau này muốn đẩy
file lớn sang `cloud`.

```jsonc
"Storage": {
  "HomeMaxBytes": 0,                 // 0 = khong gioi han, moi file ve "home"
  "MinPresignExpirySeconds": 300,
  "MaxPresignExpirySeconds": 21600,
  "AssumedThroughputBytesPerSec": 524288,
  "Providers": {
    "home":  { "Endpoint": "http://192.168.50.10:9000", "AccessKey": "...", "SecretKey": "...",
               "BucketName": "chat-media", "ForcePathStyle": true },
    "cloud": { "Endpoint": "", "AccessKey": "", "SecretKey": "",
               "BucketName": "chat-media-large", "ForcePathStyle": true, "Region": "auto" }
  }
}
```

MinIO, Cloudflare R2 và AWS S3 đều nói cùng giao thức S3 nên dùng chung `AWSSDK.S3`, chỉ khác
endpoint + credentials. `Region` để trống thì SDK ký bằng `us-east-1` (MinIO không quan tâm); **R2
dùng `auto`**.

**Nên chọn R2 cho tầng cloud, không phải S3:** R2 tính **egress $0**, còn S3 khoảng $0.09/GB đi ra.
Với app chat phục vụ file cho người dùng, egress mới là khoản tiền thật chứ không phải dung lượng lưu.

#### Cổng bóp tốc độ trước MinIO

Trình duyệt PUT/GET **thẳng vào MinIO** bằng presigned URL, không qua Chat Service — nên bóp băng
thông trong service .NET là vô nghĩa. Chỗ chặn duy nhất là trước MinIO: service `minio-gateway`
trong `docker-compose.yml` (nginx), cấu hình ở `minio-gateway.conf`.

**Hai cạm bẫy đã dính thật khi dựng, cả hai đều im lặng:**

| Sai | Triệu chứng | Đúng |
|---|---|---|
| `proxy_set_header Host $host` | **403 SignatureDoesNotMatch** cho mọi request | `$http_host` — `$host` **cắt mất cổng** (`localhost:9000` → `localhost`), mà SigV4 ký Host nguyên văn cả cổng |
| `proxy_buffering off` | `limit_rate` **bị bỏ qua hoàn toàn** — đo được 26 MB/s thay vì 4 | Bỏ dòng đó (mặc định `on`). Rate limit cần nginx giữ dữ liệu lại mới hoãn được |

Cái thứ nhất tôi khoanh vùng bằng cách gửi **cùng một URL** thẳng tới MinIO với `--resolve` mà vẫn
giữ `Host: localhost:9000` → 200; qua nginx → 403. Chữ ký đúng, nginx làm hỏng.

`proxy_request_buffering off` thì **giữ nguyên** — nó là chiều LÊN, khác `proxy_buffering` (chiều
VỀ). Bật chiều lên nghĩa là nginx nuốt cả file 1GB xuống đĩa trước khi đẩy đi.

**Chỉ chiều TẢI VỀ bị nginx bóp** — và đó đúng là chiều đáng lo, vì người khác tải file về chính là
tiêu băng thông *upload* của đường truyền nhà. Chiều đẩy lên nginx không có directive nào giới hạn;
muốn chặn thì dùng `minio-throttle.sh` (`tc` + IFB) trên máy chạy MinIO.

**Hạn presigned URL phải co giãn theo kích thước.** Đây là hỏng hóc do *chính* việc bóp tốc độ gây
ra: hạn cũ cố định 300s an toàn khi file tối đa 20MB, nhưng ở 4 MB/s thì file 1GB cần hàng chục phút
— URL hết hạn giữa chừng. Nay hạn = `size / AssumedThroughputBytesPerSec`, kẹp giữa Min và Max.
`AssumedThroughput` (512 KB/s) đặt **thấp hơn** mức bóp thật có chủ đích, vì băng thông còn chia cho
nhiều người tải cùng lúc.

Đo thật trên file 50MB:

| | Kết quả |
|---|---|
| Tải về qua gateway | **4,21 MB/s** trong 12,4s ✓ |
| Đẩy lên qua gateway | 27 MB/s (đúng — nginx không bóp chiều lên) |
| File 800KB tải về | 22 MB/s (dưới `limit_rate_after 1m` nên miễn bóp) |
| Hạn URL: 5MB / 200MB / 1GB | 300s / 400s / 2048s |
| File 4GB (quá hạn mức 3GB) | `507 storage_quota_exceeded` |

Ba điểm về hành vi, đã verify bằng test:

- **`storage_provider` quyết định một lần lúc upload rồi ghi vào bảng `files`.** Lúc tải về đọc lại
  cột đó, **không** tính lại theo ngưỡng — nhờ vậy đổi `HomeMaxBytes` sau này không làm hỏng file cũ
  (file 30MB đã nằm ở home vẫn tải về từ home).
- **Chưa cấu hình `cloud` thì file lớn vẫn lưu ở `home`** kèm cảnh báo trong log
  (`... vuot nguong ... nhung kho 'cloud' chua cau hinh - tam luu o 'home'`). Từ chối upload sẽ làm
  hỏng một tính năng đang chạy chỉ vì một ô cấu hình chưa điền.
- **File trỏ tới kho không còn cấu hình thì trả `503 storage_unavailable`**, không âm thầm presign
  sang kho khác — làm vậy sẽ trả URL tới object không tồn tại và người dùng nhận 404 khó hiểu.

Hạn mức 2GB/nhóm **không đổi**: trigger `sync_storage_used()` cộng theo `size_bytes` bất kể file nằm
ở kho nào.

Thêm cột cho DB đã có dữ liệu:
```sql
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20) NOT NULL DEFAULT 'home';
```

**`cloud` không gắn với nhà cung cấp nào** — nó chỉ là cái tên. Trỏ sang một **server MinIO thứ hai**
(máy khác trong LAN, hoặc MinIO trên VPS) cũng chạy y hệt, chỉ cần **xoá `Region: "auto"`** vì `auto`
là quy ước riêng của R2; để trống thì SDK ký bằng `us-east-1` mặc định, MinIO chấp nhận.
Muốn dời **toàn bộ** sang máy MinIO khác thì đổi endpoint của `home` — file cũ vẫn ghi
`storage_provider = 'home'` nên tự trỏ theo endpoint mới, miễn `mc mirror` dữ liệu sang trước.

Chọn giữa MinIO-trên-VPS và R2: VPS thường bó băng thông trong giá (vài TB/tháng) rồi bóp tốc độ
hoặc tính thêm khi vượt; R2 egress $0 không trần. File lớn là video nhiều người xem lại → R2 an toàn
hơn về chi phí; đã có sẵn VPS và lưu lượng vừa phải → MinIO trên đó rẻ hơn.

**Hai điều phải xử lý trước khi deploy:**

1. **Mixed content.** Frontend chạy `https://` (qua tunnel) mà presigned URL là `http://` thì trình
   duyệt **chặn thẳng**. Áp cho cả MinIO nhà hiện tại, không riêng kho thứ hai — hiện chưa lộ vì dev
   đang ở `http://localhost:5173`. Lên tunnel thì mọi kho đều phải có TLS.
2. **CORS trên bucket cloud.** Trình duyệt PUT thẳng lên đó nên bucket phải cho phép origin của
   frontend (MinIO mặc định đã cho phép `*`, R2 phải cấu hình).

**Giới hạn hiện tại: đúng hai bậc.** `ResolveProviderForUpload` chỉ chọn giữa `home` và `cloud`.
Phần tải về đọc theo tên ghi trong DB nên provider tên gì cũng chạy, nhưng muốn ba bậc (nhà → MinIO
VPS → R2) thì phải sửa hàm đó.

**Không cần backend nhìn thấy kho lưu trữ.** Presign là phép tính HMAC thuần offline — Chat Service
không bao giờ kết nối tới MinIO/R2 (đã verify: endpoint R2 giả với key bịa vẫn sinh URL hợp lệ,
không có gói tin nào đi ra). Kho chỉ cần **trình duyệt người dùng** với tới được. Mặt trái: cấu hình
sai endpoint **không** báo lỗi lúc khởi động — API vẫn trả URL đẹp, tới lúc client PUT mới hỏng.

**Nếu sau này cần expose Ingress/LiveKit ra LAN** (không chỉ `localhost`): đặt IP tĩnh, mở Windows
Firewall, và quan trọng nhất với LiveKit — quyết định STUN tự dò IP (`use_external_ip: true`, hợp
khi truy cập từ Internet) hay gán thẳng `node_ip` bằng IP LAN (`use_external_ip: false`, hợp khi
chỉ dùng nội bộ LAN — STUN trả IP public Internet khiến client cùng LAN không kết nối được media do
NAT hairpin thường không hoạt động trên router gia đình).

---

## 3.2. CI/CD qua GitHub Actions

**Ràng buộc quyết định kiến trúc:** server nhà sau CGNAT, runner của GitHub **không mở được kết nối
vào**. Nên không dùng được kiểu "Actions SSH vào server rồi deploy". Phải đảo chiều thành mô hình
**KÉO** — cụm k3s tự gọi ra registry.

| File | Chạy khi nào | Việc |
|---|---|---|
| `.github/workflows/ci.yml` | mỗi push/PR | 6 service `dotnet build` + frontend `oxlint`/`tsc`/`vite build` |
| `.github/workflows/release.yml` | push vào `main` | build 7 image, đẩy GHCR, gắn thẻ SHA + `latest` |
| `Tainguyen/infra/k8s/image-watcher.yaml` | CronJob mỗi 2 phút trong k3s | so **digest** `:latest` với ConfigMap, khác thì `rollout restart` |

So **digest** chứ không so thẻ: `:latest` lúc nào cũng là `:latest`, nhìn vào không biết có gì đổi.

Release workflow **không cần khai báo secret nào** — `GITHUB_TOKEN` sẵn quyền `packages: write`.

Chuyển nguồn image bằng một biến trong `gen-manifests.py`:
```python
IMAGE_REGISTRY = ""                        # build cuc bo bang nerdctl
IMAGE_REGISTRY = "ghcr.io/nguyenkhoa1290"  # keo tu GHCR (DANG DUNG), pull policy tu thanh Always
```

### Trạng thái: ĐÃ CHẠY ĐỦ VÒNG

| Mảnh | Trạng thái |
|---|---|
| `ci.yml` | xanh ngay lần chạy đầu |
| `release.yml` | xanh, 7 image đã lên GHCR |
| Deployment trên k3s | kéo từ `ghcr.io/nguyenkhoa1290/...`, `imagePullPolicy: Always` |
| `image-watcher` CronJob | đã bật, ghi được digest cả 7 image |

Vòng lặp: `git push` → Actions build 7 image → đẩy GHCR → CronJob thấy digest mới trong ≤2 phút →
`rollout restart`.

Quay lui thủ công bằng thẻ SHA (release workflow đẩy cả hai thẻ):
```bash
sudo k3s kubectl set image deploy/chat chat=ghcr.io/nguyenkhoa1290/chat-app-chat:<sha> -n chat-app
```

**Chẩn đoán sai đã mắc — GHCR trả 401 KHÔNG có nghĩa là package riêng tư.** Gọi
`https://ghcr.io/v2/<owner>/<image>/tags/list` trần thì luôn 401; registry bắt buộc phải có token
**kể cả token ẩn danh**. Cách kiểm tra đúng là làm y như image-watcher làm:

```bash
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:<owner>/<image>:pull" | jq -r .token)
curl -sI -H "Authorization: Bearer $TOKEN" "https://ghcr.io/v2/<owner>/<image>/manifests/latest"
```

Làm đúng cách thì ra **200** — package kéo được ẩn danh, **không cần tạo `imagePullSecret`**. Đã
kiểm chứng thêm bằng `nerdctl pull` thật trên máy, không đăng nhập.

### Lỗi chặn đường: 5/6 service KHÔNG có `appsettings.json` trong git

`.gitignore` chặn `appsettings.json`, nhưng chỉ Identity trót commit trước khi có luật đó nên vẫn
được theo dõi. Năm service còn lại chỉ có file `.example`.

Hệ quả: **image build từ GitHub Actions sẽ thiếu hoàn toàn cấu hình** cho 5 service đó — Chat chết
ngay lúc khởi động vì `StorageService` không thấy kho `home`. Image build tại máy thì chạy bình
thường vì nó gói kèm file trên đĩa. Đây là lỗi chỉ lộ ra lúc deploy, không lộ lúc build.

**Sửa gốc — tách bí mật khỏi cấu hình:**

| | Trước | Sau |
|---|---|---|
| `appsettings.json` ×6 | chứa bí mật → không commit được | giữ cấu trúc + giá trị không nhạy cảm, **13 khoá bí mật để trống** → commit được |
| `docker-compose.yml` | nhúng sẵn 8 mật khẩu | đọc `${VAR}` từ `.env` |
| `gen-manifests.py` | nhúng sẵn mật khẩu DB | đọc `secrets.env`, sinh Secret `app-secrets` |
| Bí mật thật | rải rác | `secrets.env` + `.env` (cả hai đã gitignore) |

Service nạp bí mật bằng `envFrom: secretRef: app-secrets`, không còn nằm trong env của Deployment —
nhờ vậy `all.yaml` sinh ra cũng không lộ khi lỡ commit (dù đã gitignore luôn cho chắc).

**Verify:** build lại cả 6 service với `appsettings.json` đã bỏ trống, rồi chạy luồng thật *đăng ký →
tạo nhóm → xin URL upload*. Presign trả về URL ký bằng `minioadmin` lấy **từ Secret**. Nếu `envFrom`
hỏng thì Chat đã chết lúc khởi động chứ không tới được bước này.

**Còn nợ:** bí mật cũ vẫn nằm trong **lịch sử git** của repo công khai — Gmail App Password và JWT
SigningKey. Việc tách này chỉ chặn rò rỉ *từ nay*; thứ đã public phải **thu hồi và cấp lại**.

---

## 4. Đóng gói & đẩy image lên GHCR

Áp dụng cho **mọi service** (Identity/WorkSpace/Chat/SpamTracking/Admin/Media) — quy trình chuẩn
dùng lại, không làm riêng lẻ từng lần. Dùng **GitHub Container Registry** (`ghcr.io`) — miễn phí,
không giới hạn số repo private.

### 4.1 Tạo Personal Access Token (làm 1 lần)

GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → scope tối
thiểu `write:packages` (kèm `read:packages`):
```bash
echo "<PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

### 4.2 Build + tag + push (mỗi lần cập nhật code)

```bash
cd IdentityService/src/IdentityService.Api
docker build -t ghcr.io/<github-username>/identity-service:latest .
docker tag ghcr.io/<github-username>/identity-service:latest ghcr.io/<github-username>/identity-service:v0.1.0
docker push ghcr.io/<github-username>/identity-service:latest
docker push ghcr.io/<github-username>/identity-service:v0.1.0
```

### 4.3 Bảng tổng hợp cả 6 service

Toàn bộ service dùng CHUNG `Jwt:SigningKey`/`Issuer`/`Audience` (JWT do Identity Service phát
hành). Cột "Gọi nội bộ tới" dùng biến `*Client__BaseUrl` trỏ DNS nội bộ K8s
`http://<service>.<namespace>.svc.cluster.local` khi cùng 1 cluster thật (server nhà).

| Service | Thư mục | Image | Namespace | Container port | CSDL | Gọi nội bộ tới |
|---|---|---|---|---|---|---|
| Identity | `IdentityService/src/IdentityService.Api` | `identity-service` | `identity-service` | 8080 | `identity-db` / 5432 | — |
| WorkSpace | `WorkspaceService/src/WorkspaceService.Api` | `workspace-service` | `workspace-service` | 8080 | `workspace-db` / 5432 | Identity, Chat |
| Chat | `ChatService/src/ChatService.Api` | `chat-service` | `chat-service` | 8080 | `chat-db` / 5432 | Identity (qua WorkSpace), WorkSpace |
| SpamTracking | `SpamTrackingService/src/SpamTrackingService.Api` | `spamtracking-service` | `spamtracking-service` | 8080 | `spamtracking-db` / 5432 | Identity |
| Admin | `AdminService/src/AdminService.Api` | `admin-service` | `admin-service` | 8080 | *(không có DB riêng)* | Identity, SpamTracking, Chat, K8s API |
| Media | `MediaService/src/MediaService.Api` | `media-service` | `media-service` | 8080 | `media-db` / 5432, `miniapp-db` / 5432 | Identity, Chat, LiveKit |

Script build + push toàn bộ 6 image trong 1 lệnh (chạy từ thư mục gốc repo):
```bash
GH_USER=<github-username>
for svc in IdentityService:identity-service WorkspaceService:workspace-service \
           ChatService:chat-service SpamTrackingService:spamtracking-service \
           AdminService:admin-service MediaService:media-service; do
  dir="${svc%%:*}"; name="${svc##*:}"
  proj_dir=$(find "$dir/src" -maxdepth 1 -type d -name "*.Api")
  docker build -t "ghcr.io/$GH_USER/$name:latest" "$proj_dir"
  docker push "ghcr.io/$GH_USER/$name:latest"
done
```

**Riêng Admin Service:** cần `ServiceAccount`/`ClusterRoleBinding` từ
`Tainguyen/infra/adminservice-rbac.yaml` (2 quyền tách biệt: đọc tài nguyên và patch scale) — gắn
`serviceAccountName: admin-service` vào `Deployment`, KHÔNG dùng service account mặc định (không
có quyền gì trên `pods`/`nodes`/`metrics.k8s.io`).

### 4.4 Cho server nhà (k3s) pull image private

Package GHCR mặc định **private** — cần secret để pull:
```bash
kubectl create secret docker-registry ghcr-pull-secret \
  -n identity-service \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<PAT> \
  --docker-email=<email-bat-ky>
```
Hoặc đơn giản hơn: đổi package sang **Public** (Package settings → Change visibility) — chấp nhận
được cho dự án cá nhân (secret thật nằm ở biến môi trường/K8s Secret riêng, không nằm trong image),
bỏ được bước tạo `ghcr-pull-secret`.

### 4.5 Deployment manifest tham khảo (Identity Service)

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: identity-service
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: identity-service
  namespace: identity-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: identity-service
  template:
    metadata:
      labels:
        app: identity-service
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret   # bo neu da doi package sang Public
      containers:
        - name: identity-service
          image: ghcr.io/<github-username>/identity-service:v0.1.0
          ports:
            - containerPort: 8080
          envFrom:
            - secretRef:
                name: identity-service-secrets
          env:
            - name: ConnectionStrings__IdentityDb
              value: "Host=identity-db.identity-db.svc.cluster.local;Port=5432;Database=identity;Username=identity_admin;Password=$(DB_PASSWORD)"
          resources:
            requests:
              memory: 128Mi
              cpu: 100m
            limits:
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: identity-service
  namespace: identity-service
spec:
  type: ClusterIP
  selector:
    app: identity-service
  ports:
    - port: 80
      targetPort: 8080
```

Địa chỉ DB dùng **DNS nội bộ K8s** (`identity-db.identity-db.svc.cluster.local`) — trên server nhà
(1 cluster k3s duy nhất), Service và DB cùng cluster, không cần qua NodePort/IP node như lúc dev
nhiều cluster.

Tạo Secret chứa mật khẩu DB + JWT signing key thật (KHÔNG hardcode trong manifest):
```bash
kubectl create secret generic identity-service-secrets -n identity-service \
  --from-literal=DB_PASSWORD="<mat-khau-that>" \
  --from-literal=Jwt__SigningKey="<jwt-key-that>"
```

Ingress rule (khi sẵn sàng expose ra ngoài):
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: identity-service
  namespace: identity-service
spec:
  ingressClassName: nginx
  rules:
    - http:
        paths:
          - path: /identity
            pathType: Prefix
            backend:
              service:
                name: identity-service
                port:
                  number: 80
```

---

## 5. Deploy lên server nhà (k3s thật)

Chuyển từ môi trường dev (Docker Desktop K8s + nhiều cluster `kind`) sang **1 cluster K8s thật
(k3s)** chạy trên server nhà — máy chủ vật lý riêng, hoạt động 24/7.

**Vì sao k3s thay vì Docker Desktop K8s:** toàn bộ "cạm bẫy" ở Docker Desktop (NodePort không tự
forward ra `localhost`, `podHostNetwork` không hoạt động...) là giới hạn riêng của Docker Desktop —
chỉ định hướng dev/test 1-node. k3s là K8s **thật, đầy đủ tính năng, nhẹ**, dùng phổ biến cho
production/home-lab, hành xử đúng chuẩn K8s.

**Vì sao 1 cluster (không tách 3 như máy dev):** tách 3 cluster `kind` là workaround riêng vì Docker
Desktop chỉ cho 1 cluster. Trên k3s thật dùng đúng cách K8s thiết kế: 1 cluster, nhiều namespace, cô
lập bằng `ResourceQuota`/`LimitRange`, cô lập theo node (nếu thêm node) bằng `nodeSelector`/`taints`.

### 5.0 Đã triển khai thật — máy Ubuntu, KHÔNG qua WSL2

Server nhà là **máy Ubuntu 22.04 thật** (laptop, 8 nhân, 7,2 GB RAM, 197 GB trống), truy cập qua
cloudflared tunnel cổng 2222. Nên **toàn bộ mục 5.1 bên dưới không áp dụng** — WSL2 chỉ cần khi server
là máy Windows. Giữ lại phòng khi đổi máy.

**Quy trình đã chạy thật:**

```bash
# 1. Docker (de build image; k3s dung containerd rieng)
curl -fsSL https://get.docker.com | sh && usermod -aG docker nguyenkhoa

# 2. k3s
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644" sh -

# 3. Build image roi NAP sang containerd cua k3s
docker build -t chat-app-identity ./IdentityService/src/IdentityService.Api
docker save chat-app-identity:latest | sudo k3s ctr images import -   # lap cho 7 image

# 4. ConfigMap script init + Secret LiveKit
kubectl create configmap identity-db-init -n chat-data --from-file=init.sql=Tainguyen/infra/identity-db-init.sql
kubectl create secret generic livekit-credentials -n chat-app --from-literal=LiveKit__ApiKey=...

# 5. Ap manifest
kubectl apply -f Tainguyen/infra/k8s/all.yaml
```

**Manifest sinh bằng script, không gõ tay:** `Tainguyen/infra/k8s/gen-manifests.py` → `all.yaml`
(62 tài nguyên). 6 Postgres chỉ khác tên/mật khẩu, 6 service .NET chỉ khác biến môi trường — gõ tay
kiểu gì cũng có một chỗ sai chính tả mà không ai phát hiện.

**Hai namespace** để áp được ResourceQuota 60/30/10 (mục 5.4): `chat-data` (6 DB + Redis + Kafka +
RabbitMQ + MinIO) và `chat-app` (6 service + frontend).

#### Xoay vòng toàn bộ bí mật (sau khi phát hiện rò rỉ trên repo công khai)

Repo `SocialInteractiveApp` là **public** và 4 commit đầu đã chứa bí mật. Tách bí mật khỏi cấu hình
chỉ chặn rò rỉ *từ nay*; thứ đã public phải **thu hồi và cấp lại**. Đã đổi toàn bộ:

| Bí mật | Cũ | Mới |
|---|---|---|
| Gmail App Password | đã lộ 16 ký tự | key mới do người dùng cấp |
| JWT SigningKey | chuỗi cũ trong git | **64 byte ngẫu nhiên** (`secrets.token_bytes(64)` → base64, 88 ký tự) |
| 6 mật khẩu Postgres | 6 chuỗi hex ngẫu nhiên | một mật khẩu chung do người vận hành chọn |
| RabbitMQ `admin` | hex đã lộ | như trên |
| Redis | hex đã lộ | như trên |
| MinIO root | **`minioadmin/minioadmin`** — mặc định của phần mềm | `chatapp_admin` + mật khẩu mới |

Khoá ký JWT **không dùng chung** mật khẩu đó: không ai phải gõ tay nó nên không cần dễ nhớ, mà đoán
được là tự ký được token `role: admin`.

**Thứ tự bắt buộc** — làm ngược là service mất kết nối giữa chừng:

1. Đổi mật khẩu **bên trong dịch vụ** trước: `ALTER USER ... WITH PASSWORD` ×6, `rabbitmqctl change_password`
2. Cập nhật `secrets.env` + `.env`, sinh lại `all.yaml`
3. `kubectl apply` → Secret mới
4. Restart **Redis và MinIO** (mật khẩu nằm trong tham số khởi động, không đọc lại lúc chạy)
5. Rollout 6 service để nạp Secret mới

**Ba chỗ vấp thật:**

- **Bỏ sót chuỗi kết nối trong phần `SERVICES`.** Chỉ thay mật khẩu ở bảng `DBS` (dùng cho Secret của
  Postgres) mà quên `ConnectionStrings__*Db` trong env của Deployment → `kubectl apply` báo
  `deployment unchanged`, service vẫn dùng mật khẩu cũ và đăng ký hỏng. **`unchanged` là tín hiệu
  cảnh báo, không phải tin tốt** khi mình vừa định đổi thứ gì đó.
- **Kiểm chứng sai bằng loopback.** `psql -h 127.0.0.1` bên trong pod Postgres luôn thành công bất kể
  mật khẩu, vì `pg_hba.conf` có dòng `host all all 127.0.0.1/32 trust`. Luật thật áp cho service là
  dòng cuối `host all all all scram-sha-256`. Muốn kiểm chứng phải đi **từ pod khác**, hoặc đơn giản
  là xem service có kết nối được không.
- **`rollout status` hết giờ không có nghĩa là hỏng.** Hai lần lệnh chờ báo timeout trong khi
  deployment vẫn hoàn tất vài chục giây sau. Kiểm tra lại pod trước khi kết luận.

**Verify sau khi đổi:** đăng ký mới → 201 (Postgres + Kafka + Redis), token JWT mới dùng được ở
WorkSpace (200) và Media (201 tạo phòng trên LiveKit Cloud), presign ký bằng `chatapp_admin`. Mật khẩu
RabbitMQ cũ bị từ chối (`authenticate_user` → exit 65).

#### Đưa dịch vụ ra Internet qua cloudflared (vượt CGNAT)

Máy nhà không có IP public, nhưng cloudflared chỉ cần kết nối **đi ra** nên vẫn public hoá được.
Tunnel có tên sẵn (`e1f67fd0-...`), tên miền `callimeet.com`, cấu hình ở `/etc/cloudflared/config.yml`.

Thêm một dịch vụ = thêm một mục `ingress` + một bản ghi CNAME:

```yaml
  - hostname: dashboard.callimeet.com
    service: https://localhost:9443
    originRequest:
      noTLSVerify: true        # Portainer dung chung chi TU KY
```

```bash
# cert.pem nam o home cua user, chay sudo thi phai chi duong
sudo cloudflared --origincert /home/nguyenkhoa/.cloudflared/cert.pem   tunnel route dns <tunnel-id> dashboard.callimeet.com
sudo cloudflared --config /etc/cloudflared/config.yml   --origincert /home/nguyenkhoa/.cloudflared/cert.pem tunnel ingress validate
sudo systemctl restart cloudflared
```

**Ba điều bắt buộc:**

- **`noTLSVerify: true`** khi origin dùng chứng chỉ tự ký. Thiếu là cloudflared trả **502**. Phần tự
  ký chỉ tồn tại ở chặng tunnel → máy; người dùng vẫn nhận chứng chỉ hợp lệ của Cloudflare.
- **`http_status:404` phải nằm CUỐI.** cloudflared xét ingress theo thứ tự trên xuống; đặt nhầm lên
  trước là nuốt hết hostname phía dưới.
- **Sao lưu + `tunnel ingress validate` trước khi restart** — sai cú pháp là mất luôn cả route `ssh`
  đang dùng để quản trị máy.

Kết quả: `https://dashboard.callimeet.com` → **200** từ Internet.

#### ĐÃ ĐƯA TOÀN BỘ HỆ THỐNG RA INTERNET

Frontend ở domain gốc, mỗi service một subdomain. **10/10 tên miền trả 200 từ Internet.**

| Tên miền | Đích | Cổng |
|---|---|---|
| `callimeet.com` | Frontend | 80 |
| `identity.` `workspace.` `chat.` `media.` `admin.` | 5 API service | 5194 / 5153 / 5261 / 5300 / 5230 |
| `files.` | MinIO gateway (có bóp tốc độ) | 9000 |
| `minio.` `rabbit.` `dashboard.` | MinIO Console · RabbitMQ Mgmt · Portainer | 9001 / 15672 / 9443 |

SpamTracking **không mở** — frontend không gọi nó bao giờ, Admin gọi qua tên container trong cụm.
AMQP (5672), Postgres, Redis, Kafka đều giữ ClusterIP.

**Ba thứ phải đổi cùng lúc, thiếu một là hỏng:**

1. **Build lại frontend** với `https://<sub>.<domain>` — Vite nhúng URL lúc build. Không build lại thì
   trình duyệt vẫn gọi IP LAN, người ngoài mạng không tới được **và** bị chặn mixed content.
2. **CORS** thêm origin `https://callimeet.com` (giữ luôn `http://<IP LAN>` để mở bằng IP vẫn chạy).
3. **`Storage:Providers:home:Endpoint`** → `https://files.<domain>`. Chữ ký S3 gắn với hostname; may là
   cloudflared giữ nguyên header Host và nginx chuyển tiếp bằng `$http_host` nên chữ ký khớp.

**Ba lỗi đã dính:**

| Lỗi | Triệu chứng | Nguyên nhân |
|---|---|---|
| **Quên restart cloudflared** | cả 9 tên miền mới trả **404**, riêng `dashboard` cũ vẫn 200 | Tạo DNS + sửa config nhưng không `systemctl restart` → tunnel vẫn chạy cấu hình cũ, mọi hostname mới rơi vào luật catch-all 404 |
| **`imagePullPolicy: Always` ghi đè bản build tại chỗ** | bundle vẫn nhúng IP LAN dù vừa build lại | Build local rồi gắn thẻ `:latest` là vô nghĩa — k8s kéo bản **cũ** từ GHCR đè lên. Phải hoặc đẩy lên registry, hoặc dùng thẻ riêng + `Never` |
| **Quên Job tạo bucket khi chuyển sang k3s** | presign trả URL bình thường nhưng PUT thật **404** | Bản Compose có `minio-init`, bản k3s bỏ quên. Presign là phép tính offline nên **không** kiểm tra bucket có tồn tại — lỗi chỉ lộ khi upload thật |

**Verify end-to-end qua Internet:** đăng ký → tạo nhóm (201) → xin URL upload → **PUT 200** → tải về
**GET 200**, nội dung khớp bit-by-bit. CORS preflight trả 204 kèm đúng origin.

#### Đã GỠ HẲN Docker khỏi server — chỉ còn containerd của k3s

Sau khi k3s chạy ổn, Docker chỉ còn gánh hai việc: chạy Portainer, và build image. Thay cả hai rồi gỡ:

| Việc | Trước | Sau |
|---|---|---|
| Chạy Portainer | container Docker | **Deployment trong k3s** (namespace `portainer`), quản lý cụm trực tiếp — không cần agent nữa |
| Build image | `docker build` rồi `docker save \| k3s ctr images import -` | **`nerdctl build` thẳng vào containerd của k3s** — bỏ hẳn bước import |

```bash
# Cai (ban "full" gom san buildkit)
curl -sfL -o nerdctl.tgz https://github.com/containerd/nerdctl/releases/download/vX.Y.Z/nerdctl-full-X.Y.Z-linux-amd64.tar.gz
sudo tar Cxzf /usr/local nerdctl.tgz && sudo systemctl enable --now buildkit

# Build - PHAI tro dung socket va namespace cua k3s
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io   build -t chat-app-chat:latest ./ChatService/src/ChatService.Api
sudo k3s kubectl rollout restart deploy chat -n chat-app
```

**Bắt buộc có `--address` và `--namespace k8s.io`.** Thiếu thì nerdctl build vào containerd khác
(namespace `default`) và k3s **không nhìn thấy image** — pod sẽ `ErrImageNeverPull` dù `nerdctl images`
liệt kê ra bình thường.

**Hai chỗ vấp khi gỡ:**

- **`apt autoremove` dọn mất `pigz`.** buildkit gọi `/usr/bin/unpigz` để giải nén layer, thiếu là
  build chết với `failed to get stream processor ... no such file or directory`. Cài lại: `apt install pigz`.
- **Portainer trong k3s mặc định xin cả cổng 9000**, mà `minio-gateway` đang giữ cổng đó → xung đột
  hệt vụ Traefik/80. Patch Service chỉ giữ 9443.

Kết quả sau khi gỡ: 9/9 endpoint trả 200, 0 pod lỗi, RAM **2795 MB** (giảm từ 3114), đĩa thêm 3 GB.

#### Bốn lỗi đã dính khi chuyển sang k3s

| Lỗi | Triệu chứng | Nguyên nhân |
|---|---|---|
| **ResourceQuota thiếu 68Mi** | `deployment/minio` báo *created* nhưng **không có pod nào** | Tổng limit tầng data = 4164Mi, quota đặt 4Gi = 4096Mi. Pod bị từ chối tạo (`ReplicaFailure/FailedCreate`) — deployment vẫn báo tạo thành công nên rất dễ tưởng đã chạy. Nâng lên 4608Mi |
| **Traefik giữ cổng 80** | frontend trả **404** | k3s cài sẵn Traefik, svclb của nó đã bind hostPort 80 → `frontend-lb` kẹt `EXTERNAL-IP <pending>` vĩnh viễn. Sửa: cho frontend đi qua **Ingress** thay vì tranh cổng |
| **Probe RabbitMQ timeout** | pod mãi không `Ready` | `timeoutSeconds` mặc định là **1s**, mà `rabbitmq-diagnostics ping` cần vài giây. Đặt 15s |
| **Lệch namespace** | nút scale báo không tìm thấy deployment | `ScaleDeploymentAsync` hardcode `"default"`, còn ServiceAccount trong `adminservice-rbac.yaml` cũng ở `default`. Thêm `K8sOptions.Namespace` đọc từ cấu hình, RBAC chuyển sang `chat-app` |

#### Giữ đúng số cổng bằng ServiceLB

k3s có ServiceLB (klipper): Service `type: LoadBalancer` **bind thẳng cổng đó trên node**, không bị
giới hạn dải NodePort 30000-32767. Nhờ vậy giữ nguyên 5194/5153/5261/5230/5300/5160/9000 — **bắt
buộc**, vì bundle frontend đã nhúng sẵn `http://<host>:5194` từ lúc build (Vite nhúng biến `VITE_*`
lúc build, không đọc lúc chạy).

#### Kết quả kiểm thử trên k3s — 8/8

| | |
|---|---|
| 6 service `/health` | 200 |
| Frontend qua Traefik | 200 |
| MinIO qua cổng bóp tốc độ | 200 |
| Đăng ký / đăng nhập | 201 (1,93s) / 200 |
| Media → LiveKit Cloud | 201 |
| CORS | đúng header |
| **`GET /admin/system/resources`** | **200 — đọc 32 pod + 1 node, CPU/RAM thật** |
| **`POST .../services/chat/scale`** | **202, deployment lên 2 bản thật** |

Hai dòng cuối là thứ bản Docker Compose **không** làm được — cũng là lý do chính để dùng k3s.

Tài nguyên sau khi chạy đủ 18 pod: **3114 MB / 7382 MB**, đĩa còn 186 GB. Đã xoá tàn dư bản Compose
(10 volume + 7 image, thu hồi 1,66 GB).

### 5.1 Cài WSL2 + Ubuntu *(chỉ khi server là máy Windows)*

```powershell
# PowerShell voi quyen Administrator
wsl --install -d Ubuntu-22.04
```

**Bật `mirrored` networking mode** (WSL 0.67+) để service trong WSL2 truy cập trực tiếp qua IP LAN
server, không bị NAT 2 lớp. Tạo/sửa `C:\Users\<user>\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
`wsl --shutdown` rồi mở lại Ubuntu. Verify: `ip addr` phải thấy IP LAN thật của server.

### 5.2 Cài k3s

```bash
curl -sfL https://get.k3s.io | sh -
sudo systemctl status k3s   # active (running)
```

Lấy kubeconfig để quản lý từ xa:
```bash
sudo cat /etc/rancher/k3s/k3s.yaml
```
Sửa `server: https://127.0.0.1:6443` thành `server: https://<IP-LAN-server-nha>:6443`, gộp vào
`kubectl config` hiện có (context riêng `home-server-k3s`).

**k3s có sẵn Metrics Server** (khác Docker Desktop phải cài tay) — verify: `kubectl top nodes`.

### 5.3 Deploy lại các thành phần

Copy `Tainguyen/infra/` sang server (hoặc chạy `kubectl`/`helm` từ xa trỏ context `home-server-k3s`).

**Ingress-Nginx:**
```bash
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.ingressClassResource.default=true
```
k3s có sẵn **ServiceLB** (klipper-lb) — tự bind `LoadBalancer` vào IP thật của node, truy cập ngay
từ LAN qua `http://<IP-server-nha>/`.

**Từng DB** (lặp lại pattern mục 2.2 cho đủ 6 DB): có thể đổi `type: LoadBalancer` thành `NodePort`
trong `*-db.yaml` nếu muốn — trên k3s **cả 2 loại đều hoạt động đúng chuẩn** (khác Docker Desktop).

**LiveKit — KHÔNG deploy ở đây:** chạy trên VPS riêng, xem mục 6.

**Redis + Kafka + RabbitMQ:**
```bash
kubectl apply -f redis.yaml
kubectl apply -f kafka.yaml   # SUA truoc - xem duoi
kubectl apply -f rabbitmq.yaml
```
**Phải sửa `kafka.yaml` trước khi apply:** `KAFKA_ADVERTISED_LISTENERS` đang trỏ IP container Docker
network `kind` (không tồn tại trên server nhà) — đổi thành IP LAN thật + NodePort:
```yaml
- name: KAFKA_ADVERTISED_LISTENERS
  value: "PLAINTEXT://<IP-LAN-server-nha>:30909"
```

**MinIO:** giữ nguyên như đang làm — cài trực tiếp OS, không qua K8s (mục 3).

### 5.4 Chia tài nguyên: 60% Database / 30% Service / 10% dự trữ hệ thống

**Lý do:** Database không scale ngang được (1 instance/DB) — cần tài nguyên đủ lớn, cố định, ổn
định. Service là stateless, tự scale ngang bằng HPA — chỉ cần đủ tài nguyên nền. 10% còn lại dành
cho hệ thống K8s (kube-system, Ingress-Nginx, Metrics Server) — hết sạch tài nguyên node sẽ không
ổn định (kể cả crash kube-scheduler như đã gặp ở máy dev khi thiếu RAM).

Đo tổng tài nguyên node trước:
```bash
kubectl describe node <ten-node> | grep -A 5 "Allocatable"
# hoac
kubectl top nodes
```
Ví dụ node 16 core / 32Gi RAM: Database 60% → `9500m` CPU / `19Gi` RAM; Service 30% → `4800m` CPU /
`9Gi` RAM; còn lại ~10% không cấp quota, để trống cho hệ thống.

Áp `ResourceQuota` riêng cho từng namespace (K8s không có "namespace nhóm" thật sự):
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
  namespace: identity-service
spec:
  hard:
    requests.cpu: "4800m"
    requests.memory: "9Gi"
    limits.cpu: "4800m"
    limits.memory: "9Gi"
```
Khi thêm DB/Service khác, **chia nhỏ tiếp trong đúng ngân sách 60%/30%** — không phải mỗi cái lại
được thêm 60% mới.

HPA cho Service (nằm trong quota, không vượt):
```bash
kubectl autoscale deployment chat-service -n chat-service --cpu-percent=70 --min=1 --max=5
```
HPA tự tăng replica khi tải cao, bị chặn cứng bởi `ResourceQuota` — không vượt quá 30% tổng tài
nguyên node dành cho nhóm Service.

### 5.5 Backup định kỳ lên S3 (dự phòng, chưa triển khai)

Ý tưởng: `CronJob` trong cluster chạy `pg_dump` (từng DB) + `mc mirror` (MinIO) định kỳ, đẩy lên 1
S3 bucket. Chi phí gần như chỉ tính dung lượng lưu trữ, không cần EC2/compute chạy thường trực.

---

## 6. LiveKit — chạy trên cloud

LiveKit **không** chạy trên server nhà — server nhà bị NAT (không IP public thật), trong khi LiveKit
(WebRTC/TURN) cần IP public thật để client ngoài mạng kết nối media ổn định.

### 6.0 Quyết định: dùng LiveKit Cloud (managed), không tự dựng

**Đã chốt.** Mọi thứ còn lại (6 service + 5 DB + Redis/Kafka/RabbitMQ + MinIO) chạy ở server nhà và
tunnel ra; riêng LiveKit dùng dịch vụ managed của LiveKit.

Lý do — không phải "cloud tiện hơn" mà là tự dựng **không chạy được ở nhà**:

| Rào cản | Vì sao chặn cứng |
|---|---|
| **CGNAT** | Phần lớn Internet gia đình VN không có IP public riêng → không port-forward được dải UDP 50000-60000. Không phải khó, là không thể |
| **TURN qua 443** | Người dùng sau firewall công ty chỉ ra được 443 → cần domain thật + cert Let's Encrypt (xem `livekit-values-vps.yaml`) |
| **Băng thông upload** | SFU phát lại mọi luồng: phòng 5 người 720p ≈ 30 Mbps upload từ server. Mạng nhà gánh 1-2 phòng là hết |

**Mô hình tính tiền của LiveKit Cloud đúng thứ dự án cần**: theo participant-minute + băng thông,
idle = 0đ, có free tier. Hạn mức cụ thể xem trang pricing lúc đăng ký (họ đổi theo thời gian).

**Đổi sang Cloud không cần sửa dòng code nào** — chỉ 4 giá trị cấu hình của Media Service:
```
LiveKit__ServerUrl = https://<project>.livekit.cloud
LiveKit__ClientUrl = wss://<project>.livekit.cloud
LiveKit__ApiKey / LiveKit__ApiSecret
```
Vì `LiveKitService` đọc URL/key từ options, `RoomServiceClient` của SDK .NET gọi Cloud bằng đúng API
như self-hosted, và **Frontend không hardcode URL** — nó nhận `livekitUrl` trong response mỗi lần
join (`MediaDtos.cs`, `JoinResultResponse`). Khớp đúng đặc tả: *"client kết nối trực tiếp tới LiveKit
Service cho luồng audio/video — không đi qua Media Service backend, Media Service chỉ cấp token"*,
nên media ở cloud còn API/DB ở nhà là kiến trúc hợp lệ, không phải chắp vá.

**Đã cân nhắc và loại — tự dựng scale-to-zero trên AWS:**

| Dịch vụ | Vì sao không |
|---|---|
| Lambda | Không nhận UDP vào, tối đa 15 phút, không giữ kết nối lâu |
| App Runner | Chỉ HTTP, không có UDP |
| ECS Fargate | Về lý thuyết được (task = 0 khi rảnh) nhưng: cold start 60-90s ngay tại lúc bấm "mở phòng"; IP đổi mỗi lần bật nên phải cập nhật Route53 mỗi lần, hoặc dùng NLB — mà NLB tốn tiền cả khi rảnh, mất luôn ý nghĩa scale-to-zero |

Tức là bỏ công xây trên AWS để có bản kém hơn thứ Cloud cho sẵn. Chỉ nên xét lại nếu có credit AWS
chưa tiêu. Kiến trúc app **không cản** hướng này (endpoint động đã hỗ trợ sẵn) — vướng ở vận hành.

**Cạm bẫy cần nhớ khi tới lúc dùng webhook:** hiện Media Service dựa vào `ListRooms` polling
(`LiveKitService.RoomExistsAsync`), chạy tốt với Cloud. Nếu sau này dùng LiveKit webhook
(`room_finished`...), Cloud phải gọi **ngược** về server nhà → lại cần public URL/tunnel cho riêng
đường đó.

Dự án không dùng Egress/recording nên không phát sinh khoản tốn tiền nhất của LiveKit Cloud.

**ĐÃ ĐẤU NỐI XONG (verify thật).** Project `chatapp-jam7t3bu`. Cấu hình đọc từ file `.env` ở thư mục
gốc chứ **không** sửa thẳng `docker-compose.yml` — file compose được git theo dõi, nhét secret vào đó
là commit lên repo. `.gitignore` có dòng `/.env` (dấu `/` ở đầu để không đụng `Frontend/.env` vốn
không chứa secret). Mẫu ở `.env.example`; **không tạo `.env` thì mọi thứ vẫn chạy với LiveKit nội bộ**
nhờ giá trị mặc định `${VAR:-...}` trong compose.

```ini
LIVEKIT_SERVER_URL=https://<project>.livekit.cloud   # backend goi Server API
LIVEKIT_CLIENT_URL=wss://<project>.livekit.cloud     # tra ve cho trinh duyet
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
```

Đổi xong chỉ cần `docker compose up -d media` — **không build lại image, không sửa dòng code nào**,
đúng như dự đoán ở đầu mục này.

Kết quả kiểm thử:

| Bước | Kết quả |
|---|---|
| `POST /meetings` (gọi `CreateRoom` sang Cloud) | 201 |
| `POST /meetings/{id}/join` | `livekitUrl = wss://chatapp-jam7t3bu.livekit.cloud`, token `iss` = đúng API key, room `meeting-27` |
| Hỏi thẳng Cloud bằng `livekit-cli room list` | thấy `meeting-27`, RoomID `RM_wAm9B8wSTwz6` |
| `POST /meetings/{id}/end` (gọi `DeleteRoom`) | 204, phòng biến mất khỏi Cloud |

**Lưu ý khi kiểm chứng:** `room list` của Cloud có **độ trễ đồng bộ vài giây** — ngay sau `DeleteRoom`
phòng vẫn còn trong danh sách. Đừng vội kết luận xoá hỏng; đợi vài giây rồi liệt kê lại.

---

### Phương án dự phòng — LiveKit trên VPS riêng

Phần 6.1-6.5 dưới đây **không còn là đường chính**, giữ lại phòng khi cần tự chủ hoàn toàn (ví dụ
yêu cầu dữ liệu không ra khỏi hạ tầng của mình). VPS giá rẻ có sẵn IP public là cách đơn giản nhất
để tự dựng, tránh vật lộn port-forward/NAT hairpin/CGNAT.

### 6.1 Chọn VPS

Tối thiểu: 2 vCPU, 4GB RAM, **IP public thật**. Gợi ý: DigitalOcean, Vultr, Linode (hoặc AWS EC2 —
xem mục 7 nếu muốn gộp chung với node burst).

Mở Firewall VPS:
- TCP 80, 443 (nếu dùng domain + TLS)
- TCP 7880 (HTTP/WebSocket API), TCP 7881 (RTC TCP fallback)
- UDP 50000-60000 (dải ICE — VPS có IP public thật nên dùng được dải gốc, không cần workaround
  UDP-mux-1-cổng như lúc dev)
- UDP 3478 (TURN), TCP 5349 (TURN over TLS, nếu bật)

### 6.2 Cài đặt — 2 cách

**Cách A — k3s (đồng bộ pattern server nhà):**
```bash
curl -sfL https://get.k3s.io | sh -
helm repo add livekit https://helm.livekit.io
helm install livekit livekit/livekit-server -n livekit --create-namespace -f livekit-values-vps.yaml
```

**Cách B — Docker Compose thuần (đơn giản hơn cho 1 VM):**
```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    network_mode: host
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
```
Cả 2 cách dùng `podHostNetwork: true`/`network_mode: host` đúng khuyến nghị LiveKit — **VPS có IP
public thật nên không dính giới hạn đã gặp trên Docker Desktop**.

### 6.3 Cấu hình `livekit-values-vps.yaml`

```yaml
podHostNetwork: true   # hoat dong dung tren VPS (khac Docker Desktop)

livekit:
  keys:
    <api-key-moi>: <api-secret-moi>   # SINH LAI, khong dung key demo dev
  rtc:
    tcp_port: 7881
    port_range_start: 50000
    port_range_end: 60000
    use_external_ip: true
  turn:
    enabled: true
    domain: turn.<domain-cua-ban>.com
    tls_port: 5349
    udp_port: 3478

loadBalancer:
  type: disable
```
Khác máy dev: có thể bật **TURN qua TLS thật** vì giờ có domain + cert Let's Encrypt qua ACME thật.

### 6.4 Trỏ Media Service vào LiveKit VPS

`LiveKit:ServerUrl`/`LiveKit:ClientUrl` trỏ vào `https://<domain-hoac-IP-VPS>:7880` — khác các thành
phần khác (Redis/Kafka/Identity DB) nằm cùng server nhà gọi qua IP LAN, LiveKit giờ ở ngoài Internet
gọi qua domain/IP public + bảo vệ bằng API key/secret của chính nó.

### 6.5 Checklist

- [ ] VPS tạo xong, có IP public, ghi lại IP/domain
- [ ] Firewall VPS mở đủ port (mục 6.1)
- [ ] LiveKit deploy (Cách A/B), sinh API key/secret mới
- [ ] `curl http://<IP-VPS>:7880/` trả `OK`
- [ ] (Nếu có domain) TURN qua TLS hoạt động với cert Let's Encrypt thật
- [ ] Test WebRTC thật từ 2 client ở 2 mạng khác nhau (không cùng LAN với VPS) — xác nhận NAT traversal hoạt động đúng

---

## 7. Tự động mở rộng (burst) sang AWS khi quá tải

**2 cơ chế burst độc lập, không liên quan nhau** — vì bản chất tải khác nhau:

| | Phần A — Service burst | Phần B — LiveKit burst |
|---|---|---|
| Áp dụng khi | Identity/WorkSpace/Chat/SpamTracking/Admin/Media quá tải (nhiều API request) | LiveKit quá tải (nhiều phòng họp/media stream cùng lúc) |
| Cơ chế | Node AWS join vào cụm k3s ở nhà (qua Tailscale) | Node AWS chạy LiveKit riêng, join cụm LiveKit qua Redis chung |
| Vì sao tách | Service là API service bình thường, K8s tự dàn thêm replica được | LiveKit là SFU media relay — mỗi node cần IP public riêng để relay trực tiếp, không thể chỉ "thêm replica" |

**MinIO KHÔNG nằm trong phạm vi 2 cơ chế này** — Chat Service chỉ tạo `presigned URL`, client tự
upload thẳng lên MinIO (xem `FileEndpoints.cs`), nên quá tải MinIO (băng thông/disk IO) không giải
quyết được bằng thêm node K8s. MinIO tự quản lý scale riêng (distributed mode nhiều node/ổ đĩa),
nằm ngoài phạm vi K8s.

**Ngân sách:** cả 2 phần thiết kế để **0đ khi không có node burst nào đang chạy** (EC2 tính tiền
theo giây chạy, không phải thuê bao cố định). Ngưỡng đã thống nhất: **AWS Budget Alert 50.000
VNĐ/tháng** (~2 USD) — bao luôn các khoản lặt vặt nếu có sót, vượt ngưỡng có cảnh báo email ngay.

### 7.0 Chuẩn bị chung

**IAM user riêng, quyền tối thiểu** (KHÔNG dùng access key cá nhân/quyền Admin), giới hạn instance
type để chặn launch nhầm loại máy đắt tiền:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances", "ec2:TerminateInstances",
        "ec2:DescribeInstances", "ec2:CreateTags",
        "ec2:AllocateAddress", "ec2:AssociateAddress",
        "ec2:ReleaseAddress", "ec2:DescribeAddresses"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "ec2:InstanceType": ["t3.medium", "t3.large"] }
      }
    }
  ]
}
```

**Nguyên tắc "0đ khi rảnh" — 2 điều PHẢI tránh:**
1. **Không đặt trước Elastic IP tĩnh** — AWS tính phí giờ cho IP không gắn instance đang chạy. Luôn
   cấp IP lúc launch, release ngay trước khi terminate.
2. **Không tự đóng AMI riêng** — snapshot EBS backing AMI tính phí lưu trữ dù không chạy máy nào.
   Dùng AMI gốc chuẩn (Ubuntu 22.04) + cloud-init cài lúc khởi động, chấp nhận chờ thêm 1-2 phút.

**AWS Budget Alert:** Billing → Budgets → Create budget → 2 USD/tháng → Alert threshold 80%/100% →
email. Lớp phòng vệ cuối cùng, vẫn báo được kể cả khi code có bug (launch lặp vô hạn, quên terminate).

### 7.1 Phần A — Service burst

**Tailscale — bắc cầu qua NAT của server nhà.** Server nhà không có IP public thật, node AWS không
"gõ cửa" trực tiếp vào `:6443` được. Dùng Tailscale (mesh VPN WireGuard, tự vượt NAT):
```bash
# Tren server nha
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4   # 100.x.y.z

sudo systemctl stop k3s
curl -sfL https://get.k3s.io | sh -s - --flannel-iface=tailscale0
sudo systemctl start k3s
sudo cat /var/lib/rancher/k3s/server/node-token   # luu lai
```

**Cloud-init cho node AWS — tự join cụm k3s làm agent:**
```bash
#!/bin/bash
set -e
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="${TAILSCALE_AUTHKEY}" --hostname="aws-burst-$(hostname)"

curl -sfL https://get.k3s.io | K3S_URL="https://${HOME_SERVER_TAILSCALE_IP}:6443" \
  K3S_TOKEN="${K3S_NODE_TOKEN}" \
  sh -s - agent \
  --node-label "node-role=burst-aws" \
  --node-taint "cloud-burst=true:NoSchedule"
```
`--node-taint cloud-burst=true:NoSchedule`: mặc định KHÔNG pod nào được xếp vào — quan trọng nhất để
Database (StatefulSet, không nên chạy trên node tạm/Spot) không bao giờ bị xếp nhầm sang đây.
`TAILSCALE_AUTHKEY` sinh ở Tailscale Admin Console (chọn **Ephemeral** để node tự rút khỏi tailnet
khi tắt máy) — truyền qua EC2 User Data lúc `RunInstances`, KHÔNG commit git.

**Chỉ Service được xếp vào node burst, KHÔNG bao giờ Database:** thêm `tolerations` vào Deployment
của TỪNG Service — TUYỆT ĐỐI không thêm vào Deployment Database:
```yaml
tolerations:
  - key: "cloud-burst"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
```
Kết hợp HPA (mục 5.4): tải cao → HPA tăng replica → hết chỗ node nhà → tự tràn sang node burst; tải
giảm → HPA tự rút bớt — không cần logic tự viết thêm ở tầng Pod.

**Tích hợp launch/terminate vào Admin Service (Phase 4):** endpoint mới (tự đề xuất, cùng tinh thần
`POST /admin/system/livekit/expand` đã có):
```
POST /admin/system/burst/launch
POST /admin/system/burst/{nodeId}/terminate
GET  /admin/system/burst
```
Thêm `AWSSDK.EC2` vào `AdminService.Api.csproj`, viết `AwsBurstService.cs` (style giống
`K8sResourceService.cs`) gọi `RunInstances`/`TerminateInstances`, kèm **giới hạn cứng số node burst
đồng thời** trong code (ví dụ 2) — chặn launch tràn lan nếu logic đo tải lỗi/loop.

```bash
kubectl create secret generic admin-service-aws -n admin-service \
  --from-literal=AwsBurst__AccessKey="<access-key>" \
  --from-literal=AwsBurst__SecretKey="<secret-key>" \
  --from-literal=AwsBurst__TailscaleAuthKey="<tailscale-authkey>" \
  --from-literal=AwsBurst__K3sNodeToken="<k3s-node-token>"
```

**Quy trình vận hành (bán tự động — khuyến nghị mặc định):**
1. Xem `GET /admin/system/resources` thấy node nhà quá tải liên tục.
2. `POST /admin/system/burst/launch` — Admin Service launch EC2, IP cấp động, node tự join sau ~1-2 phút.
3. Verify `kubectl get nodes` thấy node mới `Ready`.
4. HPA tự tràn Service pod sang khi cần — không thao tác thêm.
5. Hết cao điểm: HPA tự rút replica, `POST /admin/system/burst/{nodeId}/terminate` — release Elastic
   IP trước, rồi terminate instance.

*(Tuỳ chọn tự động hoàn toàn qua CronJob theo dõi tải: chỉ bật khi đã có đủ rào chắn mục 7.0 — giới
hạn số node cứng, Budget Alert, và thêm auto-terminate theo thời gian chạy tối đa vô điều kiện đề
phòng job đo tải bị treo.)*

### 7.2 Phần B — LiveKit burst

> **Lỗi thời sau quyết định mục 6.0.** Đã chốt dùng LiveKit Cloud, mà Cloud **tự lo phần mở rộng** —
> không cần Node 2 trên AWS, không cần Redis dùng chung. Phần dưới chỉ còn giá trị nếu quay lại
> phương án tự dựng VPS.
>
> Nếu sau này muốn **hybrid** (phòng thường ở hạ tầng mình, dồn lên Cloud khi quá tải), có một ràng
> buộc cứng phải biết trước: **một phòng chỉ sống trên MỘT deployment LiveKit** — không chia đôi một
> cuộc họp giữa hai nơi. Định tuyến phải quyết **lúc tạo phòng**, cho cả cuộc họp, chứ không theo
> từng người. Cần thêm: cột `livekit_endpoint` trong bảng `meetings` (`media-db-init.sql` hiện chưa
> có) và đổi `LiveKitService` từ singleton một-cấu-hình thành factory chọn endpoint theo meeting.
> Khoảng một buổi làm — chưa cần làm sớm, vì thêm sớm là phải bảo trì một nhánh code chưa ai dùng.

LiveKit hỗ trợ **clustering nhiều node sẵn có** — không cần Tailscale/k3s. Nhiều LiveKit node (IP
public riêng) cùng trỏ **1 Redis dùng chung** để đồng bộ trạng thái phòng/người tham gia; LiveKit tự
phân phối phòng mới sang node còn chỗ.

**Kiến trúc:**
- **Node 1** — VPS LiveKit hiện tại (mục 6), chạy thường trực.
- **Node 2 (AWS)** — chỉ tồn tại lúc Node 1 quá tải, cũng chạy LiveKit, trỏ CÙNG Redis với Node 1.
- **Redis dùng chung** — đặt cạnh Node 1, bật `requirepass` mật khẩu mạnh, mở port cho Node 2 gọi
  tới. Vì IP Node 2 cấp động (mục 7.0, không đặt trước Elastic IP), không giới hạn được theo IP
  nguồn cố định — mật khẩu Redis là lớp bảo vệ chính, chấp nhận đánh đổi này ở quy mô cá nhân.

**Cấu hình LiveKit (cả 2 node dùng chung `keys` + `redis`):**
```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
redis:
  address: "<IP-Node-1>:6379"
  password: "<mat-khau-redis-manh>"
keys:
  <api-key>: <api-secret>     # GIONG HET tren ca 2 node
turn:
  enabled: true
  udp_port: 3478
```

**Cloud-init cho Node 2 (AWS) — chạy Docker thuần, KHÔNG cần k3s/Tailscale:**
```bash
#!/bin/bash
set -e
apt-get update && apt-get install -y docker.io

cat <<EOF > /etc/livekit.yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
redis:
  address: "${REDIS_HOST}:${REDIS_PORT}"
  password: "${REDIS_PASSWORD}"
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
turn:
  enabled: true
  udp_port: 3478
EOF

docker run -d --name livekit --restart unless-stopped --network host \
  -v /etc/livekit.yaml:/etc/livekit.yaml \
  livekit/livekit-server:latest --config /etc/livekit.yaml
```
Security Group Node 2: mở đúng port mục 6.1. IP cấp động lúc `RunInstances`, gắn Elastic IP ngay lúc
đó để có địa chỉ ổn định suốt vòng đời node (release lúc terminate).

**Media Service cần biết node nào đang phục vụ phòng nào — thay đổi code cần thiết (chưa có ở
Phase 5):** `LiveKitOptions` hiện giả định CHỈ 1 node cố định. Khi tạo phòng (`POST /meetings`),
Media Service phải **chọn 1 node cụ thể** (Node 1 mặc định, chuyển Node 2 nếu Node 1 báo hết chỗ
qua LiveKit Server API `ListRooms`/thống kê tải) và **lưu lại node đó gắn với `meeting`** (cần thêm
cột, ví dụ `meetings.livekit_node_url`) — vì `GenerateAccessToken`/`ClientUrl` trả cho client phải
trỏ đúng node đang giữ phòng đó, không đoán lại được sau. Đây là phần code thật cần viết khi bắt tay
triển khai — tài liệu này chỉ mô tả yêu cầu, chưa implement.

**Quy trình vận hành:**
1. Theo dõi tải Node 1 (số phòng/người hoạt động qua LiveKit Server API, hoặc CPU).
2. Quá tải → launch Node 2 (cloud-init trên, IP động) → LiveKit tự nhận diện qua Redis, sẵn sàng
   nhận phòng mới trong vài giây (nhanh hơn Phần A vì không phải chờ join cụm K8s).
3. Media Service bắt đầu route phòng MỚI sang Node 2 khi Node 1 báo đầy.
4. Hết cao điểm: Media Service **ngừng route phòng mới sang Node 2**, đợi các phòng đang chạy trên
   Node 2 tự kết thúc (KHÔNG ngắt cuộc họp đang diễn ra) → release Elastic IP → `TerminateInstances`.

---

## 8. Cạm bẫy đã gặp — tổng hợp

0. **Địa chỉ quảng bá của Kafka phải đúng với MỌI client, không chỉ client đầu tiên.** Kafka hoạt
   động hai bước: client nối vào địa chỉ bootstrap, nhận về `KAFKA_ADVERTISED_LISTENERS`, rồi **mở
   kết nối mới** tới địa chỉ đó. Nên bootstrap thành công **không** có nghĩa là produce sẽ chạy —
   nó hỏng âm thầm ở bước hai. Đã dính hai biến thể:
   - `172.18.0.2:30909` (IP container node) — kind cấp lại IP khi delete+create cluster và theo thứ
     tự khởi động, nên nó trôi sang node khác (`desktop-control-plane`) mà file `kafka.yaml` không
     hề đổi. Cấu hình đang chạy còn trôi khỏi file trên đĩa: broker thật quảng bá
     `127.0.0.1:19092` trong khi file ghi `172.18.0.2:30909`.
   - `127.0.0.1:19092` (địa chỉ `kubectl port-forward`) — chạy được từ máy thật nhưng trong
     container `127.0.0.1` là chính container đó.

   Cách sửa: quảng bá **`host.docker.internal:9092`** — địa chỉ duy nhất mà container, tiến trình
   trên Windows và pod ở cluster khác đều tới được, đi thẳng qua hostPort 9092 đã map sẵn tới
   NodePort 30909. **Bỏ hẳn được `kubectl port-forward`** — thứ đã chết âm thầm nhiều lần và làm
   treo đăng ký/đăng nhập trong khi `/health` vẫn trả 200.

   Lưu ý khi rollout lại Kafka: broker **không có volume bền**, restart là mất sạch topic. Tạo lại:
   ```bash
   kubectl --context kind-messaging-cluster exec -n kafka deploy/kafka -- \
     /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
     --create --topic identity.auth-history --partitions 1 --replication-factor 1
   # lặp lại cho chat.service-log và system.error-log
   ```
1. **Bitnami Helm charts** (`bitnami/minio` và nhiều chart khác) từ 28/8/2025 chỉ còn image công
   khai hạn chế — nhiều tag báo `404 not found`. Kiểm tra trước xem image còn public không, hoặc
   tìm chart chính thức thay thế (MinIO có chart tại `https://charts.min.io/`, image
   `quay.io/minio/*`, vẫn public).
2. **Chart mặc định định cỡ cho production, không phải dev** — MinIO chart chính thức mặc định
   `mode: distributed, replicas: 16, resources.requests.memory: 16Gi`, chạy thẳng trên cluster dev
   1-node sẽ treo `Pending` vĩnh viễn. Luôn `helm show values <chart>` và hạ cấu hình trước khi
   `helm install` trên máy dev/home-lab.
3. **RAM Docker Desktop quá thấp** làm `kube-scheduler` crash loop âm thầm (triệu chứng dễ nhầm
   "pod bug" — `kubectl describe pod` không hề có `FailedScheduling` vì scheduler chưa kịp chạy).
   Luôn kiểm tra `kubectl get pods -n kube-system` trước khi debug sâu ứng dụng.
4. **`podHostNetwork: true` không hoạt động trên Docker Desktop K8s** — chỉ hoạt động trên cluster
   có node là máy/VM thật (`kind` với `extraPortMappings`, hoặc K8s Linux bare-metal thật).
5. **Nhiều cluster `kind` cùng lúc cần thêm RAM đáng kể** — 2 cluster ~8GB, thêm cluster thứ 3 (có
   Kafka, chạy JVM) cần ~12-16GB. Kiểm tra `docker stats --no-stream` trước khi tạo cluster mới nếu
   nghi thiếu RAM.
6. **Advertised listener của Kafka (và hệ thống có "2-bước kết nối" tương tự) phải khai đúng
   NodePort, không phải cổng nội bộ container.** Lỗi dễ nhầm nhất khi chạy Kafka multi-cluster/
   multi-network vì bootstrap connection vẫn thành công, chỉ giao dịch thật (sau khi nhận metadata)
   mới thất bại. IP container có thể đổi sau khi Docker Desktop restart — kiểm tra lại
   `docker network inspect kind`, cập nhật lại `KAFKA_ADVERTISED_LISTENERS` nếu IP đổi (đã gặp thực
   tế: register/message-send hang vô thời hạn vì IP cũ không còn đúng).
7. **Nhiều cluster `kind` (kể cả cluster Docker Desktop) mặc định nằm chung 1 Docker network tên
   `kind`** — dùng để cross-cluster networking qua `<IP container node>:<NodePort>`, không cần
   VPN/mesh phức tạp thêm cho môi trường dev. Verify `docker network inspect kind`. IP container
   không cố định nếu cluster bị xoá tạo lại.
8. **Windows host không tự route được vào `172.18.0.x`** (dải Docker bridge network) dù IP đúng —
   chỉ container thật sự nằm trên network `kind` mới gọi vào được. Test mọi thứ chạm tới Kafka
   advertised-listener/RabbitMQ qua `docker run --network kind ...` (hoặc `kubectl run` pod), không
   test bằng `dotnet run` trần trên Windows host.
9. **Presigned URL của `AWSSDK.S3` luôn trả `https://`** dù cấu hình `UseHttp = true`/`ServiceURL`
   là `http://` — phải tự thay chuỗi scheme sau khi generate nếu MinIO chỉ nghe HTTP thuần (mục 3).
10. **Cột `VARCHAR(n)` quá ngắn so với giá trị enum thật** — ví dụ `meeting_participants.role
    VARCHAR(10)` nhưng `'participant'` dài 11 ký tự, lỗi Postgres `22001 value too long` (phát hiện
    khi test Phase 5, đã sửa `VARCHAR(20)`). Luôn đếm ký tự giá trị `CHECK IN (...)` dài nhất trước
    khi chốt độ dài cột.
11. **RabbitMQ.Client 7.x dùng API async** (`IChannel`, `CreateChannelAsync`, `BasicPublishAsync`)
    — khác hẳn ví dụ/tutorial cũ dùng `IModel` đồng bộ, dễ nhầm khi tra cứu tài liệu ngoài.
12. **`JsonSerializer.Deserialize<T>(RedisValue)` báo lỗi ambiguous overload** — `RedisValue` implicit
    convert được cả `string` lẫn `ReadOnlySpan<byte>`. Ép kiểu tường minh `(string)value!` trước khi
    deserialize (gặp lặp lại ở nhiều service dùng StackExchange.Redis).

---

## 9. Checklist tổng hợp

**Máy dev (mục 1-3)**
- [ ] Docker Desktop RAM ≥ 12-16GB, `helm`/`kind` cài portable trong PATH
- [ ] Metrics Server + Ingress-Nginx cài trên `docker-desktop`, `kubectl top nodes` chạy được
- [ ] `kind-livekit-cluster` + LiveKit cài qua Helm, patch NodePort, Service TURN riêng, `curl http://localhost:7880/` → `OK`
- [ ] `kind-messaging-cluster` + Redis/Kafka/RabbitMQ deploy, verify `PONG`/list topic/management UI 200, verify cross-cluster
- [ ] Cả 6 DB deploy trên `docker-desktop` (mục 2.2), verify schema + constraint từng cái
- [ ] MinIO chạy trên máy LAN riêng, biến môi trường `MINIO_ENDPOINT` đúng
- [ ] Chat Service dùng section `Storage` (không còn `Minio`), provider `home` cấu hình đủ
- [ ] Bảng `files` có cột `storage_provider` (`DEFAULT 'home'`)

**Đóng gói & deploy (mục 4-5)**
- [ ] PAT tạo xong, `docker login ghcr.io` thành công
- [ ] Cả 6 image build + push lên GHCR, package Public HOẶC `ghcr-pull-secret` đã tạo trên server
- [ ] Cả 6 Secret tạo đúng namespace, `Jwt__SigningKey` GIỐNG NHAU tuyệt đối giữa các service
- [ ] Admin Service có `serviceAccountName: admin-service`, verify `GET /admin/system/resources` trả 200 thật
- [ ] WSL2 + k3s cài trên server nhà, `networkingMode=mirrored`, `kubectl get nodes` → `Ready`
- [ ] Toàn bộ hạ tầng (Ingress, 6 DB, Redis/Kafka/RabbitMQ) deploy lại trên k3s, `KAFKA_ADVERTISED_LISTENERS` đã sửa đúng IP LAN
- [ ] `ResourceQuota` 60/30/10 áp cho từng namespace, HPA cấu hình cho từng Service
- [ ] Cả 6 Deployment + Service apply thành công, `kubectl get pods -A` toàn bộ `Running`
- [ ] Ingress rule cho từng service public cần thiết, test 1 luồng nghiệp vụ thật qua Ingress (không qua `kubectl exec`/`port-forward`)

**LiveKit Cloud (mục 6.0 — đường chính)**
- [ ] Tạo project trên LiveKit Cloud, lấy `wss://<project>.livekit.cloud` + API key/secret
- [ ] Media Service đặt 4 giá trị `LiveKit__ServerUrl/ClientUrl/ApiKey/ApiSecret`, KHÔNG sửa code
- [ ] Test WebRTC thật từ 2 client ở 2 mạng khác nhau (một máy dùng 4G, không cùng LAN)
- [ ] Xác nhận không bật Egress/recording (khoản tốn tiền nhất)

**Kho lưu trữ khi lên tunnel (mục 3.1)**
- [ ] Mọi MinIO/R2 đều có TLS — presigned URL `http://` sẽ bị chặn khi frontend chạy `https://`
- [ ] Bucket cloud cấu hình CORS cho origin của frontend
- [ ] Nếu điền provider `cloud`: test upload file > `HomeMaxBytes` và tải lại được thật

**LiveKit VPS (mục 6.1-6.5 — chỉ khi quay lại phương án tự dựng)**
- [ ] VPS có IP public, firewall mở đủ port, LiveKit deploy, `curl http://<IP-VPS>:7880/` → `OK`
- [ ] Media Service trỏ đúng LiveKit VPS, test WebRTC thật từ 2 mạng khác nhau

**AWS burst (mục 7 — khi thực sự cần)**
- [ ] IAM user riêng, Budget Alert 2 USD/tháng đã tạo
- [ ] Xác nhận KHÔNG đặt Elastic IP tĩnh trước, KHÔNG tự đóng AMI riêng
- [ ] Phần A: Tailscale + k3s agent test launch tay 1 node, `tolerations` thêm vào từng Service Deployment, `AwsBurstService` tích hợp Admin Service
- [ ] Phần B: Redis dùng chung cấu hình xong, Node 2 test launch tay, code Media Service chọn node/lưu `livekit_node_url` đã viết, test WebRTC thật qua Node 2
- [ ] (Nếu tự động hoàn toàn) đủ rào chắn mục 7.0 trước khi để cụm tự vận hành không giám sát


---

## 12. Hai Job khởi tạo bắt buộc (chạy tự động cùng `all.yaml`)

Cụm k3s có **hai** Job phải chạy được thì hệ thống mới đúng. Cả hai đều **chạy lại bao nhiêu lần
cũng không sao**, nên cứ `kubectl apply` lại khi nghi ngờ.

| Job | Namespace | Việc | Bỏ quên thì sao |
|---|---|---|---|
| `minio-init` | `chat-data` | Tạo bucket `chat-media` | Presign vẫn trả URL bình thường (presign là phép tính offline) nhưng PUT thật trả **404 NoSuchBucket** — chỉ lộ khi upload |
| `rabbitmq-init` | `chat-data` | Đặt policy TTL 24 giờ cho 5 hàng đợi thông báo | Nếu Identity chết vài ngày, thông báo tồn đọng phình mãi và chặn luôn hai hàng đợi lệnh khoá tài khoản |

Kiểm tra policy đã vào chưa:

```bash
POD=$(k3s kubectl get pod -n chat-data -l app=rabbitmq -o jsonpath='{.items[0].metadata.name}')
k3s kubectl exec -n chat-data $POD -- rabbitmqctl list_queues name policy consumers
```

Cột `policy` của `identity.account-locked` và `identity.delete-account-spam` phải **rỗng**. Đây là hai
hàng đợi **lệnh khoá tài khoản**, không phải thông báo — tin trong đó hết hạn nghĩa là mất luôn việc
khoá tài khoản spam. Regex của policy neo hai đầu (`^(...)$`) chính là để tránh quét trúng chúng.

Năm hàng đợi thông báo (`identity.chat-message-notification`, `identity.storage-warning`,
`workspace.member-notifications`, `media.meeting-invite`, `media.meeting-created`) từ Phase 8 **đã có
consumer** là Identity Service, nên bình thường chúng luôn rỗng. TTL giờ là **lưới an toàn** chứ không
còn là cách chống rò rỉ. `consumers` của cả năm phải bằng 1 — bằng 0 nghĩa là
`NotificationConsumerService` bên Identity đang chết, và mọi thông báo trong hệ thống đang im lặng.

### Topic Kafka thì KHÔNG cần Job

Trước đây topic Kafka ra đời một cách tình cờ — khi có producer đẩy tin đầu tiên. Cụm mới dựng mà
chưa ai gửi tin nhắn nào thì topic chưa tồn tại, và consumer subscribe vào topic không có thật sẽ
**nằm im không báo lỗi** (xem mục 7.3 của roadmap). Nay mỗi service tự tạo topic nó cần lúc khởi
động (`KafkaTopicInitializer`), coi `TopicAlreadyExists` là thành công.

Nghĩa là **Kafka có bị xoá sạch dữ liệu thì chỉ cần khởi động lại service là topic trở về** — không
phải nhớ chạy Job nào. Kiểm tra:

```bash
POD=$(k3s kubectl get pod -n chat-data -l app=kafka -o jsonpath='{.items[0].metadata.name}')
k3s kubectl exec -n chat-data $POD -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
k3s kubectl exec -n chat-data $POD -- /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list
```

Phải thấy đủ `chat.service-log`, `system.error-log`, `identity.auth-history` và **hai** consumer
group `spamtracking-service` + `chat-service-write-chat`. Thiếu consumer group nghĩa là tính năng
chặn spam đang chết âm thầm.

### Thông báo: mọi đường đều qua Identity Service

Từ Phase 8, không service nào tự đẩy thông báo tới người dùng. Đường đi là
**service → RabbitMQ → Identity Service (lưu + đẩy) → WebSocket → tab Thông báo**.

Kiểm tra nhanh khi nghi ngờ thông báo không tới:

```bash
# 1. Consumer bên Identity còn sống không (phải thấy đủ 5 hàng đợi)
k3s kubectl -n chat-app logs deploy/identity | grep "hang doi thong bao"   # phải thấy đủ 5

# 2. Hàng đợi có bị ứ không (messages phải ~0, consumers phải =1)
POD=$(k3s kubectl get pod -n chat-data -l app=rabbitmq -o jsonpath='{.items[0].metadata.name}')
k3s kubectl exec -n chat-data $POD -- rabbitmqctl list_queues name messages consumers
```

**Bẫy đã dính:** Phase 7 từng gỡ `RabbitMq__HostName` khỏi Media Service (lúc đó nó thật sự không
dùng RabbitMQ). Khi hàng đợi `media.meeting-invite` quay lại ở Phase 8, Media rơi về mặc định
`localhost` — tức chính container của nó. Lời mời vẫn tạo thành công và trả token bình thường, **chỉ
thông báo là mất**, vì publisher nuốt lỗi có chủ ý để RabbitMQ hỏng không làm hỏng cả thao tác mời.
Mọi API đều xanh. Cả 6 service giờ đều phải có `RabbitMq__HostName` — xem danh sách `RABBIT` trong
`gen-manifests.py`.

### Nâng cấp lên bản có thông báo: phải chạy DDL trước

Bảng `notifications` là bảng **mới**. Cụm đang chạy từ trước Phase 8 sẽ không tự có nó, và
`appsettings` không tạo bảng (dự án cố ý không dùng EF Migrations — schema do file SQL thuần quản lý,
xem đầu `identity-db-init.sql`). Chạy tay phần cuối của `identity-db-init.sql`:

```bash
k3s kubectl exec -n chat-data -i deploy/identity-db --   psql -h 127.0.0.1 -U identity_admin -d identity -v ON_ERROR_STOP=1 < notifications.sql
```

Quên bước này thì Identity vẫn khởi động bình thường, chỉ có mọi thao tác thông báo trả 500.


---

## 13. Dữ liệu nào tự dọn, dữ liệu nào không

Bảng này trả lời câu hỏi "để lâu có phình không". Kiểm lại khi thêm bất kỳ chỗ ghi dữ liệu mới nào.

| Dữ liệu | Cơ chế dọn | Chu kỳ / hạn |
|---|---|---|
| Tài khoản Guest hết hạn | `GuestCleanupService` (Identity) | 24 giờ |
| Hội thoại 1-1 im lặng lâu | `P2PCleanupService` (Chat) | 24 giờ |
| **Thông báo** | `NotificationCleanupService` (Identity) | 24 giờ — đã đọc giữ 7 ngày, chưa đọc 30 ngày |
| File vượt hạn mức nhóm | `StorageWarningService` (Chat) | theo hạn mức, xoá file cũ nhất |
| **Cache tin nhắn trong Redis** | TTL 11 ngày trên key + trim 10.000 tin / 10 ngày | gia hạn mỗi lần ghi |
| Trạng thái trình bày (Redis) | TTL 12 giờ + xoá khi kết thúc họp | — |
| Phòng chờ / liveness (Redis) | TTL 5 phút / 30 giây | — |
| Hàng đợi thông báo RabbitMQ | policy `notification-ttl` | 24 giờ |
| Kafka | `log.retention.hours=168` | 7 ngày |
| Log hệ thống (journald) | `SystemMaxUse=300M` | trần cứng |

**Không tự dọn, và cố ý như vậy:** tin nhắn, nhóm, người dùng, `meetings` / `meeting_invites` /
`meeting_participants`, `violations`. Đây là dữ liệu người dùng sở hữu hoặc hồ sơ cần giữ; chúng tăng
theo hoạt động thật chứ không phải rác, và mỗi cuộc họp chỉ thêm vài dòng.

### Hai cái bẫy đã dính, ghi lại để không lặp

**Trim theo sự kiện không thay được TTL.** `ChatCacheService` có sẵn logic dọn (10.000 tin/hội thoại,
10 ngày) — nhưng nó **chỉ chạy khi hội thoại đó có tin nhắn mới**. Nhóm im lặng thì không bao giờ bị
dọn. Đo trên hệ thống đang chạy thấy đúng như vậy: mọi key `chat:msg:*` đều `TTL = -1`, tức nằm lại
vĩnh viễn. Nay mỗi lần ghi đều gia hạn TTL 11 ngày, nên hội thoại chết hẳn thì tự biến mất.

**`maxmemory` của Redis phải thấp hơn `limits.memory` của pod.** Trước đây `maxmemory = 0` (không
giới hạn) trong khi pod bị giới hạn 128Mi — nghĩa là Redis cứ ghi cho tới khi **k8s giết cả pod**,
mất sạch dữ liệu, thay vì tự dọn khi gần đầy. Nay đặt 96mb + `volatile-lru`.

Chọn `volatile-lru` (chỉ dọn key **có hạn**) chứ không phải `allkeys-lru`: mọi key của ứng dụng giờ
đều có hạn, và cache tin nhắn áp đảo về số lượng nên thực tế nó bị dọn trước. Cache là dữ liệu **dẫn
xuất** — Postgres vẫn là nguồn sự thật và endpoint đọc tin nhắn đã có sẵn đường fallback.

### Nếu thấy RAM máy tăng mà nghi hệ thống

Đo trước, đừng đoán. Trên máy đang chạy, tổng RAM của **toàn bộ** pod chỉ ~1,4 GB trong khi máy dùng
3,3 GB. Phần chênh không thuộc về ứng dụng:

```bash
free -h
k3s kubectl top pods -A --no-headers | sort -k4 -h -r | head -20   # RAM theo pod
ps aux --sort=-rss | head -12                                       # RAM theo tiến trình
journalctl --disk-usage
```

Thủ phạm thực tế đã gặp: **Mission Center** (công cụ GUI theo dõi tài nguyên) chiếm ~718 MB sau 18
giờ chạy — nhiều hơn bất kỳ pod nào, và chính nó là thứ đang được dùng để nhìn con số RAM. Cộng thêm
`gnome-shell` ~172 MB và journald ~207 MB. Máy này có môi trường desktop; nếu chỉ dùng làm server thì
tắt bớt là thu lại được gần 1 GB.

Kích thước dữ liệu thật để đối chiếu: mỗi CSDL ~7,7 MB (gần như trống), Kafka 4 KB, Redis 1,56 MB.
