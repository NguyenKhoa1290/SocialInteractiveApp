# Hướng dẫn triển khai Phase 0 (Hạ tầng nền) — mang sang máy chủ khác

Tài liệu này ghi lại chính xác các bước đã chạy thành công trên máy hiện tại, để tái lập trên
một máy Windows + Docker Desktop khác. Tham chiếu kiến trúc gốc:
`Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md`, mục "Phase 0 — Hạ tầng nền".

## Kiến trúc: 3 cluster K8s riêng biệt

| Cluster | Công cụ tạo | Chứa gì | Lý do tách riêng |
|---|---|---|---|
| **Cluster chính** (`docker-desktop`) | Docker Desktop → Enable Kubernetes | Ingress-Nginx, Metrics Server, sau này: các service nghiệp vụ (Identity, WorkSpace, Chat, Admin, Media...) | Nhóm service nghiệp vụ, scale cùng nhau |
| **livekit-cluster** | `kind` CLI (không qua Docker Desktop) | LiveKit Server (WebRTC/TURN) | Nặng nhất về CPU/network, cần scale độc lập với phần còn lại |
| **messaging-cluster** | `kind` CLI | Redis, Kafka (KRaft), RabbitMQ — gộp chung 1 cluster | Nhóm hạ tầng nhắn tin/cache, tách khỏi service nghiệp vụ để không cạnh tranh tài nguyên, nhưng gộp chung với nhau vì không cần scale riêng lẻ như LiveKit |

MinIO: **không triển khai qua Docker/K8s** trong hướng dẫn này — cài trực tiếp trên hệ điều hành
theo lựa chọn riêng của người vận hành (đã verify chạy tại 1 máy khác trong LAN, xem
`HUONG-DAN-EXPOSE-LAN.md`). File `kind-storage-cluster.yaml` và `minio-values.yaml` trong thư mục
này chỉ giữ lại làm tham khảo nếu sau này muốn triển khai qua K8s.

**Vì sao nhiều cluster tách biệt thay vì 1 cluster + namespace:** Docker Desktop chỉ chạy được
**1 cluster K8s duy nhất** qua toggle "Enable Kubernetes". Để có cluster độc lập thật sự (network/
control-plane riêng, có thể chuyển sang máy vật lý khác mà không ảnh hưởng cluster kia), dùng
`kind` CLI tạo thêm cluster ngoài Docker Desktop.

**Giao tiếp giữa các cluster (quan trọng):** vì đây là các cluster K8s hoàn toàn tách biệt, KHÔNG
dùng chung DNS/mạng nội bộ K8s. Đã verify: mọi node container (dù tạo bằng Docker Desktop hay
`kind`) đều nằm chung 1 Docker network tên `kind` (`docker network inspect kind`), nên service ở
cluster A gọi sang cluster B được qua **`<IP container node cua cluster B>:<NodePort>`**. Ví dụ
service ở `docker-desktop` gọi Kafka ở `messaging-cluster` qua `172.18.0.7:30909` (không phải qua
`localhost`, không phải qua K8s Service DNS). IP container có thể đổi nếu cluster bị xoá/tạo lại —
kiểm tra lại bằng `docker network inspect kind` khi cần.

---

## 0. Yêu cầu tài nguyên máy

**Quan trọng — bài học từ lần triển khai đầu:** chạy 2 control-plane K8s cùng lúc (docker-desktop
+ 1 cluster kind) cần tối thiểu **~6–8GB RAM** cấp cho Docker Desktop. Với RAM mặc định thấp
(~2GB), `kube-scheduler` sẽ bị mất kết nối tới API server liên tục → `CrashLoopBackOff` → mọi pod
kẹt ở `Pending` mãi mãi (triệu chứng: `kubectl describe pod` không hề có event `FailedScheduling`,
vì scheduler còn chưa kịp chạy).

**Cách cấp RAM:** Docker Desktop → ⚙️ Settings → Resources → Memory → tối thiểu 8GB → Apply & Restart.

---

## 1. Cài Docker Desktop + bật Kubernetes

