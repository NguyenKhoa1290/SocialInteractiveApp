# Hướng dẫn đóng gói & đẩy service (Docker image) lên GHCR

Áp dụng cho **mọi service tự viết** (Identity Service, và sau này Chat/WorkSpace/Admin/Media...) —
không phải làm riêng lẻ từng lần, đây là quy trình chuẩn dùng lại. Dùng **GitHub Container
Registry (ghcr.io)** — miễn phí, không giới hạn số repo private.

## 1. Tạo Personal Access Token (làm 1 lần)

Trên GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate
new token. Chọn scope tối thiểu: `write:packages` (kèm `read:packages` để pull về sau).

```bash
echo "<PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

## 2. Build + tag + push image (mỗi lần cập nhật code)

```bash
cd IdentityService/src/IdentityService.Api

docker build -t ghcr.io/<github-username>/identity-service:latest .
# Nen kem tag version cu the (vd git commit hash / semver) thay vi chi "latest",
# de biet dang chay dung phien ban nao, de rollback:
docker tag ghcr.io/<github-username>/identity-service:latest ghcr.io/<github-username>/identity-service:v0.1.0

docker push ghcr.io/<github-username>/identity-service:latest
docker push ghcr.io/<github-username>/identity-service:v0.1.0
```

## 3. Cho phép server nhà (k3s) pull image private

Package trên GHCR mặc định **private** — server cần xác thực để pull được. Trên server (hoặc máy
điều khiển `kubectl` trỏ vào server):

```bash
kubectl create secret docker-registry ghcr-pull-secret \
  -n identity-service \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<PAT> \
  --docker-email=<email-bat-ky>
```

> Đơn giản hơn (bỏ qua bước tạo secret): đổi package trên GitHub sang **Public** (Package settings
> → Change visibility) — chấp nhận được cho dự án cá nhân/home-lab giai đoạn đầu, không có gì bí
> mật trong code service (secret thật nằm ở biến môi trường/K8s Secret riêng, không nằm trong
> image). Bỏ được bước tạo `ghcr-pull-secret` này nếu chọn public.

## 4. Deployment manifest tham khảo (Identity Service)

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
        - name: ghcr-pull-secret   # bo dong nay neu da doi package sang Public
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
  type: ClusterIP   # chi Ingress-Nginx goi vao, khong can expose thang ra ngoai
  selector:
    app: identity-service
  ports:
    - port: 80
      targetPort: 8080
```

Lưu ý địa chỉ DB dùng **DNS nội bộ K8s** (`identity-db.identity-db.svc.cluster.local`) — vì trên
server nhà (1 cluster k3s duy nhất, không tách 3 cluster như máy dev), Identity Service và Identity
DB nằm **cùng cluster**, không cần qua NodePort/IP node như lúc còn ở máy dev.

Tạo Secret chứa mật khẩu DB + JWT signing key thật (không hardcode trong manifest):
```bash
kubectl create secret generic identity-service-secrets -n identity-service \
  --from-literal=DB_PASSWORD="<mat-khau-that>" \
  --from-literal=Jwt__SigningKey="<jwt-key-that>"
```

## 5. Ingress rule (khi sẵn sàng expose ra ngoài)

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

## 6. Checklist

- [ ] PAT đã tạo, `docker login ghcr.io` thành công
- [ ] Image build + push lên `ghcr.io/<user>/identity-service`
- [ ] Package Public HOẶC đã tạo `ghcr-pull-secret` trên server
- [ ] `identity-service-secrets` đã tạo với mật khẩu DB + JWT key thật (khác key demo lúc dev)
- [ ] Deployment + Service apply thành công, `kubectl get pods -n identity-service` → `Running`
- [ ] Test `kubectl exec` vào 1 pod khác trong cùng cluster, `curl identity-service.identity-service.svc.cluster.local/health`
- [ ] (Khi sẵn sàng public) Ingress rule `/identity` hoạt động
