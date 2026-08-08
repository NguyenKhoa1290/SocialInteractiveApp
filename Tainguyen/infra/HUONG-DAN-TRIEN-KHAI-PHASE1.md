# Hướng dẫn triển khai Phase 1 (Identity Service) — phần hạ tầng

Tiếp nối `HUONG-DAN-TRIEN-KHAI-PHASE0.md`. Tham chiếu kiến trúc gốc:
`Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md`, mục "3. Identity Service".

**Phạm vi tài liệu này:** chỉ phần hạ tầng — deploy Postgres (Identity DB) + tạo schema. **Chưa
viết code Identity Service** (dự kiến dùng **C#/.NET** khi tới lúc code — xem thêm memory
`project_tech_stack.md`).

---

## 1. Identity DB (Postgres)

Chạy trong **cluster chính** (`docker-desktop`), namespace riêng `identity-db` — đúng nguyên tắc
"Database per Service" trong tài liệu kiến trúc (mục 1: mỗi service 1 DB vật lý riêng).

### 1.1 Deploy

File đã có sẵn trong thư mục này:
- `identity-db-init.sql` — DDL đúng theo mục 3.2 tài liệu roadmap (bảng `users`, `oauth_links`,
  index, CHECK constraint).
- `identity-db.yaml` — Namespace, Deployment (Postgres 16), PVC, Service.

```bash
kubectl config use-context docker-desktop

kubectl create namespace identity-db

DB_PASS=$(openssl rand -hex 16)
kubectl create secret generic identity-db-credentials -n identity-db \
  --from-literal=POSTGRES_DB=identity \
  --from-literal=POSTGRES_USER=identity_admin \
  --from-literal=POSTGRES_PASSWORD="$DB_PASS"
# Luu lai DB_PASS o noi an toan (vd: .identity-db-credentials.txt, KHONG commit vao git)

kubectl create configmap identity-db-init -n identity-db --from-file=init.sql=identity-db-init.sql

kubectl apply -f identity-db.yaml
```

Init script (`init.sql`) tự động chạy **1 lần duy nhất** lúc container Postgres khởi tạo lần đầu
(cơ chế chuẩn của image `postgres`: mọi file trong `/docker-entrypoint-initdb.d/` chạy khi
`pgdata` còn trống). Nếu cần chạy lại schema từ đầu, phải xoá PVC (`identity-db-data`) trước.

### 1.2 Vì sao Service phải là `LoadBalancer`, không phải `NodePort`

**Đã verify thực tế:** trên cluster `docker-desktop`, `NodePort` **không** được Docker Desktop tự
động forward ra `localhost` (khác với `kind`, nơi `extraPortMappings` làm việc này). Chỉ
`LoadBalancer` mới có cơ chế tự forward. Vì vậy `identity-db.yaml` dùng `type: LoadBalancer`.

Dưới lớp `LoadBalancer`, Kubernetes vẫn tự cấp 1 `NodePort` song song (xem cột `PORT(S)` khi chạy
`kubectl get svc` — dạng `5432:XXXXX/TCP`). NodePort này **mới là port dùng để truy cập
cross-cluster** (từ pod ở `livekit-cluster`/`messaging-cluster`), còn port `5432` (LoadBalancer)
chỉ hoạt động qua cơ chế forward nội bộ của Docker Desktop dành riêng cho máy đang chạy Docker
Desktop đó (localhost).

| Ai kết nối | Địa chỉ | Ví dụ đã verify |
|---|---|---|
| Công cụ dev trên chính máy Windows này (psql, DBeaver...) | `localhost:5432` | ✅ |
| Service ở cluster khác (`livekit-cluster`, `messaging-cluster`, và sau này service nghiệp vụ khác nếu tách cluster) | `<IP container node desktop-control-plane>:<NodePort>` (vd `172.18.0.3:30543`) | ✅ |

IP container node lấy bằng `docker network inspect kind`. NodePort thật lấy bằng
`kubectl get svc identity-db -n identity-db`.

### 1.3 Verify

```bash
DB_PASS=$(cat .identity-db-credentials.txt | grep POSTGRES_PASSWORD | cut -d= -f2)

# Schema dung
kubectl exec -n identity-db deployment/identity-db -- env PGPASSWORD="$DB_PASS" \
  psql -U identity_admin -d identity -c "\dt"

# Constraint hoat dong: Guest co email PHAI bi tu choi
kubectl exec -n identity-db deployment/identity-db -- env PGPASSWORD="$DB_PASS" \
  psql -U identity_admin -d identity -c \
  "INSERT INTO users (user_type, nickname, email) VALUES ('guest','x','a@b.com');"
# Ky vong: ERROR chk_guest_no_credentials
```

---

## 2. Còn lại của Phase 1 (chưa làm trong tài liệu này)

Theo mục 3.4 tài liệu roadmap ("Tiến độ triển khai"):
- Viết code Identity Service (C#/.NET) — các API `/auth/login`, `/auth/register`,
  `/auth/oauth/{provider}`, `/auth/guest`, `/auth/forgot-password`... theo OpenAPI spec mục 3.3.
- Cron job dọn Guest hết hạn 6 tháng (quét `last_active_at`).
- Publish `Login`/`Register History` lên Kafka (đã có `messaging-cluster` từ Phase 0, endpoint
  `172.18.0.7:30909`).
- Consumer RabbitMQ: `Khóa tài khoản`, `Delete Account Spam` (endpoint `172.18.0.7:30567`).
- Session lưu Redis (endpoint `172.18.0.7:30637`).
- Ingress rule thật: `/identity/*` → Identity Service, khi service đã có Deployment/Service trong
  cluster chính.