1. Cài Docker Desktop (bản mới nhất).
2. Settings → Resources → Memory ≥ 8GB (xem mục 0).
3. Settings → Kubernetes → tick **Enable Kubernetes** → Apply & Restart.
4. Đợi vài phút, verify:
   ```
   kubectl config get-contexts
   kubectl get nodes
   ```
   Phải thấy context `docker-desktop`, node status `Ready`.

## 2. Cài `kubectl`, `helm`, `kind` (portable, không cần quyền admin)

`kubectl` đã có sẵn kèm Docker Desktop (`C:\Program Files\Docker\Docker\resources\bin`).
`helm` và `kind` cần cài thêm — tải bản portable về thư mục user, không cần admin:

```powershell
$dest = "$env:LOCALAPPDATA\helm"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# Helm
$helmUrl = "https://get.helm.sh/helm-v3.16.4-windows-amd64.zip"
Invoke-WebRequest -Uri $helmUrl -OutFile "$dest\helm.zip"
Expand-Archive -Path "$dest\helm.zip" -DestinationPath $dest -Force
Copy-Item "$dest\windows-amd64\helm.exe" "$dest\helm.exe" -Force
Remove-Item "$dest\helm.zip"

# kind
Invoke-WebRequest -Uri "https://kind.sigs.k8s.io/dl/v0.24.0/kind-windows-amd64" -OutFile "$dest\kind.exe"

# Them vao PATH cua user (vinh vien, khong can admin)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
```

Mở lại terminal, kiểm tra: `helm version`, `kind version`.

> Lưu ý: nếu dùng Git Bash / WSL bash trong cùng phiên PowerShell vừa set PATH, cần thêm thủ công
> mỗi phiên bash mới: `export PATH="$PATH:/c/Users/<user>/AppData/Local/helm"` — biến PATH của
> Windows không tự động lan sang phiên bash đang mở sẵn.

## 3. Cluster chính: Metrics Server + Ingress-Nginx

```bash
kubectl config use-context docker-desktop

# Metrics Server — can cho Admin Service (GET /admin/system/resources) o Phase 4
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# Tren cluster local, kubelet dung self-signed cert -> can them flag nay
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl rollout status deployment/metrics-server -n kube-system --timeout=120s
kubectl top nodes   # verify

# Ingress-Nginx Controller — API Gateway/Load Balancer cho cac service HTTP sau nay
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.ingressClassResource.default=true
```

Docker Desktop tự động forward Service kiểu `LoadBalancer` ra `localhost` — không cần cấu hình
thêm. Verify: `curl http://localhost/` → trả về `404` là đúng (chưa có Ingress rule nào, không phải lỗi).

Ingress rule cho từng service (Identity, WorkSpace, Chat...) sẽ thêm dần khi triển khai các Phase
sau, mỗi service tự khai báo 1 `Ingress` resource với `ingressClassName: nginx`.

## 4. Cluster LiveKit (`kind`, tách riêng)

### 4.1 Tạo cluster với port mapping cố định

File `kind-livekit-cluster.yaml` (đã có sẵn trong thư mục này):

```yaml
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
kubectl get nodes   # phai Ready
```

**Vì sao dùng `kind` thay vì Docker Desktop K8s cho LiveKit:** đã thử `podHostNetwork: true`
(cách LiveKit khuyến nghị chính thức trên K8s) nhưng **không hoạt động trên Docker Desktop** — vì
node của Docker Desktop K8s chạy trong 1 container ẩn, `hostNetwork` chỉ bind vào network namespace
của container đó, không bind được vào Windows host thật, nên `localhost` không kết nối được.
`kind` CLI (chạy trực tiếp, không qua Docker Desktop) hỗ trợ `extraPortMappings` — publish thẳng
port ra Windows host — nên chọn `kind` + `NodePort` (không dùng `hostNetwork`) cho cluster này.

### 4.2 Cài LiveKit qua Helm

```bash
helm repo add livekit https://helm.livekit.io
helm repo update
helm install livekit livekit/livekit-server -n livekit --create-namespace \
  -f livekit-values.yaml
```

