# Chat_APP

Nền tảng **Chat, Gọi video và Workspace** — kiến trúc microservices, mỗi service sở hữu 1 database
riêng (Database per Service). Dự án cá nhân/học tập, xây dựng từ đầu theo tài liệu thiết kế chi
tiết tại [`Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md`](Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md).

## Kiến trúc

```
                         ┌─────────────────┐
                         │  API Gateway     │  (Nginx — rate limit, JWT check)
                         └────────┬─────────┘
        ┌──────────────┬─────────┼─────────┬──────────────┬──────────────┐
        ▼              ▼         ▼         ▼              ▼              ▼
   ┌─────────┐   ┌───────────┐ ┌──────┐ ┌───────┐   ┌───────────┐  ┌───────────┐
   │Identity │   │ WorkSpace │ │ Chat │ │ Admin │   │   Media   │  │SpamTrack- │
   │ Service │   │  Service  │ │Service│ │Service│   │  Service  │  │ingService │
   └────┬────┘   └─────┬─────┘ └───┬──┘ └───┬───┘   └─────┬─────┘  └─────┬─────┘
        │              │           │        │             │              │
   Identity DB    WorkSpace DB  Chat DB      │        Media DB       SpamTracking DB
                                              │        MiniApp DB
                                              │
                                     (không có DB riêng —
                                      lớp điều phối)

   Hạ tầng dùng chung: Kafka · RabbitMQ · Redis · MinIO · LiveKit + TURN · K8s
```

- **Database per Service** — mỗi service 1 Postgres vật lý riêng; liên kết giữa các service khác DB
  chỉ là "logic FK" (tầng ứng dụng tự đảm bảo, không có ràng buộc DB thật).
- **JWT dùng chung** — Identity Service phát hành, mọi service khác chỉ validate bằng cùng
  `SigningKey`/`Issuer`/`Audience`.
- **Event-driven** — Kafka cho event log (đăng nhập, chat log...), RabbitMQ cho task-queue
  (thông báo, side-effect bất đồng bộ).

## Các service

| Service | Vai trò | CSDL |
|---|---|---|
| **Identity Service** | Đăng nhập/đăng ký (email, Google, Facebook, Guest), JWT, quên mật khẩu | Identity DB |
| **WorkSpace Service** | Quản lý nhóm, RBAC 3 tầng (Trưởng nhóm/Phó nhóm/Nhóm viên) | WorkSpace DB |
| **Chat Service** | Chat 1-1 và nhóm, upload file qua MinIO, quota lưu trữ, mute, khiếu nại | Chat DB |
| **SpamTrackingService** | Phát hiện spam tự động (rate/duplicate/keyword), khoá/xoá tài khoản vi phạm | SpamTracking DB |
| **Admin Service** | Quản trị người dùng, xử lý khiếu nại, giám sát tài nguyên K8s, scale hạ tầng | *(không có DB riêng)* |
| **Media Service** | Gọi video/voice qua LiveKit, phân quyền phòng họp, Mini App (IPTV) | Media DB, MiniApp DB |

Mỗi service là 1 API ASP.NET Core Minimal API (.NET 10), đóng gói Docker riêng, giao tiếp nội bộ
qua HTTP (`/internal/*`, không qua API Gateway public).

## Công nghệ sử dụng

- **Backend:** C#/.NET 10 (ASP.NET Core Minimal API), Entity Framework Core + Npgsql
- **CSDL:** PostgreSQL (schema quản lý bằng SQL thuần, không dùng EF Migrations)
- **Nhắn tin/sự kiện:** Apache Kafka (KRaft mode), RabbitMQ, Redis
- **Lưu trữ file:** MinIO (S3-compatible)
- **Gọi video/voice:** LiveKit (WebRTC SFU) + TURN
- **Hạ tầng:** Kubernetes (Docker Desktop + `kind` lúc dev, k3s lúc lên server thật), Helm
- **Xác thực:** JWT (HMAC), OTP qua SMTP (Gmail)

## Cấu trúc thư mục

```
Chat_APP/
├── IdentityService/       # Identity Service (C#/.NET)
├── WorkspaceService/       # WorkSpace Service
├── ChatService/             # Chat Service (P2P + Group)
├── SpamTrackingService/   # SpamTrackingService
├── AdminService/           # Admin Service
├── MediaService/           # Media Service + Mini App (IPTV)
├── Tainguyen/infra/         # Toàn bộ manifest K8s, script hạ tầng, hướng dẫn triển khai
└── Congviec/                # Tài liệu thiết kế gốc (kiến trúc, CSDL, API, roadmap)
```

Mỗi service theo cùng 1 cấu trúc: `src/<TenService>.Api/` gồm `Models/`, `Data/` (DbContext),
`Services/` (business logic, client gọi service khác), `Endpoints/` (Minimal API), `Program.cs`,
`Dockerfile`, `appsettings.json.example` (file cấu hình mẫu — `appsettings.json` thật chứa secret,
không commit vào git).

## Bắt đầu nhanh

Toàn bộ hướng dẫn dựng hạ tầng (K8s dev, CSDL, MinIO, đóng gói image, deploy server thật, LiveKit
VPS, tự động mở rộng AWS khi quá tải) nằm trong **1 file duy nhất**:
[`Tainguyen/infra/HUONG-DAN-DEPLOY.md`](Tainguyen/infra/HUONG-DAN-DEPLOY.md).

Mỗi service chạy độc lập bằng `dotnet run` (cần hạ tầng ở trên đã sẵn sàng) hoặc build Docker image
riêng theo `Dockerfile` trong từng thư mục. Copy `appsettings.json.example` thành `appsettings.json`
và điền giá trị thật (mật khẩu DB, JWT signing key — phải **giống hệt nhau** giữa mọi service, API
key MinIO/LiveKit...) trước khi chạy.

## Tài liệu

- [Tài liệu thiết kế tổng hợp](Congviec/he-thong-tong-hop-kien-truc-csdl-api-roadmap.md) — kiến
  trúc chi tiết, thiết kế CSDL, OpenAPI spec, tiến độ triển khai từng service (tick `[x]` cho từng
  API/tích hợp đã hoàn thành, kèm ghi chú mọi quyết định tự đưa ra khi tài liệu gốc chưa mô tả rõ).
- [Hướng dẫn triển khai hạ tầng](Tainguyen/infra/HUONG-DAN-DEPLOY.md) — từ máy dev tới server thật.

## Trạng thái

Đã hoàn thành đầy đủ Phase 0 → Phase 6 theo roadmap kỹ thuật (hạ tầng nền → Identity → WorkSpace +
Chat P2P → Chat Group + SpamTracking → Admin → Media → Mini App), verify end-to-end qua Docker thật
(không mock) cho toàn bộ luồng nghiệp vụ chính. Đang ở giai đoạn chuẩn bị đóng gói & deploy hàng
loạt lên hạ tầng thật.