Nội dung `livekit-values.yaml` (đã có sẵn) — điểm mấu chốt:
- `podHostNetwork: false` — không dùng (lý do ở trên).
- Dùng **UDP mux 1 cổng** (`rtc.udp_port: 7882`) thay vì dải port range (`port_range_start/end`) —
  dải port range chỉ expose được qua `hostNetwork` hoặc NodePort-từng-port-một (không thực tế với
  dải lớn 50000-50100), còn UDP mux 1 cổng thì gán NodePort cố định bình thường được.
- `loadBalancer.type: disable` — chart tạo 1 Service gồm `http` + `rtc-tcp` + `rtc-udp`, nhưng
  **không tự đặt `type: NodePort`** — phải patch tay sau khi cài (bước dưới).
- `keys` — API key/secret **demo cho dev**, đổi sang giá trị khác khi lên staging/prod.

### 4.3 Patch Service sang NodePort cố định

```bash
kubectl patch service livekit-livekit-server -n livekit --type='json' -p='[
  {"op":"replace","path":"/spec/type","value":"NodePort"},
  {"op":"add","path":"/spec/ports/0/nodePort","value":30880},
  {"op":"add","path":"/spec/ports/1/nodePort","value":30881},
  {"op":"add","path":"/spec/ports/2/nodePort","value":30882}
]'
```

> Lệnh trên giả định thứ tự port trong Service là `http, rtc-tcp, rtc-udp` — verify bằng:
> `kubectl get svc livekit-livekit-server -n livekit -o jsonpath='{range .spec.ports[*]}{.name}{"\t"}{.nodePort}{"\n"}{end}'`
> trước khi patch nếu chart version khác đi thứ tự.

### 4.4 Tạo Service riêng cho TURN (UDP 3478)

Chart LiveKit **không tự tạo Service** cho TURN UDP thường (chỉ có với TURN qua TLS/443, cần cert
thật). Áp file `livekit-turn-service.yaml` (đã có sẵn):

```bash
kubectl apply -f livekit-turn-service.yaml
```

### 4.5 Xử lý rolling-update bị Pending (nếu gặp lại khi upgrade sau này)

Trên cluster 1-node, nếu thay đổi cấu hình dạng bind-port (như từng đổi `podHostNetwork`), pod mới
có thể bị kẹt `Pending` do pod cũ còn giữ chỗ port. Trên dev 1-node không cần zero-downtime, xoá
pod cũ để pod mới lên thay:
```bash
kubectl delete pod -n livekit <ten-pod-cu>
```

### 4.6 Verify

```bash
curl http://localhost:7880/    # phai tra ve "OK", HTTP 200
kubectl logs -n livekit deployment/livekit-livekit-server --tail=20   # khong co dong ERROR
```

---

## 5. Cluster messaging (`kind`, gộp chung Redis + Kafka + RabbitMQ)

### 5.1 Tạo cluster với port mapping cố định

File `kind-messaging-cluster.yaml` (đã có sẵn):

```yaml
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

```bash
kind create cluster --config kind-messaging-cluster.yaml
kubectl config use-context kind-messaging-cluster
kubectl get nodes   # phai Ready
```

**Không dùng Helm chart Bitnami** cho cả 3 (Redis/Kafka/RabbitMQ) — rút kinh nghiệm từ sự cố MinIO
(mục 6.1): image Bitnami phần lớn đã bị khoá từ 8/2025. Dùng manifest YAML thuần với image chính
thức Docker Hub: `redis:7-alpine`, `apache/kafka:3.8.0` (KRaft mode, không cần Zookeeper),
`rabbitmq:3.13-management-alpine`. File `redis.yaml`, `kafka.yaml`, `rabbitmq.yaml` đã có sẵn.

### 5.2 Deploy Redis

```bash
REDIS_PASS=$(openssl rand -hex 16)
kubectl create namespace redis
kubectl create secret generic redis-credentials -n redis --from-literal=REDIS_PASSWORD="$REDIS_PASS"
kubectl apply -f redis.yaml
```

Verify: `redis-cli -h localhost -p 6379 -a "$REDIS_PASS" ping` → `PONG`.

### 5.3 Deploy Kafka (KRaft mode)

```bash
kubectl apply -f kafka.yaml
```

**Điểm mấu chốt trong `kafka.yaml` — `KAFKA_ADVERTISED_LISTENERS` phải dùng NodePort, không dùng
cổng nội bộ:**
```yaml
- name: KAFKA_ADVERTISED_LISTENERS
  value: "PLAINTEXT://172.18.0.7:30909"   # NodePort 30909, KHONG phai 9092
```
Lý do (đã debug thực tế): client Kafka làm việc theo 2 bước — (1) kết nối bootstrap tới địa chỉ
được cho, (2) nhận metadata trả về địa chỉ "advertised" của broker rồi **mở kết nối MỚI** tới đúng
địa chỉ đó để giao dịch thật. Nếu advertised listener khai cổng nội bộ `9092`, bước (2) sẽ luôn
timeout — vì `9092` chỉ tồn tại bên trong network namespace của pod, không hề được expose ra ngoài
container (chỉ NodePort `30909` mới được `kube-proxy` forward vào `pod:9092`). Phải advertised đúng
địa chỉ+cổng mà bên ngoài **thực sự** kết nối được tới.

`172.18.0.7` = IP của container `messaging-cluster-control-plane` trên Docker network `kind` —
verify lại bằng `docker network inspect kind` nếu IP đổi sau khi tạo lại cluster.

Verify:
```bash
kubectl exec -n kafka deployment/kafka -- /opt/kafka/bin/kafka-topics.sh \
  --create --topic test-topic --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1
kubectl exec -n kafka deployment/kafka -- /opt/kafka/bin/kafka-topics.sh \
  --list --bootstrap-server localhost:9092
```
(Trên Git Bash Windows, thêm `MSYS_NO_PATHCONV=1` trước `kubectl exec` — Git Bash tự động convert
đường dẫn Unix `/opt/kafka/...` thành đường dẫn Windows, gây lỗi "no such file or directory".)

### 5.4 Deploy RabbitMQ

```bash
RABBIT_PASS=$(openssl rand -hex 16)
kubectl create namespace rabbitmq
kubectl create secret generic rabbitmq-credentials -n rabbitmq \
  --from-literal=RABBITMQ_DEFAULT_USER=admin \
  --from-literal=RABBITMQ_DEFAULT_PASS="$RABBIT_PASS"
kubectl apply -f rabbitmq.yaml
```

Verify: `curl http://localhost:15672/` → HTTP 200 (management UI). Đăng nhập bằng
`admin` / `$RABBIT_PASS`.

### 5.5 Verify cross-cluster (mô phỏng service nghiệp vụ ở cluster chính gọi vào)

```bash
kubectl config use-context docker-desktop

# Redis
kubectl run redis-test --rm -i --restart=Never --image=redis:7-alpine -- \
  redis-cli -h 172.18.0.7 -p 30637 -a "$REDIS_PASS" ping        # PONG

# Kafka
kubectl run kafka-test --rm -i --restart=Never --image=apache/kafka:3.8.0 -- \
  /opt/kafka/bin/kafka-topics.sh --list --bootstrap-server 172.18.0.7:30909   # list topic

# RabbitMQ (chi test port mo, khong can client AMQP day du)
kubectl run rabbit-test --rm -i --restart=Never --image=busybox -- \
  sh -c "nc -zv -w3 172.18.0.7 30567"                            # open
```

Cả 3 lệnh trên đã chạy thành công trên máy hiện tại — xác nhận kiến trúc cross-cluster qua Docker
network `kind` hoạt động đúng.

---

## 6. Những cạm bẫy đã gặp (để không lặp lại)

1. **Bitnami Helm charts** (`bitnami/minio`, và nhiều chart Bitnami khác) từ 28/8/2025 chỉ còn
   image công khai hạn chế — nhiều tag báo `404 not found` khi pull. Nếu cần chart nào của Bitnami,
   kiểm tra trước xem image còn public không, hoặc tìm chart chính thức thay thế (ví dụ MinIO có
   chart chính thức tại `https://charts.min.io/`, dùng image `quay.io/minio/*`, vẫn public).
2. **Chart mặc định định cỡ cho production**, không phải dev: ví dụ MinIO chart chính thức mặc
   định `mode: distributed, replicas: 16, resources.requests.memory: 16Gi` — chạy thẳng trên
   cluster dev 1-node sẽ treo `Pending` vĩnh viễn (không đủ tài nguyên hoặc không đủ node để
   schedule). Luôn đọc `helm show values <chart>` và hạ cấu hình xuống mức phù hợp trước khi
   `helm install` trên máy dev/home-lab.
3. **RAM Docker Desktop quá thấp** (mặc định có thể chỉ ~2GB) làm `kube-scheduler` crash loop âm
   thầm — triệu chứng dễ nhầm là "pod bug" trong khi thực ra là thiếu RAM. Luôn kiểm tra
   `kubectl get pods -n kube-system` trước khi debug sâu vào ứng dụng.
4. **`podHostNetwork: true` không hoạt động trên Docker Desktop K8s** (chỉ hoạt động trên cluster
   có node là máy/VM thật, ví dụ `kind` với `extraPortMappings`, hoặc K8s trên Linux bare-metal).
5. **Nhiều cluster `kind` cùng lúc cần thêm RAM đáng kể** — 2 cluster cần ~8GB, thêm cluster thứ 3
   (đặc biệt có Kafka, vốn chạy JVM) cần nâng lên ~12-16GB. Luôn kiểm tra
   `docker stats --no-stream` trước khi tạo cluster mới nếu nghi ngờ thiếu RAM.
6. **Advertised listener của Kafka (và các hệ thống có "2-bước kết nối" tương tự) phải khai đúng
   NodePort, không phải cổng nội bộ container** — xem chi tiết mục 5.3. Đây là lỗi dễ nhầm nhất khi
   chạy Kafka trong K8s multi-cluster/multi-network vì bootstrap connection vẫn thành công (dùng
   `localhost` hoặc DNS nội bộ), chỉ giao dịch thật (sau khi nhận metadata) mới thất bại.
7. **Nhiều cluster `kind` (kể cả cluster tạo bởi Docker Desktop) mặc định nằm chung 1 Docker
   network tên `kind`** — dùng điều này để cross-cluster networking qua `<IP container node>
   :<NodePort>`, không cần thêm VPN/mesh network phức tạp. Verify bằng `docker network inspect
   kind`. Nhược điểm: IP container không cố định nếu cluster bị xoá tạo lại — cần cập nhật lại
   `ADVERTISED_LISTENERS`/config liên quan sau khi tái tạo cluster.

---

## 7. Checklist nhanh khi setup máy mới

- [ ] Docker Desktop cài xong, RAM ≥ 12-16GB (chạy 3 cluster, có Kafka)
- [ ] Enable Kubernetes, context `docker-desktop` sẵn sàng
- [ ] `helm`, `kind` cài portable, có trong PATH
- [ ] Metrics Server cài + patch `--kubelet-insecure-tls`, `kubectl top nodes` chạy được
- [ ] Ingress-Nginx cài, `curl http://localhost/` trả 404 (không phải connection refused)
- [ ] `kind create cluster` cho `livekit-cluster` với đúng `extraPortMappings`
- [ ] LiveKit cài qua Helm, Service patch NodePort, Service TURN riêng đã tạo
- [ ] `curl http://localhost:7880/` trả `OK`
- [ ] `kind create cluster` cho `messaging-cluster` với đúng `extraPortMappings`
- [ ] Redis/Kafka/RabbitMQ deploy bằng manifest thuần (không Bitnami), verify `PONG`, list topic,
      management UI 200
- [ ] Verify cross-cluster: service ở `docker-desktop` gọi được Redis/Kafka/RabbitMQ ở
      `messaging-cluster` qua IP container node + NodePort
- [ ] (Nếu dùng) MinIO cài theo cách riêng của bạn, không qua Docker/K8s
