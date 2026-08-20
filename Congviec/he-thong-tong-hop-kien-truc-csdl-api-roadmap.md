# TÀI LIỆU TỔNG HỢP HỆ THỐNG

**Kiến trúc — Cơ sở dữ liệu — API — Roadmap triển khai**

*Nền tảng Chat, Gọi video và Workspace*

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Roadmap triển khai](#2-roadmap-triển-khai)
3. [Identity Service](#3-identity-service)
4. [Admin Service](#4-admin-service)
5. [WorkSpace Service](#5-workspace-service)
6. [Chat Service](#6-chat-service)
7. [Media Service & MiniApp](#7-media-service--miniapp)
8. [SpamTrackingService, Kafka, RabbitMQ](#8-spamtrackingservice-kafka-rabbitmq)

---

## 1. Tổng quan kiến trúc

Hệ thống theo kiến trúc **microservices**, mỗi service sở hữu 1 database vật lý riêng (Database per Service). Các thành phần chính:

- **Frontend** (E2EE, Guest Token, LiveKit JS Client) — client app
- **API Gateway** (Nginx) — Rate limit, JWT check, cửa ngõ duy nhất vào hệ thống
- **Identity Service** — đăng nhập/đăng ký, quản lý JWT, notification
- **Admin Service** — quản trị hệ thống, xử lý khiếu nại, giám sát tài nguyên
- **WorkSpace Service** — quản lý nhóm, RBAC (Trưởng nhóm/Phó nhóm/Nhóm viên)
- **Chat Service** — chat 1-1, chat nhóm, E2EE, presence
- **Media Service** — gọi video/voice, Watch Together, mini app, tích hợp LiveKit + TURN
- **SpamTrackingService** — phát hiện & xử lý spam tự động
- **Search Chat Service** — tìm kiếm lịch sử chat (Redis cho dữ liệu nóng, Postgres cho dữ liệu lạnh)

**Hạ tầng nền:** Apache Kafka (event log: Register, Chat Log, Error Log) · RabbitMQ (task-queue cho notification/side-effect) · Redis (cache chung, đồng bộ từ Postgres qua Kafka) · MinIO (object storage — file > 20MB đẩy sang kho cloud, xem `storage_provider`) · LiveKit + TURN (WebRTC, giới hạn 100 người/room — **chạy trên LiveKit Cloud managed**, không tự dựng: server nhà bị CGNAT nên không port-forward được dải UDP; xem `HUONG-DAN-DEPLOY.md` mục 6.0) · K8s (Admin Service dùng Service Account read-only để giám sát).

**Nguyên tắc xuyên suốt:**
- Mỗi service 1 DB riêng → khoá ngoại giữa các service khác DB chỉ là **liên kết logic** (FK\*), không được DB ràng buộc, tầng ứng dụng tự đảm bảo.
- Ghi Postgres trước, publish event để đồng bộ Redis sau — tách write path khỏi cache update.
- Trưởng nhóm rời nhóm = giải tán toàn bộ nhóm (cascade delete ở tầng DB) — không có khái niệm "nhóm vô chủ".

---

## 2. Roadmap triển khai

*Sắp xếp theo phụ thuộc kỹ thuật (technical dependency) giữa các service — service ở phase sau cần service ở phase trước đã chạy được. Trong cùng 1 phase, các mục có thể làm song song.*

### Phase 0 — Hạ tầng nền (Infrastructure)

Không phụ thuộc service nghiệp vụ nào — làm trước tiên vì mọi service sau đều cần đến.

- API Gateway (Nginx): routing, rate limit, JWT verify khung sườn
- Redis, Apache Kafka, RabbitMQ, MinIO — cài đặt & cấu hình cluster cơ bản
- K8s cluster + LiveKit Service/TURN Service (có thể triển khai sớm dù chưa dùng ngay, vì setup hạ tầng WebRTC thường mất thời gian riêng)

### Phase 1 — Identity Service

**Phụ thuộc:** Phase 0 (Kafka để publish Login/Register History, Redis cho session).

Bắt buộc làm ngay sau hạ tầng nền vì **mọi service nghiệp vụ khác đều cần JWT do Identity Service phát hành** để xác thực request. Không service nào ở các phase sau có thể test end-to-end nếu thiếu Identity Service.

- Đăng ký/Đăng nhập (email, Google, Facebook, Guest)
- Quên mật khẩu
- Cơ chế JWT + sliding expiration cho Guest
- Cron job dọn Guest hết hạn 6 tháng

### Phase 2 — WorkSpace Service & Chat Service (P2P)

**Phụ thuộc:** Phase 1 (cần user_id hợp lệ từ Identity).

2 service này có thể làm **song song** vì Chat 1-1 (P2P) không cần khái niệm workspace.

- WorkSpace Service: tạo/sửa/xoá nhóm, thêm thành viên, RBAC 3 tầng
- Chat Service (P2P only trước): gửi tin nhắn/media, cơ chế nén video, auto-xoá P2P sau 6 tháng

### Phase 3 — Chat Service (Group) & SpamTrackingService

**Phụ thuộc:** Phase 2 (Chat Group cần workspace_id từ WorkSpace; SpamTrackingService cần Chat Log đã có dữ liệu thật trong Kafka để phân tích).

- Chat Service mở rộng sang Group: quota lưu trữ, mute, xoá tin nhắn/file, cảnh báo hết hạn dung lượng
- SpamTrackingService: consume Chat Log, publish sự kiện khoá tài khoản qua RabbitMQ

### Phase 4 — Admin Service

**Phụ thuộc:** Phase 3 (cần SpamTrackingService có dữ liệu vi phạm để hiển thị; cần kênh Khiếu nại của Chat Service đã hoạt động).

- Quản lý người dùng, xem/xử lý vi phạm spam
- Xử lý khiếu nại (đọc từ Redis TTL 10h)
- Giám sát tài nguyên K8s (read-only RBAC)
- Yêu cầu scale service / dựng thêm LiveKit (**lưu ý:** cần cấp thêm RBAC Role riêng ngoài read-only — xem mục 4)

### Phase 5 — Media Service

**Phụ thuộc:** Phase 1 (auth) trực tiếp; tính năng "mở cuộc họp trong nhóm chat" phụ thuộc thêm Phase 2–3 (WorkSpace + Chat) đã ổn định. Phần LiveKit hạ tầng đã có từ Phase 0.

- Mở/tham gia cuộc họp, mời qua link hoặc trực tiếp
- Phân quyền phòng họp (host/participant, cấp quyền riêng lẻ)
- Dọn dẹp phòng tự động khi hết người

### Phase 6 — Mini App (ví dụ: IPTV)

**Phụ thuộc:** Phase 5 (Media Service phải chạy ổn định trước, vì mini app nhúng bên trong 1 phiên họp đang diễn ra).

- Quản lý danh sách kênh, nhóm kênh
- Cơ chế mỗi client tự fetch stream riêng (không qua LiveKit)

---

**Ghi chú về roadmap:** đây là thứ tự **kỹ thuật** (cái gì cần cái gì để chạy được), không phải thứ tự ưu tiên **kinh doanh** — nếu Media Service là tính năng cốt lõi cần ra mắt sớm vì lý do sản phẩm/thị trường, hoàn toàn có thể làm Media Service song song từ Phase 2 (chỉ cần Identity xong), miễn là chấp nhận tính năng "mở trong nhóm chat" tạm thời chưa hoạt động cho tới khi WorkSpace + Chat Group hoàn thiện.
---

## 3. Identity Service

### 3.1 Mô tả

**Tính năng Đăng nhập**

Các phương thức: email + mật khẩu, Google OAuth, Facebook OAuth, Guest (chỉ nhập nickname).

Xử lý token: phát hành JWT sau khi xác thực; JWT Guest có cơ chế *sliding expiration* — tự gia hạn khi còn hoạt động, tự xoá bản ghi Guest nếu không hoạt động liên tục 6 tháng (scheduled job nội bộ, không qua message queue). API Gateway chịu trách nhiệm verify JWT + rate limit; Identity Service chỉ phát hành token.

Trước khi cấp quyền truy cập, kiểm tra tài khoản có bị khoá vì spam không — nếu có, chuyển hướng sang luồng Khiếu nại (qua Chat Service) thay vì vào thẳng hệ thống.

Quên mật khẩu: gửi OTP qua email, cho phép đặt mật khẩu mới. Với tài khoản chỉ từng đăng nhập Google/Facebook, đây về bản chất là *tạo mật khẩu lần đầu*, không phải "đặt lại".

**Tính năng Đăng ký**

Các phương thức: email, Google, Facebook — đều bắt buộc nhập nickname sau khi đăng ký (kể cả OAuth, không tự lấy tên từ profile mạng xã hội). Với đăng ký qua Google/Facebook: không lưu mật khẩu, chỉ lưu liên kết OAuth.

**Liên kết với các thành phần khác**

Publish Login + Register History lên Apache Kafka (audit log). Consume sự kiện "Phát hiện spam" qua RabbitMQ → khoá tài khoản → đẩy thông báo cho user qua RabbitMQ. Lưu trữ chính: Identity DB (Postgres). Session sau đăng nhập cache trong Redis.

---

### 3.2 Thiết kế CSDL

#### Bảng `users`

Lưu thông tin tài khoản cho cả Guest và Registered User trong cùng 1 bảng, phân biệt qua `user_type`.

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | Định danh duy nhất |
| user_type | VARCHAR(20) | NOT NULL, CHECK IN ('guest','registered') | Phân biệt Guest và Registered User |
| nickname | VARCHAR(50) | NOT NULL | Tên hiển thị, bắt buộc với mọi loại tài khoản |
| email | VARCHAR(255) | UNIQUE, NULL | NULL với Guest; có giá trị với Registered |
| password_hash | VARCHAR(255) | NULL | NULL với Guest và tài khoản chỉ đăng nhập OAuth, chưa từng đặt mật khẩu |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'active', CHECK IN ('active','locked') | 'locked' khi bị khoá vì spam; xoá vĩnh viễn = xoá hẳn row |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Thời điểm tạo tài khoản |
| last_active_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Dùng cho cron job dọn Guest sau 6 tháng và sliding expiration JWT |

**Ràng buộc bổ sung:** `CHECK (user_type <> 'guest' OR (email IS NULL AND password_hash IS NULL))` — đảm bảo ngay ở tầng DB rằng Guest không thể có email/mật khẩu.

**Index:**
- `idx_users_email ON users(email) WHERE email IS NOT NULL` — tăng tốc tra cứu khi đăng nhập bằng email.
- `idx_users_last_active ON users(last_active_at) WHERE user_type = 'guest'` — tăng tốc cron job quét Guest hết hạn.

#### Bảng `oauth_links`

Lưu liên kết giữa 1 user và tài khoản Google/Facebook.

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| user_id | BIGINT | NOT NULL, FK → users(id) ON DELETE CASCADE | |
| provider | VARCHAR(20) | NOT NULL, CHECK IN ('google','facebook') | |
| provider_user_id | VARCHAR(255) | NOT NULL | ID định danh phía Google/Facebook trả về |
| linked_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ràng buộc bổ sung:** `UNIQUE (provider, provider_user_id)`; `UNIQUE (user_id, provider)`.

**Ghi chú / Điểm mở:**
- Lịch sử đăng nhập/đăng ký KHÔNG có bảng riêng — đã publish qua Kafka (topic Register) làm audit log, tránh lưu trùng.
- Mã OTP (Quên mật khẩu, UC-05) đề xuất lưu trong Redis với TTL ngắn (5–10 phút), không cần thêm bảng Postgres.
- `id` dùng BIGSERIAL (giả định mặc định) — có thể đổi sang UUID nếu cần ID không đoán được thứ tự.
- Guest chưa có cột nhận diện thiết bị/trình duyệt — gốc rễ lỗ hổng "né ban bằng Guest mới" ở UC-09; nếu cần xử lý, thêm cột như `device_fingerprint`/`ip_hash` — CHƯA thêm vào schema vì là quyết định nghiệp vụ chưa chốt.

**SQL DDL:**

```sql
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  user_type       VARCHAR(20) NOT NULL
                    CHECK (user_type IN ('guest','registered')),
  nickname        VARCHAR(50) NOT NULL,
  email           VARCHAR(255) UNIQUE,
  password_hash   VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','locked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_guest_no_credentials
    CHECK (user_type <> 'guest' OR (email IS NULL AND password_hash IS NULL))
);

CREATE INDEX idx_users_email
  ON users(email) WHERE email IS NOT NULL;

CREATE INDEX idx_users_last_active
  ON users(last_active_at) WHERE user_type = 'guest';

CREATE TABLE oauth_links (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           VARCHAR(20) NOT NULL
                       CHECK (provider IN ('google','facebook')),
  provider_user_id   VARCHAR(255) NOT NULL,
  linked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);
```

---

### 3.3 API (OpenAPI 3.0)

```yaml
openapi: 3.0.3
info:
  title: Identity Service API
  version: "1.0.0"
  description: |
    API cho Identity Service — đăng nhập, đăng ký, quản lý phiên, thông tin user.
    Tham chiếu Use Case: UC-01 đến UC-09.

    Lưu ý: file này chỉ mô tả REST API (đồng bộ, qua API Gateway).
    Các sự kiện bất đồng bộ Identity Service consume qua RabbitMQ
    (Khóa tài khoản, Delete Account Spam, Delete Account Expired)
    KHÔNG nằm trong phạm vi OpenAPI vì không phải HTTP endpoint.

servers:
  - url: https://api.example.com/identity
    description: Qua API Gateway (Nginx) — rate limit + JWT check áp dụng ở tầng Gateway

tags:
  - name: Authentication
    description: Đăng nhập, OAuth, Guest (UC-01 → UC-04)
  - name: Password
    description: Quên mật khẩu / đặt mật khẩu (UC-05)
  - name: Registration
    description: Đăng ký tài khoản (UC-06 → UC-08)
  - name: Profile
    description: Thông tin & cài đặt tài khoản của chính user
  - name: Internal
    description: >-
      Endpoint nội bộ, chỉ gọi được từ service khác trong hệ thống (không đi
      qua Gateway public) — dùng để resolve thông tin user (liên kết logic
      cross-DB) hoặc thao tác đồng bộ từ Admin Service.

security:
  - bearerAuth: []

paths:
  # ============== AUTHENTICATION ==============
  /auth/login:
    post:
      tags: [Authentication]
      summary: Đăng nhập bằng email & mật khẩu
      description: Tham chiếu UC-01.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  format: password
      responses:
        "200":
          description: Đăng nhập thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AuthSuccessResponse"
        "401":
          description: Sai email hoặc mật khẩu (UC-01, luồng ngoại lệ 3a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Tài khoản đang bị khoá vì spam (UC-01, luồng ngoại lệ 4a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccountLockedResponse"

  /auth/oauth/{provider}:
    post:
      tags: [Authentication]
      summary: Đăng nhập hoặc Đăng ký qua OAuth (Google / Facebook)
      description: |
        Tham chiếu UC-02, UC-03, UC-07, UC-08.
        Endpoint DÙNG CHUNG cho cả đăng nhập lẫn đăng ký: nếu email từ
        provider trả về đã tồn tại trong hệ thống → coi như đăng nhập
        (UC-02/UC-03); nếu chưa tồn tại → tự tạo tài khoản mới (UC-07/UC-08)
        và trả về `requiresNickname: true` để Frontend hiển thị màn hình
        nhập nickname bắt buộc trước khi hoàn tất.
      security: []
      parameters:
        - name: provider
          in: path
          required: true
          schema:
            type: string
            enum: [google, facebook]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [oauthToken]
              properties:
                oauthToken:
                  type: string
                  description: Access token nhận được từ provider sau bước consent
      responses:
        "200":
          description: Đăng nhập/Đăng ký thành công
          content:
            application/json:
              schema:
                allOf:
                  - $ref: "#/components/schemas/AuthSuccessResponse"
                  - type: object
                    properties:
                      isNewUser:
                        type: boolean
                      requiresNickname:
                        type: boolean
                        description: true nếu là user mới, cần gọi PATCH /users/me/nickname trước khi dùng đầy đủ tính năng
        "403":
          description: Tài khoản đang bị khoá vì spam
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccountLockedResponse"
        "409":
          description: >-
            Email từ provider trùng với tài khoản đã đăng ký bằng phương thức
            khác — hành vi cụ thể (tự động liên kết hay từ chối) CHƯA ĐƯỢC
            CHỐT (xem UC-07, mục Ghi chú/Điểm mở). Mã lỗi này là placeholder
            cho tới khi quyết định nghiệp vụ được xác nhận.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /auth/guest:
    post:
      tags: [Authentication]
      summary: Truy cập dạng Guest
      description: Tham chiếu UC-04. Không cần email/mật khẩu, chỉ cần nickname.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [nickname]
              properties:
                nickname:
                  type: string
                  minLength: 1
                  maxLength: 50
      responses:
        "200":
          description: Tạo phiên Guest thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AuthSuccessResponse"

  /auth/logout:
    post:
      tags: [Authentication]
      summary: Đăng xuất, huỷ session hiện tại
      responses:
        "204":
          description: Đăng xuất thành công, không có nội dung trả về

  # ============== PASSWORD ==============
  /auth/forgot-password:
    post:
      tags: [Password]
      summary: Bắt đầu luồng quên mật khẩu — gửi OTP qua email
      description: Tham chiếu UC-05, bước 1–2.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email]
              properties:
                email:
                  type: string
                  format: email
      responses:
        "202":
          description: >-
            OTP đã được gửi (luôn trả 202 kể cả khi email không tồn tại,
            tránh lộ thông tin email nào đã đăng ký trong hệ thống)

  /auth/verify-otp:
    post:
      tags: [Password]
      summary: Xác thực mã OTP
      description: Tham chiếu UC-05, bước 3.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, otp]
              properties:
                email:
                  type: string
                  format: email
                otp:
                  type: string
                  minLength: 6
                  maxLength: 6
      responses:
        "200":
          description: OTP hợp lệ, trả về resetToken dùng cho bước đặt mật khẩu mới
          content:
            application/json:
              schema:
                type: object
                properties:
                  resetToken:
                    type: string
        "400":
          description: OTP sai hoặc hết hạn (UC-05, luồng ngoại lệ 3a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /auth/reset-password:
    post:
      tags: [Password]
      summary: Đặt mật khẩu mới
      description: |
        Tham chiếu UC-05, bước 4. Áp dụng cho cả 2 trường hợp: đặt lại mật
        khẩu (user đã từng có mật khẩu) và tạo mật khẩu lần đầu (user chỉ
        từng đăng nhập OAuth) — về mặt API là cùng 1 thao tác, chỉ khác
        thông điệp hiển thị phía Frontend tuỳ `isFirstTimePassword` trong
        response của bước verify-otp trước đó.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [resetToken, newPassword]
              properties:
                resetToken:
                  type: string
                newPassword:
                  type: string
                  format: password
                  minLength: 8
      responses:
        "200":
          description: Đặt mật khẩu thành công
        "400":
          description: resetToken không hợp lệ hoặc đã hết hạn
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  # ============== REGISTRATION ==============
  /auth/register:
    post:
      tags: [Registration]
      summary: Đăng ký bằng email & mật khẩu
      description: Tham chiếu UC-06.
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password, nickname]
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  format: password
                  minLength: 8
                nickname:
                  type: string
                  minLength: 1
                  maxLength: 50
      responses:
        "201":
          description: Đăng ký thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AuthSuccessResponse"
        "409":
          description: Email đã tồn tại (UC-06, luồng ngoại lệ 2a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  # ============== PROFILE ==============
  /users/me:
    get:
      tags: [Profile]
      summary: Lấy thông tin tài khoản hiện tại
      responses:
        "200":
          description: Thông tin user
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"

  /users/me/nickname:
    patch:
      tags: [Profile]
      summary: Đặt/đổi nickname
      description: >-
        Bắt buộc gọi ngay sau khi đăng ký/đăng nhập OAuth lần đầu
        (khi `requiresNickname: true`), có thể gọi lại bất kỳ lúc nào để đổi tên hiển thị.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [nickname]
              properties:
                nickname:
                  type: string
                  minLength: 1
                  maxLength: 50
      responses:
        "200":
          description: Cập nhật thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"

  # ============== INTERNAL (service-to-service) ==============
  /internal/users/{userId}:
    get:
      tags: [Internal]
      summary: Resolve thông tin cơ bản của 1 user theo id
      description: >-
        Dùng bởi WorkSpace/Chat/Media Service để hiển thị nickname/avatar khi
        chỉ có user_id (liên kết logic cross-DB, xem mục 5.1 tài liệu thiết
        kế CSDL). KHÔNG đi qua API Gateway public.
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Thông tin cơ bản
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserPublicInfo"
        "404":
          description: Không tồn tại user này (đã bị xoá vĩnh viễn hoặc id sai)

  /internal/users:
    get:
      tags: [Internal]
      summary: Resolve nhiều user cùng lúc (batch)
      description: >-
        Tránh N+1 request khi 1 service cần hiển thị danh sách nhiều user
        cùng lúc (VD: WorkSpace Service liệt kê thành viên nhóm).
      parameters:
        - name: ids
          in: query
          required: true
          description: Danh sách user id, phân tách bằng dấu phẩy
          schema:
            type: string
            example: "1,2,3"
      responses:
        "200":
          description: Danh sách thông tin cơ bản
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/UserPublicInfo"

  /internal/users/{userId}/unlock:
    post:
      tags: [Internal]
      summary: Gỡ khoá tài khoản (đồng bộ, do Admin chủ động thực hiện)
      description: >-
        Dùng bởi Admin Service khi Admin quyết định gỡ khoá (UC-12, nhánh
        3a). Khác với hành động "Khoá tài khoản", vốn đi qua RabbitMQ bất
        đồng bộ từ SpamTrackingService — gỡ khoá là thao tác Admin chủ động,
        nên gọi trực tiếp đồng bộ để có phản hồi ngay cho Admin Page.
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Gỡ khoá thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
        "404":
          description: Không tìm thấy user

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
          format: int64
        userType:
          type: string
          enum: [guest, registered]
        nickname:
          type: string
        email:
          type: string
          format: email
          nullable: true
          description: null với Guest
        status:
          type: string
          enum: [active, locked]
        createdAt:
          type: string
          format: date-time

    UserPublicInfo:
      type: object
      description: Tập con của User, đủ dùng để hiển thị (không lộ email/status)
      properties:
        id:
          type: integer
          format: int64
        nickname:
          type: string
        userType:
          type: string
          enum: [guest, registered]

    AuthSuccessResponse:
      type: object
      properties:
        accessToken:
          type: string
          description: JWT — với Guest có cơ chế sliding expiration (UC-04)
        user:
          $ref: "#/components/schemas/User"

    AccountLockedResponse:
      type: object
      properties:
        error:
          type: string
          example: account_locked
        message:
          type: string
          example: Tài khoản đang bị khoá vì vi phạm chính sách chống spam
        complaintChannelUrl:
          type: string
          description: Đường dẫn tới kênh Khiếu nại (Chat Service), truy cập được dù tài khoản đang bị khoá

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
```
### 3.4 Tiến độ triển khai

*Code: `IdentityService/` (C#/.NET 10). Hạ tầng: `Tainguyen/infra/` (Postgres, Redis, Kafka,
RabbitMQ đã deploy K8s). Đã build + test end-to-end toàn bộ mục dưới đây trừ khi ghi chú khác.*

**Cơ sở dữ liệu**
- [x] Tạo bảng `users` (kèm CHECK constraint chặn Guest có email/mật khẩu)
- [x] Tạo bảng `oauth_links`
- [x] Index `idx_users_email`, `idx_users_last_active`
- [x] Cron job dọn Guest hết hạn 6 tháng (quét `last_active_at`) — `GuestCleanupService`

**API**
- [x] `POST /auth/login`
- [x] `POST /auth/oauth/{provider}` — verify token thật qua Google/Facebook API
- [x] `POST /auth/guest`
- [x] `POST /auth/logout` — blocklist JWT qua Redis
- [x] `POST /auth/refresh` — **tự đề xuất, khắc phục thiếu sót phát hiện khi build Frontend F0**:
      comment cũ ở `JwtTokenService.cs` nhắc "sliding expiration ... xem endpoint refresh" nhưng
      endpoint đó chưa từng được viết ra — không có cách nào JWT tự gia hạn như tài liệu Frontend mục
      1 mô tả. Yêu cầu token HIỆN TẠI còn hợp lệ (`RequireAuthorization`, không "hồi sinh" token đã
      hết hạn — đúng tinh thần "chỉ gia hạn khi còn hoạt động"), cấp token mới cùng hạn mức, đồng thời
      blocklist token cũ qua Redis (tái dùng `RedisAuthStore.BlocklistTokenAsync`, cùng cơ chế với
      `/auth/logout`) để tránh 2 token cùng sống song song
- [x] `POST /auth/forgot-password`
- [x] `POST /auth/verify-otp`
- [x] `POST /auth/reset-password`
- [x] `POST /auth/register`
- [x] Nickname duy nhất toàn hệ thống — **tự bổ sung** (không phân biệt hoa/thường,
      `idx_users_nickname_lower`), áp dụng cho cả `/auth/register`, `/auth/guest`, `PATCH
      /users/me/nickname` (409 `nickname_taken`). Lý do: tính năng bạn bè mới thêm tìm người theo
      nickname — nếu trùng, kết quả tìm kiếm/kết bạn sẽ lẫn lộn giữa nhiều người khác nhau. Guest và
      tài khoản đăng ký dùng CHUNG không gian nickname (Guest chiếm 1 nickname thì người khác không
      dùng được tới khi Guest đó bị dọn sau 6 tháng không hoạt động). Verify thật qua curl: guest
      trùng tên (kể cả khác hoa/thường) và register trùng tên với guest đã tồn tại đều trả đúng 409.
- [x] CORS — **tự đề xuất, khắc phục lỗi thật phát hiện khi test đăng nhập Guest từ Frontend**:
      Identity Service chưa cấu hình CORS ở đâu cả, nên request cross-origin từ Frontend dev
      (`localhost:5173` → `localhost:5194`) bị trình duyệt tự chặn (không phải lỗi mạng, chỉ hiện
      "blocked by CORS policy" trong Console) — verify thực tế bằng `curl` giả lập header `Origin`,
      xác nhận thiếu `Access-Control-Allow-Origin` trước khi sửa, có đúng header sau khi thêm
      `AddCors`/`UseCors`. Danh sách origin cho phép đọc từ `Cors:AllowedOrigins` trong appsettings
      (mặc định `http://localhost:5173`), không dùng `AllowAnyOrigin` vì token nằm trong header
      `Authorization`. **Các service khác (WorkSpace, Chat, Media, Admin) Frontend sẽ gọi trực tiếp ở
      các phase sau (F1+) cũng sẽ cần cấu hình CORS tương tự — chưa làm, cần nhớ khi tới phase đó.**
- [x] `GET /users/me`
- [x] `PATCH /users/me/nickname`
- [x] `GET /internal/users/{userId}`
- [x] `GET /internal/users` (batch)
- [x] `POST /internal/users/{userId}/unlock`
- [x] `GET /users/search?q=` — tìm user theo nickname (`ILIKE`), phục vụ tính năng bạn bè mới thêm
      (xem bảng `friendships` bên dưới)

**Tính năng "bạn bè" — tự thiết kế hoàn toàn (không có trong tài liệu gốc)**

Tài liệu gốc chỉ nhắc "bạn bè" ở Media Service (UC-32, mời tham gia cuộc họp) nhưng CHƯA TỪNG thiết
kế bảng/API cho quan hệ này ở bất kỳ service nào (đã ghi nhận ở mục 7.4 lúc build Media Service —
lúc đó tạm thay bằng kiểm tra tối thiểu "user có tồn tại"). Frontend F1.5 cần tính năng thật (tìm
bạn/kết bạn/xoá bạn) nên thiết kế mới tại đây, đặt ở Identity Service (nơi quản lý danh tính user).

Cơ chế: gửi lời mời + đối phương chấp nhận (giống Facebook/Zalo, KHÔNG kết bạn ngay lập tức — tránh
spam kết bạn hàng loạt). Bảng `friendships` (1 dòng/cặp quan hệ, `UNIQUE INDEX` theo cặp không phân
biệt thứ tự — cùng pattern với `idx_conversations_p2p_pair` bên Chat DB): `status` chỉ có
`pending`/`accepted` — từ chối hoặc huỷ lời mời thì XOÁ thẳng dòng đó (không lưu `rejected` vĩnh
viễn), cho phép gửi lại lời mời sau này.

- [x] `POST /friends/requests` — gửi lời mời. Nếu đối phương ĐÃ gửi lời mời cho mình trước đó
      (chiều ngược lại, `Pending`) thì tự động ghép đôi (`Accepted`) luôn thay vì bắt cả 2 phải vào
      màn hình Accept
- [x] `GET /friends/requests/incoming` — lời mời người khác gửi đến mình
- [x] `GET /friends/requests/outgoing` — lời mời mình đã gửi (Frontend dùng để hiện trạng thái "Đã
      gửi lời mời" thay vì nút Kết bạn khi tìm kiếm lại)
- [x] `POST /friends/requests/{id}/accept`
- [x] `DELETE /friends/requests/{id}` — dùng chung cho "từ chối lời mời đến" (người nhận) và "huỷ
      lời mời đã gửi" (người gửi), phân biệt qua ai là người gọi
- [x] `GET /friends` — danh sách bạn bè đã chấp nhận
- [x] `DELETE /friends/{userId}` — huỷ kết bạn

Verify thực tế qua `curl`: Alice tìm thấy Bob qua `/users/search`, gửi lời mời → Bob thấy trong
`incoming` → Bob accept → cả 2 phía đều thấy nhau trong `/friends` → gửi lại lời mời lúc đã là bạn
bè trả đúng `409 already_friends` → unfriend → danh sách rỗng lại. Đã dọn dữ liệu test sau khi xong.

**Tích hợp**
- [x] Publish `Login` / `Register History` lên Kafka — topic `identity.auth-history`
- [~] Consumer RabbitMQ: `Khóa tài khoản` xong (`AccountLockedConsumerService`, queue
      `identity.account-locked`, format message tự giả định vì SpamTrackingService — bên gửi —
      chưa tồn tại, cần đối chiếu lại ở Phase 3); **`Delete Account Spam` CHƯA làm**
- [~] Redis: OTP + logout blocklist đã dùng Redis, nhưng **chưa có "session sau đăng nhập"**
      riêng như mô tả gốc (JWT hiện là stateless, không lưu session record lúc login)
- [x] Lưu OTP tạm trong Redis (TTL 10 phút)

**Chưa làm:** gửi OTP qua email dùng Gmail SMTP cá nhân (tạm cho dev — cần đổi sang
SMTP/SES/SendGrid "thật" trước khi lên staging/prod); deploy Identity Service vào K8s thật (đã có
Dockerfile + guide GHCR, chưa push/apply).


---

## 4. Admin Service

*Không có database riêng — hoạt động như lớp điều phối, không có mục "Thiết kế CSDL".*

### 4.1 Mô tả

**Quản lý người dùng**
- Xem danh sách toàn bộ người dùng trong hệ thống.
- Xem danh sách người dùng vi phạm spam (phối hợp SpamTrackingService).
- Xem xét, ra quyết định cấm hoặc gỡ cấm tài khoản.

**Xử lý khiếu nại**
- Tiếp nhận khiếu nại từ user bị cấm qua kênh Chat Service riêng, tách biệt khỏi chat thông thường, vẫn truy cập được kể cả khi tài khoản đã bị khoá.
- Lịch sử chat khiếu nại lưu tạm trong Redis, TTL 10 tiếng — không lưu vĩnh viễn vì bằng chứng chính thức đã có qua email.

**Giám sát và vận hành hạ tầng**
- Xem tiêu thụ tài nguyên hệ thống, gọi trực tiếp K8s API bằng **K8s Service Account riêng, RBAC read-only** (`get`/`list` trên `pods`, `nodes`, `metrics.k8s.io`), phụ thuộc Metrics Server đã cài trong cluster.
- Yêu cầu mở rộng (scale) service, yêu cầu dựng thêm server LiveKit + TURN — các thao tác này cần quyền ghi K8s, phải cấp thêm RBAC Role riêng (patch trên `deployments/scale`), tách biệt khỏi Role read-only dùng để xem tài nguyên.

**Đặc điểm kiến trúc:** không có DB riêng — hoạt động như lớp điều phối, kéo dữ liệu từ Identity DB và SpamTrackingService.

---

### 4.2 API (OpenAPI 3.0)

```yaml
openapi: 3.0.3
info:
  title: Admin Service API
  version: "1.0.0"
  description: |
    API cho Admin Service — quản lý người dùng, xử lý spam/khiếu nại, giám sát
    và vận hành hạ tầng. Tham chiếu Use Case: UC-10 đến UC-16.

    Toàn bộ endpoint yêu cầu JWT có claim role = "admin" (chỉ Admin Page mới
    gọi được). Admin Service không có DB riêng — hoạt động như lớp điều phối,
    nội bộ gọi sang Identity Service, SpamTrackingService, Chat Service, và
    K8s API tuỳ endpoint.

servers:
  - url: https://api.example.com/admin
    description: Qua API Gateway (Nginx) — rate limit + JWT check áp dụng ở tầng Gateway

tags:
  - name: Users
    description: Quản lý người dùng & xử lý spam (UC-10, UC-11, UC-12)
  - name: Complaints
    description: Xử lý khiếu nại từ tài khoản bị khoá (UC-13)
  - name: Infrastructure
    description: Giám sát tài nguyên & yêu cầu mở rộng hạ tầng (UC-14, UC-15, UC-16)

security:
  - bearerAuth: []

paths:
  # ============== USERS & SPAM ==============
  /admin/users:
    get:
      tags: [Users]
      summary: Xem danh sách toàn bộ người dùng trong hệ thống
      description: Tham chiếu UC-10. Nội bộ gọi Identity Service.
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: pageSize
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
        - name: search
          in: query
          description: Tìm theo nickname hoặc email
          schema:
            type: string
      responses:
        "200":
          description: Danh sách người dùng (có phân trang)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PaginatedUsers"
        "502":
          description: Identity Service không phản hồi (UC-10, luồng ngoại lệ 3a) — không có cache dự phòng
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /admin/users/{userId}:
    get:
      tags: [Users]
      summary: Xem chi tiết 1 người dùng, kèm lịch sử vi phạm nếu có
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Chi tiết người dùng
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AdminUserDetail"
        "404":
          description: Không tìm thấy
    delete:
      tags: [Users]
      summary: Xoá vĩnh viễn tài khoản (vì spam)
      description: >-
        Tham chiếu UC-12, nhánh 3b. Publish sự kiện `Delete Account Spam`
        qua RabbitMQ (bất đồng bộ) — Identity Service consume và thực thi
        xoá thật. Response 202 nghĩa là yêu cầu đã được chấp nhận, không
        đảm bảo đã xoá xong tại thời điểm trả response.
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "202":
          description: Yêu cầu xoá đã được publish, đang xử lý bất đồng bộ
        "409":
          description: >-
            Tài khoản đang có khiếu nại chưa xử lý xong (UC-12, luồng ngoại
            lệ 2a) — Admin cần xử lý UC-13 trước. Đây là ràng buộc ĐỀ XUẤT
            thêm khi thiết kế API, vì use case gốc ghi nhận đây là "quy
            trình làm việc" chứ chưa phải ràng buộc hệ thống bắt buộc;
            có thể bỏ qua nếu không muốn chặn cứng.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /admin/spam-violations:
    get:
      tags: [Users]
      summary: Xem danh sách người dùng vi phạm spam
      description: >-
        Tham chiếu UC-11. Nội bộ gọi SpamTrackingService — dữ liệu xử lý
        bất đồng bộ từ Kafka Chat Log nên có thể chưa phản ánh vi phạm vừa
        xảy ra trong vài giây/phút gần nhất (UC-11, luồng ngoại lệ 2a).
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: pageSize
          in: query
          schema:
            type: integer
            default: 20
      responses:
        "200":
          description: Danh sách vi phạm
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items:
                      $ref: "#/components/schemas/SpamViolation"
                  total:
                    type: integer

  /admin/users/{userId}/unlock:
    post:
      tags: [Users]
      summary: Gỡ khoá tài khoản
      description: >-
        Tham chiếu UC-12, nhánh 3a. Gọi đồng bộ tới Identity Service
        (`POST /internal/users/{userId}/unlock`) để có phản hồi ngay.
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Gỡ khoá thành công
        "404":
          description: Không tìm thấy user

  # ============== COMPLAINTS ==============
  /admin/complaints:
    get:
      tags: [Complaints]
      summary: Danh sách khiếu nại đang chờ xử lý
      description: >-
        Tham chiếu UC-13. Đọc từ Redis cache (TTL 10 tiếng) qua Chat Service
        — khiếu nại quá 10 tiếng sẽ không còn xuất hiện trong danh sách này
        vì dữ liệu đã bị xoá theo TTL.
      responses:
        "200":
          description: Danh sách khiếu nại
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/ComplaintSummary"

  /admin/complaints/{userId}:
    get:
      tags: [Complaints]
      summary: Xem toàn bộ nội dung khiếu nại của 1 user
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Nội dung hội thoại khiếu nại
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/ComplaintMessage"
        "404":
          description: >-
            Không còn dữ liệu — khiếu nại đã quá 10 tiếng, Redis đã tự xoá
            theo TTL (UC-13, luồng ngoại lệ 2a). Với Guest, không có bằng
            chứng thay thế qua email (xem UC-09).

  /admin/complaints/{userId}/reply:
    post:
      tags: [Complaints]
      summary: Admin phản hồi trong kênh khiếu nại
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [message]
              properties:
                message:
                  type: string
      responses:
        "201":
          description: Phản hồi đã được gửi
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ComplaintMessage"

  # ============== INFRASTRUCTURE ==============
  /admin/system/resources:
    get:
      tags: [Infrastructure]
      summary: Xem thông tin tiêu thụ tài nguyên hệ thống
      description: >-
        Tham chiếu UC-14. Gọi trực tiếp K8s API bằng Service Account riêng,
        RBAC read-only (get/list trên pods, nodes, metrics.k8s.io).
      responses:
        "200":
          description: Số liệu tài nguyên hiện tại
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SystemResources"
        "503":
          description: >-
            Metrics Server chưa được cài trong cluster (UC-14, luồng ngoại
            lệ 2a) — chỉ trả được thông tin pod/node cơ bản, không có CPU/RAM
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /admin/system/services/{serviceName}/scale:
    post:
      tags: [Infrastructure]
      summary: Yêu cầu mở rộng (scale) 1 service
      description: >-
        Tham chiếu UC-15. **Lưu ý vận hành:** Service Account của Admin
        Service mặc định chỉ có quyền read-only trên K8s (dùng cho
        /admin/system/resources) — endpoint này cần một RBAC Role RIÊNG,
        chỉ cho phép patch trên `deployments/scale`, mới gọi được K8s API
        thành công. Xem UC-15, mục Ghi chú/Điểm mở.
      parameters:
        - name: serviceName
          in: path
          required: true
          schema:
            type: string
            example: chat-service
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [replicas]
              properties:
                replicas:
                  type: integer
                  minimum: 1
      responses:
        "202":
          description: Yêu cầu scale đã được gửi tới K8s
        "403":
          description: Service Account chưa có quyền ghi cần thiết (xem mô tả endpoint)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /admin/system/livekit/expand:
    post:
      tags: [Infrastructure]
      summary: Yêu cầu dựng thêm server LiveKit + TURN
      description: >-
        Tham chiếu UC-16. Cùng vướng vấn đề quyền hạn K8s như endpoint scale
        ở trên. Nếu quy trình chưa tự động hoá hoàn toàn, response 202 ở
        đây chỉ có nghĩa "đã tạo yêu cầu/ticket cho đội vận hành", không
        đảm bảo node mới có ngay lập tức (UC-16, luồng ngoại lệ 2b).
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                reason:
                  type: string
                  example: "Cụm hiện tại thường xuyên đầy 100 người/room vào giờ cao điểm"
      responses:
        "202":
          description: Yêu cầu đã được ghi nhận

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    AdminUserDetail:
      type: object
      properties:
        id:
          type: integer
          format: int64
        userType:
          type: string
          enum: [guest, registered]
        nickname:
          type: string
        email:
          type: string
          nullable: true
        status:
          type: string
          enum: [active, locked]
        createdAt:
          type: string
          format: date-time
        lastActiveAt:
          type: string
          format: date-time
        violations:
          type: array
          items:
            $ref: "#/components/schemas/SpamViolation"

    PaginatedUsers:
      type: object
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/AdminUserDetail"
        total:
          type: integer
        page:
          type: integer
        pageSize:
          type: integer

    SpamViolation:
      type: object
      properties:
        userId:
          type: integer
          format: int64
        nickname:
          type: string
        detectedAt:
          type: string
          format: date-time
        reason:
          type: string
          description: >-
            Diễn giải lý do bị đánh dấu vi phạm — thuật toán/ngưỡng cụ thể
            thuộc phạm vi nghiệp vụ riêng của SpamTrackingService (xem UC-38)
        accountStatus:
          type: string
          enum: [locked, deleted]

    ComplaintSummary:
      type: object
      properties:
        userId:
          type: integer
          format: int64
        nickname:
          type: string
        lastMessageAt:
          type: string
          format: date-time
        expiresAt:
          type: string
          format: date-time
          description: Thời điểm Redis sẽ tự xoá nội dung (10 tiếng kể từ tin đầu tiên)

    ComplaintMessage:
      type: object
      properties:
        senderId:
          type: integer
          format: int64
          description: id của user khiếu nại hoặc null nếu là Admin
          nullable: true
        senderRole:
          type: string
          enum: [user, admin]
        message:
          type: string
        createdAt:
          type: string
          format: date-time

    SystemResources:
      type: object
      properties:
        pods:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              cpuUsage:
                type: string
                example: "120m"
              memoryUsage:
                type: string
                example: "256Mi"
        nodes:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              cpuUsage:
                type: string
              memoryUsage:
                type: string

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
```
### 4.3 Tiến độ triển khai

**API**
- [x] `GET /admin/users` — phân trang + tìm theo nickname/email (ILIKE), gọi
      `GET /internal/users/admin-list` (Identity Service, endpoint mới).
      502 khi Identity Service không phản hồi.
- [x] `GET /admin/users/{userId}` — gộp `AdminUserInfo` (Identity, endpoint
      mới `GET /internal/users/{userId}/admin-detail`) + `violations`
      (SpamTrackingService, tái dùng `GET /internal/violations/{userId}`
      có sẵn từ Phase 3).
- [x] `DELETE /admin/users/{userId}` — publish `identity.delete-account-spam`
      qua RabbitMQ (bất đồng bộ, Identity Service consume — tái dùng
      `AccountLockedConsumerService` có sẵn từ Phase 3). Verify thực tế:
      publish → Identity Service xoá cứng user → `GET /internal/users/{id}`
      trả 404. **Ràng buộc 409 ĐÃ triển khai** (đề xuất trong OpenAPI spec,
      không bắt buộc theo use case gốc): chặn xoá nếu user còn khiếu nại
      đang mở (kiểm tra qua `GET /internal/complaints` của Chat Service) —
      verify thực tế trả 409 khi có khiếu nại, 202 khi không.
- [x] `GET /admin/spam-violations` — proxy `GET /internal/violations`
      (SpamTrackingService, có sẵn từ Phase 3), không thêm logic mới.
- [x] `POST /admin/users/{userId}/unlock` — gọi đồng bộ
      `POST /internal/users/{userId}/unlock` (Identity Service, có sẵn từ
      Phase 1/3).
- [x] `GET /admin/complaints` — gọi `GET /internal/complaints` (Chat Service,
      endpoint mới). **Quyết định tự đưa ra:** Redis chỉ lưu theo key
      `complaint:{userId}` (TTL), không có cách liệt kê "toàn bộ khiếu nại
      đang mở" trực tiếp → thêm 1 Redis Set `complaints:active` làm index
      (thêm userId khi có tin nhắn ĐẦU TIÊN từ user, dọn dẹp lazy: nếu key
      chính đã hết TTL thì tự xoá khỏi index khi đọc).
- [x] `GET /admin/complaints/{userId}` — gọi `GET /internal/complaints/{userId}`
      (Chat Service, endpoint mới), 404 nếu đã hết TTL/không tồn tại.
- [x] `POST /admin/complaints/{userId}/reply` — gọi
      `POST /internal/complaints/{userId}/reply` (Chat Service, endpoint
      mới) — ghi vào CÙNG key Redis với kênh khiếu nại của Chat Service,
      `senderRole="admin"`, KHÔNG tính là "tin đầu tiên" cho mốc TTL (chỉ
      user mới mở được khiếu nại mới). Verify thực tế: user gửi → admin
      list thấy → admin xem chi tiết → admin reply → xuất hiện trong lịch
      sử.
- [x] `GET /admin/system/resources` — gọi K8s API thật qua
      `k8s.CustomObjects.ListClusterCustomObjectAsync("metrics.k8s.io",
      "v1beta1", "pods"/"nodes")`. Verify thực tế trên cluster
      `docker-desktop` (Metrics Server đã cài — xem Phase 0): phát hiện
      **quirk môi trường** — Metrics Server trên K8s bundle của Docker
      Desktop chỉ phục vụ đúng khi request có `Accept:
      application/vnd.kubernetes.protobuf` (cách `kubectl top` dùng);
      request `Accept: application/json` (mặc định của `kubectl get --raw`
      VÀ của thư viện `KubernetesClient` dùng trong code) bị 404. Do đó khi
      test thực tế, endpoint trả đúng nhánh lỗi 503 của OpenAPI spec (chưa
      test được nhánh 200 thành công trên môi trường dev này) — code xử lý
      lỗi (bắt `HttpOperationException`, map sang 503) đã verify đúng, chỉ
      chưa verify được response 200 thực tế do giới hạn môi trường dev, KHÔNG
      phải lỗi code. Trên server nhà (k3s) cần kiểm tra lại xem có gặp quirk
      tương tự không.
- [x] `POST /admin/system/services/{serviceName}/scale` — gọi
      `AppsV1.PatchNamespacedDeploymentScaleAsync` (merge patch
      `spec.replicas`), bắt `HttpOperationException` 403 → map sang 403
      response. Chưa test thực tế với RBAC Role đầy đủ (xem mục K8s RBAC
      dưới) — chỉ review code, chưa gọi thật.
- [x] `POST /admin/system/livekit/expand` — chỉ ghi log (chưa có quy trình
      tự động hoá dựng LiveKit + TURN mới), đúng như luồng ngoại lệ 2b của
      UC-16 đã mô tả trong OpenAPI spec (202 = "đã ghi nhận yêu cầu", không
      đảm bảo hạ tầng mới có ngay).

**Tích hợp**
- [x] Gọi nội bộ Identity Service (danh sách user, unlock)
- [x] Gọi nội bộ SpamTrackingService (danh sách/chi tiết vi phạm)
- [x] Gọi nội bộ Chat Service (đọc/phản hồi khiếu nại)
- [x] Publish `Delete Account Spam` qua RabbitMQ
- [x] K8s Service Account read-only (`get`/`list` trên pods, nodes,
      metrics.k8s.io) — `Tainguyen/infra/adminservice-rbac.yaml`
      (`ClusterRole admin-service-readonly`). Chưa deploy thật (Admin
      Service chưa được đóng gói lên K8s — chạy `dotnet run`/Docker cục bộ
      lúc test, dùng kubeconfig thường thay vì Service Account).
- [x] K8s Role RIÊNG cho phép `patch` trên `deployments/scale` (tách khỏi
      Role read-only ở trên) — cùng file, `ClusterRole admin-service-scale`.
- [x] Xác nhận Metrics Server đã cài trong cluster — có (`docker-desktop`,
      cài từ Phase 0), nhưng xem quirk Accept header ở trên.

**Quyết định tự đưa ra khác (không có trong tài liệu gốc):**
- Tài liệu gốc yêu cầu "JWT có claim `role=admin`" nhưng KHÔNG mô tả luồng
  đăng ký/tạo tài khoản Admin nào cả (không có UI/API riêng). Tự thiết kế:
  thêm cột `users.is_admin BOOLEAN DEFAULT false` (Identity DB, ALTER TABLE
  trên instance đang chạy), `JwtTokenService` chỉ gán claim `role=admin` khi
  `IsAdmin=true`. Cấp quyền admin hiện là thao tác thủ công qua
  `POST /internal/users/{userId}/promote-admin` (nội bộ/CLI, KHÔNG public) —
  chưa có UI quản trị nào gọi endpoint này, cần làm thủ công qua `curl`/CLI
  cho tới khi có quy trình chính thức.
- Admin Service không có DB riêng (đúng như tài liệu gốc ghi) — hoàn toàn là
  lớp điều phối, dùng `HttpClient` gọi 3 service + `RabbitMQ.Client` +
  `KubernetesClient` (thư viện .NET chính thức cho K8s API).


---

## 5. WorkSpace Service

### 5.1 Mô tả

**Quản lý nhóm cơ bản:** tạo nhóm, thay avatar, sửa tên, xoá nhóm (vĩnh viễn), thêm thành viên.

**Phân quyền RBAC 3 tầng:**

| Vai trò | Quyền |
|---|---|
| Trưởng nhóm | Toàn quyền: tạo/xoá nhóm, thay avatar/tên, thêm thành viên, phong hàm, xoá phong hàm, **xoá thành viên (kick)** |
| Phó nhóm | Thay avatar, sửa tên, thêm thành viên — không có quyền mang tính cấu trúc (không xoá nhóm/phong hàm/kick) |
| Nhóm viên | Xem thông tin, tự rời nhóm |

**Xử lý khi rời/bị xoá khỏi nhóm:** publish thông báo qua RabbitMQ → Identity Services (push notification) → tự ngắt kết nối WebSocket (Signal IR) phía Chat Service → tin nhắn cũ chuyển hiển thị thành "người trong nhóm". **Không** kick khỏi cuộc gọi LiveKit đang diễn ra nếu người đó đang trong phiên họp của nhóm — xử lý độc lập, giống Teams/Zoom (chủ đích).

**Điểm còn để ngỏ:** nếu Trưởng nhóm rời nhóm hoặc bị xoá tài khoản, nhóm sẽ ra sao (tự động thăng Phó nhóm hay "vô chủ")? Chưa được chốt.

**Lưu trữ:** Workspace DB (Postgres), tách biệt hoàn toàn khỏi Social DB.

---

### 5.2 Thiết kế CSDL

#### Bảng `workspaces`

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| name | VARCHAR(100) | NOT NULL | Tên nhóm |
| avatar_url | VARCHAR(500) | NULL | |
| created_by | BIGINT | NOT NULL | Logical FK → users.id — người tạo nhóm ban đầu, mang tính LỊCH SỬ, không dùng để xác định Trưởng nhóm hiện tại |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Cập nhật khi đổi tên/avatar |

#### Bảng `workspace_members`

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| workspace_id | BIGINT | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | |
| user_id | BIGINT | NOT NULL | Logical FK → users.id |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'member', CHECK IN ('leader','deputy','member') | Trưởng nhóm / Phó nhóm / Nhóm viên |
| invited_by | BIGINT | NULL | Logical FK — ai đã thêm thành viên này (audit) |
| joined_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ràng buộc bổ sung:**
- `UNIQUE (workspace_id, user_id)` — 1 user chỉ có 1 vai trò trong 1 workspace.
- `UNIQUE INDEX ON workspace_members(workspace_id) WHERE role = 'leader'` — tối đa 1 Trưởng nhóm/workspace.

**Ghi chú / Điểm mở:**
- Bỏ hẳn cột "owner_id" khỏi `workspaces` — Trưởng nhóm HIỆN TẠI luôn xác định bằng query `workspace_members WHERE role='leader'`, tránh 2 nguồn dữ liệu (workspaces.owner_id và workspace_members.role) lệch nhau khi phong/giáng chức (UC-21).
- **QUYẾT ĐỊNH ĐÃ CHỐT:** Trưởng nhóm rời nhóm = giải tán toàn bộ nhóm, không có khái niệm "nhóm vô chủ". Xoá dòng `role='leader'` trong `workspace_members` sẽ tự động cascade xoá luôn bảng `workspaces` (kéo theo toàn bộ thành viên khác qua `ON DELETE CASCADE` có sẵn) — xem trigger trong DDL. Về bản chất, "Trưởng nhóm tự rời nhóm" và "Xoá nhóm" (UC-19) giờ dùng chung 1 cơ chế, cùng 1 kết quả cuối.

**SQL DDL:**

```sql
CREATE TABLE workspaces (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  avatar_url   VARCHAR(500),
  created_by   BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'member'
                  CHECK (role IN ('leader','deputy','member')),
  invited_by    BIGINT,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE UNIQUE INDEX idx_workspace_one_leader
  ON workspace_members(workspace_id) WHERE role = 'leader';

-- Truong nhom roi nhom = giai tan toan bo nhom (quyet dinh da chot).
-- Xoa dong membership cua Truong nhom se tu dong cascade xoa
-- luon bang workspaces, keo theo toan bo thanh vien khac qua
-- ON DELETE CASCADE co san o workspace_members.workspace_id.
-- Ve ban chat, "Truong nhom tu roi nhom" va "Xoa nhom" (UC-19)
-- gio dung chung 1 co che, cho ra cung 1 ket qua.
CREATE OR REPLACE FUNCTION cascade_delete_workspace_on_leader_leave()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role = 'leader' THEN
    DELETE FROM workspaces WHERE id = OLD.workspace_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cascade_delete_workspace_on_leader_leave
  AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION cascade_delete_workspace_on_leader_leave();
```
### 5.3 API (OpenAPI 3.0)

```yaml
openapi: 3.0.3
info:
  title: WorkSpace Service API
  version: "1.0.0"
  description: |
    API cho WorkSpace Service — quản lý nhóm & phân quyền RBAC (Trưởng nhóm /
    Phó nhóm / Nhóm viên). Tham chiếu Use Case: UC-17 đến UC-24.

servers:
  - url: https://api.example.com/workspace
    description: Qua API Gateway (Nginx) — rate limit + JWT check áp dụng ở tầng Gateway

tags:
  - name: Workspaces
    description: Tạo/sửa/xoá nhóm, xem thông tin (UC-17, UC-18, UC-19, UC-24)
  - name: Members
    description: Thêm/xoá thành viên, phân quyền (UC-20, UC-21, UC-22, UC-23)

security:
  - bearerAuth: []

paths:
  # ============== WORKSPACES ==============
  /workspaces:
    post:
      tags: [Workspaces]
      summary: Tạo nhóm mới
      description: >-
        Tham chiếu UC-17. User gọi endpoint này tự động trở thành Trưởng
        nhóm (role=leader, ghi vào workspace_members; đồng thời lưu
        created_by trên bảng workspaces mang tính lịch sử — xem tài liệu
        thiết kế CSDL mục 5.5).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
                  minLength: 1
                  maxLength: 100
                avatarUrl:
                  type: string
                  nullable: true
      responses:
        "201":
          description: Nhóm được tạo thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Workspace"
        "400":
          description: Tên nhóm trống hoặc không hợp lệ (UC-17, luồng ngoại lệ 3a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /workspaces/{workspaceId}:
    get:
      tags: [Workspaces]
      summary: Xem thông tin nhóm
      description: >-
        Tham chiếu UC-24. Trả kèm danh sách rút gọn thành viên; muốn đầy đủ
        + vai trò từng người, gọi `GET /workspaces/{workspaceId}/members`.
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Thông tin nhóm
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Workspace"
        "403":
          description: User không phải thành viên nhóm này (UC-24, luồng ngoại lệ 1a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

    patch:
      tags: [Workspaces]
      summary: Chỉnh sửa avatar/tên nhóm
      description: Tham chiếu UC-18. Yêu cầu vai trò Trưởng nhóm hoặc Phó nhóm.
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                  maxLength: 100
                avatarUrl:
                  type: string
      responses:
        "200":
          description: Cập nhật thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Workspace"
        "403":
          description: User là Nhóm viên thường, không đủ quyền (UC-18, luồng ngoại lệ 2a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

    delete:
      tags: [Workspaces]
      summary: Xoá nhóm (vĩnh viễn)
      description: >-
        Tham chiếu UC-19. Chỉ Trưởng nhóm được gọi. Hành động KHÔNG thể
        hoàn tác.

        **Lưu ý triển khai quan trọng:** `conversations.workspace_id` bên
        Chat Service chỉ là liên kết logic (khác database vật lý) — xoá
        workspace ở đây KHÔNG tự động dọn lịch sử chat/file liên quan (xem
        tài liệu thiết kế CSDL mục 5.1 và UC-19 phần Ghi chú). WorkSpace
        Service cần chủ động gọi sang Chat Service để dọn dẹp trong cùng
        luồng xử lý của endpoint này, nếu không sẽ phát sinh dữ liệu mồ côi.
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: Xoá thành công
        "403":
          description: User không phải Trưởng nhóm (UC-19, luồng ngoại lệ 2a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  # ============== MEMBERS ==============
  /workspaces/{workspaceId}/members:
    get:
      tags: [Members]
      summary: Danh sách thành viên kèm vai trò
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Danh sách thành viên
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/WorkspaceMember"

    post:
      tags: [Members]
      summary: Thêm thành viên vào nhóm
      description: >-
        Tham chiếu UC-20. Yêu cầu vai trò Trưởng nhóm hoặc Phó nhóm. Thành
        viên mới luôn được gán role='member' mặc định.
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [userId]
              properties:
                userId:
                  type: integer
                  format: int64
      responses:
        "201":
          description: Thêm thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WorkspaceMember"
        "409":
          description: Người dùng đã là thành viên nhóm này (UC-20, luồng ngoại lệ 2a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /workspaces/{workspaceId}/members/{userId}:
    delete:
      tags: [Members]
      summary: Xoá thành viên khỏi nhóm (kick) HOẶC tự rời nhóm
      description: >-
        Endpoint dùng chung cho UC-22 (Xoá thành viên/kick) và UC-23
        (Thành viên tự rời nhóm) — server tự phân biệt theo `userId` trong
        path so với id của người gọi request:

        - Nếu `userId` KHÁC id người gọi → đây là hành động **kick**
          (UC-22), chỉ Trưởng nhóm được phép.
        - Nếu `userId` TRÙNG id người gọi và người gọi là Phó nhóm/Nhóm
          viên → **tự rời** (UC-23), chỉ xoá đúng 1 dòng membership của
          người đó, nhóm tiếp tục tồn tại bình thường.
        - Nếu `userId` TRÙNG id người gọi và người gọi đang là **Trưởng
          nhóm** → hành động này XOÁ LUÔN TOÀN BỘ NHÓM (tương đương gọi
          `DELETE /workspaces/{workspaceId}`), không chỉ riêng dòng
          membership của họ. Đây là quyết định nghiệp vụ đã chốt: Trưởng
          nhóm rời nhóm = giải tán nhóm, không có khái niệm "nhóm vô chủ".
          Thực thi bằng trigger DB (xem tài liệu thiết kế CSDL mục 5.5,
          `trg_cascade_delete_workspace_on_leader_leave`) — xoá dòng
          membership của Trưởng nhóm sẽ tự động cascade xoá luôn bảng
          workspaces và toàn bộ thành viên khác theo.

        Cả 3 trường hợp trên (trừ trường hợp giải tán nhóm) đều kích hoạt
        cùng chuỗi side-effect bất đồng bộ: publish thông báo qua RabbitMQ
        → Identity Services (push notification), tự ngắt kết nối WebSocket
        phía Chat Service, và tin nhắn cũ của người này trong nhóm chuyển
        hiển thị thành "người trong nhóm". Kick (UC-22) KHÔNG kéo theo việc
        đá khỏi cuộc gọi LiveKit đang diễn ra nếu người đó đang trong phiên
        họp của nhóm — xử lý độc lập, chủ đích (giống Teams/Zoom).
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: >-
            Thành công. Nếu người rời là Trưởng nhóm, toàn bộ nhóm đã bị
            xoá theo (không chỉ riêng membership của họ).
        "403":
          description: >-
            Người gọi không phải Trưởng nhóm khi cố kick người khác
            (UC-22, luồng ngoại lệ 2a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /workspaces/{workspaceId}/members/{userId}/role:
    patch:
      tags: [Members]
      summary: Phong hàm / Xoá phong hàm
      description: >-
        Tham chiếu UC-21. Chỉ Trưởng nhóm được gọi. Chỉ hỗ trợ chuyển đổi
        giữa 'member' ↔ 'deputy' — KHÔNG dùng endpoint này để chuyển giao
        vai trò 'leader' (xem ghi chú ở endpoint DELETE members phía trên
        về khoảng trống nghiệp vụ này).
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: integer
            format: int64
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [role]
              properties:
                role:
                  type: string
                  enum: [deputy, member]
                  description: >-
                    'deputy' = Phong hàm (thăng Nhóm viên → Phó nhóm);
                    'member' = Xoá phong hàm (giáng Phó nhóm → Nhóm viên)
      responses:
        "200":
          description: Cập nhật vai trò thành công
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WorkspaceMember"
        "403":
          description: Người gọi không phải Trưởng nhóm (UC-21, luồng ngoại lệ 1c)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "404":
          description: userId không phải thành viên hợp lệ của nhóm (UC-21, luồng ngoại lệ 1d)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    Workspace:
      type: object
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
        avatarUrl:
          type: string
          nullable: true
        createdBy:
          type: integer
          format: int64
          description: Người tạo ban đầu — mang tính lịch sử, KHÔNG phải Trưởng nhóm hiện tại
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time

    WorkspaceMember:
      type: object
      properties:
        userId:
          type: integer
          format: int64
        nickname:
          type: string
          description: Resolve qua Identity Service internal API
        role:
          type: string
          enum: [leader, deputy, member]
        joinedAt:
          type: string
          format: date-time

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
```
### 5.4 Tiến độ triển khai

*Hạ tầng DB: `Tainguyen/infra/workspace-db.yaml` — xem `HUONG-DAN-DEPLOY.md`. Code
service (C#/.NET) chưa viết.*

**Cơ sở dữ liệu**
- [x] Tạo bảng `workspaces`
- [x] Tạo bảng `workspace_members`
- [x] `UNIQUE INDEX idx_workspace_one_leader`
- [x] Trigger `trg_cascade_delete_workspace_on_leader_leave`

**API**
- [x] `GET /workspaces` — **tự đề xuất, thiếu sót phát hiện khi build Frontend F1** ("Danh sách nhóm
      của tôi"): OpenAPI spec gốc chỉ có CRUD theo `{workspaceId}` cụ thể, không có endpoint liệt kê
      theo user đang đăng nhập. Trả `WorkspaceSummaryResponse` kèm `myRole` (vai trò của người gọi
      trong từng nhóm) để Frontend không cần gọi thêm `GET /members` chỉ để biết quyền hiển thị nút
      nào
- [x] CORS — cùng mẫu với Identity Service (mục 4), thiếu sót phát hiện cùng lúc
- [x] `POST /workspaces`
- [x] `GET /workspaces/{workspaceId}`
- [x] `PATCH /workspaces/{workspaceId}`
- [x] `DELETE /workspaces/{workspaceId}`
- [x] `GET /workspaces/{workspaceId}/members`
- [x] `POST /workspaces/{workspaceId}/members`
- [x] `DELETE /workspaces/{workspaceId}/members/{userId}` (kick / tự rời / giải tán nếu là leader) —
      verify cả 3 nhánh (kick 403 nếu không phải leader, tự rời, leader rời giải tán cả nhóm)
- [x] `PATCH /workspaces/{workspaceId}/members/{userId}/role`

**Tích hợp**
- [x] Publish thông báo rời/bị xoá nhóm qua RabbitMQ → Identity Services (queue
      `workspace.member-notifications`) — **Identity Service CHƯA có consumer** cho queue này
      (mới chỉ publish, chưa có bên nhận xử lý push notification thật)
- [x] Gọi Chat Service để dọn dữ liệu chat khi xoá/giải tán workspace — verify cascade xoá đúng
      conversation + message liên quan
- [x] Trigger ngắt WebSocket phía Chat Service khi kick/rời nhóm — `ChatServiceClient.NotifyMemberRemovedAsync`
      gọi `POST /internal/conversations/by-workspace/{workspaceId}/members/{userId}/disconnect` (Chat
      Service, endpoint mới) ngay sau khi xoá thành viên (cả nhánh kick lẫn tự rời) — gỡ khỏi SignalR
      group của đúng conversation đó (không đóng toàn bộ kết nối WebSocket của user, họ có thể vẫn ở
      các conversation/workspace khác), kèm gửi event `KickedFromConversation` cho client dọn UI


---

## 6. Chat Service

### 6.1 Mô tả

**Chat 1-1 (P2P):** gửi tin nhắn (E2EE), ảnh, video (<50MB, tự nén/từ chối nếu vẫn lớn), voice (<25MB), vote. Không hỗ trợ gửi file thông thường (quyết định có chủ đích cho quy mô doanh nghiệp vừa). Tự động xoá toàn bộ cuộc trò chuyện nếu không hoạt động 6 tháng, xoá thẳng không cảnh báo, áp dụng cho **mọi** cuộc chat P2P kể cả giữa 2 Registered User.

**Chat trong Group:** Trưởng nhóm có quyền quản trị phiên (cấm chat/mute, xoá file, xoá tin nhắn), cài giới hạn dung lượng (Free <2GB, Paid theo mức nạp), khoá/mở khoá khi vượt hạn mức — có chuỗi cảnh báo trước khi xoá file: còn 3 ngày → 2 ngày → 1 ngày → 10 tiếng. Thành viên gửi được tin nhắn/ảnh/video/file/voice/vote; gửi File (kể cả video dạng file gốc) bị trừ vào quota nhóm, khác với "Gửi Video" có nén riêng.

**Chat trong Khiếu nại:** kênh tách biệt, truy cập được kể cả khi tài khoản bị khoá. Lịch sử lưu Redis TTL 10 tiếng.

**Lưu trữ:** Social/Chat DB (Postgres) là nguồn sự thật; Redis cache đồng bộ qua Kafka (`Chat Service Log` → consumer `Write Chat`), tách khỏi write path chính. Tìm kiếm theo channel: nếu message <10.000 **và** thời gian <10 ngày → Redis; nếu vượt 1 trong 2 → Postgres. File đính kèm lưu MinIO.

---

### 6.2 Thiết kế CSDL

#### Bảng `conversations`

Đại diện cho 1 cuộc trò chuyện, dùng chung cho cả P2P và Group.

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| type | VARCHAR(10) | NOT NULL, CHECK IN ('p2p','group') | |
| workspace_id | BIGINT | NULL | Logical FK → workspaces.id — chỉ có giá trị khi type='group' |
| participant_a_id | BIGINT | NULL | Logical FK → users.id — chỉ có giá trị khi type='p2p' |
| participant_b_id | BIGINT | NULL | Logical FK → users.id — chỉ có giá trị khi type='p2p' |
| last_message_at | TIMESTAMPTZ | NULL | Dùng cho cron job auto-xoá P2P sau 6 tháng (UC-26) và Search Chat Service |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ràng buộc bổ sung:**
- CHECK đảm bảo đúng field đi kèm đúng loại type (p2p ↔ participant_a/b_id; group ↔ workspace_id).
- `UNIQUE INDEX` theo cặp (LEAST, GREATEST) của participant_a_id/participant_b_id WHERE type='p2p' — tránh trùng nhiều cuộc P2P giữa cùng 1 cặp user.
- `UNIQUE (workspace_id) WHERE type='group'` — giả định mỗi workspace chỉ có đúng 1 group conversation (chưa hỗ trợ nhiều kênh/channel con).

#### Bảng `messages`

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| conversation_id | BIGINT | NOT NULL, FK → conversations(id) ON DELETE CASCADE | |
| sender_id | BIGINT | NULL | Logical FK → users.id — NULL nghĩa là tin nhắn hệ thống (VD: thông báo mời họp, UC-31) |
| type | VARCHAR(20) | NOT NULL, CHECK IN ('text','image','video','file','voice','vote','system') | |
| content | TEXT | NULL | Nội dung text/caption; media chi tiết nằm ở bảng files |
| is_deleted | BOOLEAN | NOT NULL, DEFAULT false | Soft-delete khi Trưởng nhóm xoá tin nhắn (UC-28) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

#### Bảng `group_chat_settings`

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| conversation_id | BIGINT | PRIMARY KEY, FK → conversations(id) ON DELETE CASCADE | 1–1 với conversation kiểu group |
| plan | VARCHAR(10) | NOT NULL, DEFAULT 'free', CHECK IN ('free','paid') | |
| storage_quota_bytes | BIGINT | NOT NULL, DEFAULT 2147483648 | Mặc định 2GB |
| storage_used_bytes | BIGINT | NOT NULL, DEFAULT 0 | Đồng bộ tự động qua trigger |
| is_locked | BOOLEAN | NOT NULL, DEFAULT false | true khi vượt hạn mức không gia hạn (UC-29) |
| storage_expires_at | TIMESTAMPTZ | NULL | Mốc hết hạn hiện tại |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

#### Bảng `muted_members`

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| conversation_id | BIGINT | NOT NULL, FK → conversations(id) ON DELETE CASCADE | Chỉ có ý nghĩa với type='group' |
| user_id | BIGINT | NOT NULL | Logical FK — người bị cấm chat |
| muted_by | BIGINT | NOT NULL | Logical FK — luôn là Trưởng nhóm (UC-28) |
| muted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ràng buộc bổ sung:** `UNIQUE (conversation_id, user_id)`. Giả định mute có hiệu lực vĩnh viễn tới khi Trưởng nhóm chủ động gỡ (xoá dòng), vì UC-28 chưa quy định thời hạn cụ thể.

#### Bảng `files`

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| conversation_id | BIGINT | NOT NULL, FK → conversations(id) ON DELETE CASCADE | Dùng để tính tổng dung lượng theo nhóm |
| message_id | BIGINT | NULL, FK → messages(id) ON DELETE CASCADE | Tin nhắn đính kèm file này |
| uploaded_by | BIGINT | NOT NULL | Logical FK |
| object_key | VARCHAR(500) | NOT NULL | Đường dẫn object trong kho lưu trữ |
| file_type | VARCHAR(20) | NOT NULL, CHECK IN ('image','video','voice','file') | |
| size_bytes | BIGINT | NOT NULL | Dùng cộng/trừ storage_used_bytes qua trigger |
| storage_provider | VARCHAR(20) | NOT NULL, DEFAULT 'home' | Kho chứa file: `home` = MinIO máy nhà, `cloud` = R2/S3/MinIO thứ hai. Chốt **một lần lúc upload** theo `size_bytes` vs `Storage:HomeMaxBytes` (mặc định 20MB) rồi giữ nguyên |
| uploaded_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ghi chú / Điểm mở:**
- Hiển thị "người trong nhóm" khi 1 thành viên bị xoá khỏi group (UC-22) được **TÍNH ĐỘNG** lúc truy vấn (join sender_id với workspace_members), KHÔNG lưu cứng vào bảng messages — rẻ hơn nhiều so với update hàng loạt message rows.
- Edge case chưa xác nhận: nếu người bị xoá được thêm lại vào nhóm, theo cách tính động ở trên thì TOÀN BỘ tin nhắn cũ của họ sẽ tự động hiện lại tên thật. Nếu muốn ẩn danh giữ nguyên vĩnh viễn, cần đổi sang lưu cứng (snapshot).
- **Vì sao `storage_provider` lưu cứng chứ không tính lại theo ngưỡng lúc tải về:** file đã upload thì không tự di chuyển, nên chỉ cột này mới nói đúng nó đang nằm ở đâu — nhờ vậy đổi `HomeMaxBytes` sau này không làm hỏng file cũ. Hạn mức 2GB/nhóm không đổi: trigger `sync_storage_used()` cộng theo `size_bytes` bất kể file ở kho nào. Chi tiết + cạm bẫy (mixed content, CORS, presign là phép tính offline nên cấu hình sai endpoint không báo lỗi lúc khởi động) xem `Tainguyen/infra/HUONG-DAN-DEPLOY.md` mục 3.1.
- Giả định 1 workspace = đúng 1 group conversation. Nếu sau này muốn hỗ trợ nhiều channel trong 1 workspace, cần bỏ ràng buộc UNIQUE(workspace_id) và có thêm khái niệm "channel" riêng.
- `storage_used_bytes` có nguy cơ lệch nếu tăng/giảm không atomic — đã thêm 2 trigger đồng bộ tự động (xem DDL).

**SQL DDL:**

```sql
CREATE TABLE conversations (
  id                 BIGSERIAL PRIMARY KEY,
  type               VARCHAR(10) NOT NULL CHECK (type IN ('p2p','group')),
  workspace_id       BIGINT,
  participant_a_id   BIGINT,
  participant_b_id   BIGINT,
  last_message_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_conversation_shape CHECK (
    (type = 'p2p'   AND workspace_id IS NULL
                    AND participant_a_id IS NOT NULL
                    AND participant_b_id IS NOT NULL)
    OR
    (type = 'group' AND workspace_id IS NOT NULL
                    AND participant_a_id IS NULL
                    AND participant_b_id IS NULL)
  )
);

CREATE UNIQUE INDEX idx_conversations_p2p_pair
  ON conversations (
    LEAST(participant_a_id, participant_b_id),
    GREATEST(participant_a_id, participant_b_id)
  ) WHERE type = 'p2p';

CREATE UNIQUE INDEX idx_conversations_one_per_workspace
  ON conversations (workspace_id) WHERE type = 'group';

CREATE INDEX idx_conversations_last_message_p2p
  ON conversations(last_message_at) WHERE type = 'p2p';

CREATE TABLE messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        BIGINT,
  type             VARCHAR(20) NOT NULL
                     CHECK (type IN ('text','image','video','file','voice','vote','system')),
  content          TEXT,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_time
  ON messages(conversation_id, created_at);

CREATE TABLE group_chat_settings (
  conversation_id       BIGINT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  plan                  VARCHAR(10) NOT NULL DEFAULT 'free' CHECK (plan IN ('free','paid')),
  storage_quota_bytes   BIGINT NOT NULL DEFAULT 2147483648,
  storage_used_bytes    BIGINT NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  is_locked             BOOLEAN NOT NULL DEFAULT false,
  storage_expires_at    TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE muted_members (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          BIGINT NOT NULL,
  muted_by         BIGINT NOT NULL,
  muted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE files (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  uploaded_by      BIGINT NOT NULL,
  object_key       VARCHAR(500) NOT NULL,
  file_type        VARCHAR(20) NOT NULL
                     CHECK (file_type IN ('image','video','voice','file')),
  size_bytes       BIGINT NOT NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_conversation ON files(conversation_id);

-- Trigger: tu dong cong/tru storage_used_bytes khi them/xoa file,
-- tranh phai tu tinh toan roi rac o tang ung dung (de bi lech).
CREATE OR REPLACE FUNCTION sync_storage_used()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE group_chat_settings
      SET storage_used_bytes = storage_used_bytes + NEW.size_bytes,
          updated_at = now()
      WHERE conversation_id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE group_chat_settings
      SET storage_used_bytes = storage_used_bytes - OLD.size_bytes,
          updated_at = now()
      WHERE conversation_id = OLD.conversation_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_files_insert_sync_storage
  AFTER INSERT ON files
  FOR EACH ROW EXECUTE FUNCTION sync_storage_used();

CREATE TRIGGER trg_files_delete_sync_storage
  AFTER DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION sync_storage_used();
```

---

### 6.3 API (OpenAPI 3.0)

```yaml
openapi: 3.0.3
info:
  title: Chat Service API
  version: "1.0.0"
  description: |
    API cho Chat Service — chat 1-1 (P2P), chat nhóm (Group), và kênh Khiếu
    nại. Tham chiếu Use Case: UC-25 đến UC-30 (và UC-09 phía user).

    Realtime (nhận tin nhắn mới, presence) đi qua WebSocket (Signal IR),
    KHÔNG nằm trong phạm vi OpenAPI này — file này chỉ mô tả REST API đồng
    bộ (gửi tin nhắn, quản trị, tra cứu lịch sử).

servers:
  - url: https://api.example.com/chat
    description: Qua API Gateway (Nginx) — rate limit + JWT check áp dụng ở tầng Gateway

tags:
  - name: Conversations
    description: Tạo/xem cuộc trò chuyện
  - name: Messages
    description: Gửi/xoá/tra cứu tin nhắn (UC-25, UC-27, UC-28)
  - name: Files
    description: Upload & quản lý file đính kèm (UC-28)
  - name: Moderation
    description: Cấm chat, quản lý dung lượng nhóm (UC-28, UC-29)
  - name: Complaints
    description: Khiếu nại khi tài khoản bị khoá (UC-09, UC-30) — phía user

security:
  - bearerAuth: []

paths:
  # ============== CONVERSATIONS ==============
  /conversations/p2p:
    post:
      tags: [Conversations]
      summary: Tạo hoặc lấy cuộc trò chuyện P2P với 1 user
      description: >-
        Idempotent theo cặp user: nếu đã tồn tại cuộc trò chuyện P2P giữa 2
        người (ràng buộc UNIQUE theo cặp — xem tài liệu thiết kế CSDL mục
        5.6), trả về cuộc trò chuyện đã có thay vì tạo mới.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [otherUserId]
              properties:
                otherUserId:
                  type: integer
                  format: int64
      responses:
        "200":
          description: Trả về cuộc trò chuyện (mới tạo hoặc đã có sẵn)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Conversation"

  /conversations/{conversationId}:
    get:
      tags: [Conversations]
      summary: Xem thông tin 1 cuộc trò chuyện
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      responses:
        "200":
          description: Thông tin cuộc trò chuyện
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Conversation"
        "403":
          description: User không phải thành viên/không thuộc cuộc trò chuyện này

  # ============== MESSAGES ==============
  /conversations/{conversationId}/messages:
    get:
      tags: [Messages]
      summary: Lấy lịch sử tin nhắn
      description: >-
        Phía server tự quyết định nguồn dữ liệu theo logic Search Chat
        Service: nếu số tin nhắn của conversation < 10.000 VÀ tin nhắn
        trong vòng 10 ngày gần nhất → đọc Redis (nhanh); nếu vượt 1 trong 2
        mốc → query trực tiếp Postgres. Client không cần biết/chọn nguồn,
        chỉ nhận kết quả giống nhau. Xem UC-25/UC-27 và Use Case UC-39.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
        - name: before
          in: query
          description: Lấy tin nhắn trước thời điểm này (phân trang dạng cursor)
          schema:
            type: string
            format: date-time
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
            maximum: 200
      responses:
        "200":
          description: Danh sách tin nhắn, mới nhất trước
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Message"

    post:
      tags: [Messages]
      summary: Gửi tin nhắn (text/ảnh/video/file/voice/vote)
      description: >-
        Tham chiếu UC-25 (P2P) và UC-27 (Group). Áp rule tuỳ loại nội dung
        và loại conversation:

        - `type=video`: >50MB tự động nén; từ chối nếu nén xong vẫn quá
          giới hạn (413).
        - `type=voice`: chỉ chấp nhận <25MB (413 nếu vượt).
        - `type=file`: **CHỈ hợp lệ với conversation type='group'** — chat
          1-1 không hỗ trợ gửi File (quyết định có chủ đích, xem UC-25 Ghi
          chú). Gửi file trong P2P trả lỗi 422.
        - `type=file` trong group: bị trừ vào quota lưu trữ của nhóm, có
          thể trả 507 nếu vượt hạn mức (xem endpoint storage bên dưới).

        Với `type` khác `text`, trường `fileId` phải tham chiếu tới file đã
        upload trước đó qua `POST /files/upload-url` (xem tag Files).
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateMessageRequest"
      responses:
        "201":
          description: Tin nhắn đã được gửi
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Message"
        "403":
          description: User đang bị mute trong conversation này (UC-27, luồng ngoại lệ 2a)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "413":
          description: Video/voice vượt giới hạn kích thước sau khi đã thử nén (nếu áp dụng)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "422":
          description: type='file' được gửi trong conversation P2P (không hỗ trợ)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "507":
          description: >-
            Gửi file làm vượt quota lưu trữ của nhóm (UC-27, luồng ngoại lệ
            3a) — cần Trưởng nhóm nạp thêm hoặc xoá bớt file cũ
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /conversations/{conversationId}/messages/{messageId}:
    delete:
      tags: [Messages]
      summary: Xoá tin nhắn (soft-delete)
      description: >-
        Tham chiếu UC-28. Chỉ Trưởng nhóm được gọi (với group). Đánh dấu
        `is_deleted=true`, không xoá cứng khỏi Social DB.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
        - name: messageId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: Đã xoá
        "403":
          description: Người gọi không phải Trưởng nhóm

  # ============== FILES ==============
  /files/upload-url:
    post:
      tags: [Files]
      summary: Lấy presigned URL để upload trực tiếp lên MinIO
      description: >-
        Client upload thẳng lên MinIO bằng URL này (không qua Chat Service),
        sau đó dùng `fileId` trả về để tham chiếu khi gọi
        `POST /conversations/{conversationId}/messages`.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [conversationId, fileType, sizeBytes]
              properties:
                conversationId:
                  type: integer
                  format: int64
                fileType:
                  type: string
                  enum: [image, video, voice, file]
                sizeBytes:
                  type: integer
                  format: int64
      responses:
        "200":
          description: URL upload tạm thời + fileId để tham chiếu sau
          content:
            application/json:
              schema:
                type: object
                properties:
                  fileId:
                    type: integer
                    format: int64
                  uploadUrl:
                    type: string
                  expiresInSeconds:
                    type: integer
                    example: 300

  /conversations/{conversationId}/files:
    get:
      tags: [Files]
      summary: Danh sách file trong 1 nhóm
      description: Tham chiếu UC-28 (Quản lý file).
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      responses:
        "200":
          description: Danh sách file
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/FileMeta"

  /conversations/{conversationId}/files/{fileId}:
    delete:
      tags: [Files]
      summary: Xoá 1 file để giải phóng quota
      description: >-
        Tham chiếu UC-28. Chỉ Trưởng nhóm được gọi. Storage_used_bytes tự
        động trừ theo qua trigger DB (xem tài liệu thiết kế CSDL mục 5.6).
      parameters:
        - $ref: "#/components/parameters/ConversationId"
        - name: fileId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: Đã xoá
        "403":
          description: Người gọi không phải Trưởng nhóm

  # ============== MODERATION ==============
  /conversations/{conversationId}/mutes:
    post:
      tags: [Moderation]
      summary: Cấm chat (mute) 1 thành viên
      description: Tham chiếu UC-28. Chỉ Trưởng nhóm được gọi.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [userId]
              properties:
                userId:
                  type: integer
                  format: int64
      responses:
        "201":
          description: Đã mute
        "403":
          description: Người gọi không phải Trưởng nhóm

  /conversations/{conversationId}/mutes/{userId}:
    delete:
      tags: [Moderation]
      summary: Gỡ mute
      description: >-
        Không có trong danh sách hành động tường minh ở UC-28, nhưng suy ra
        cần thiết vì mute được thiết kế có hiệu lực vĩnh viễn tới khi được
        gỡ chủ động (xem tài liệu thiết kế CSDL mục 5.6) — nếu không có
        endpoint này, mute sẽ không bao giờ gỡ được.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: Đã gỡ mute
        "403":
          description: Người gọi không phải Trưởng nhóm

  /conversations/{conversationId}/storage:
    get:
      tags: [Moderation]
      summary: Xem dung lượng lưu trữ hiện tại của nhóm
      description: Tham chiếu UC-29.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      responses:
        "200":
          description: Thông tin dung lượng
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/StorageInfo"

  /conversations/{conversationId}/storage/topup:
    post:
      tags: [Moderation]
      summary: Nạp tiền để tăng hạn mức lưu trữ
      description: Tham chiếu UC-29. Chỉ Trưởng nhóm được gọi.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [amount]
              properties:
                amount:
                  type: number
                  description: Số tiền nạp — quy đổi ra hạn mức bytes tuỳ bảng giá (ngoài phạm vi spec này)
      responses:
        "200":
          description: Hạn mức đã được cập nhật
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/StorageInfo"

  /conversations/{conversationId}/storage/unlock:
    post:
      tags: [Moderation]
      summary: Mở khoá + quy định lại thời gian lưu trữ mới
      description: >-
        Tham chiếu UC-29, bước 5. Dùng sau khi nhóm đã bị khoá vì vượt hạn
        mức không gia hạn kịp. Chỉ Trưởng nhóm được gọi.
      parameters:
        - $ref: "#/components/parameters/ConversationId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                storageExpiresAt:
                  type: string
                  format: date-time
      responses:
        "200":
          description: Đã mở khoá
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/StorageInfo"

  # ============== COMPLAINTS (phía user) ==============
  /complaints/messages:
    get:
      tags: [Complaints]
      summary: Xem lịch sử khiếu nại của chính mình
      description: >-
        Tham chiếu UC-09, UC-30. Đọc từ Redis, TTL 10 tiếng — trả mảng rỗng
        nếu chưa từng khiếu nại hoặc đã quá 10 tiếng.

        **Đặc biệt:** endpoint này PHẢI truy cập được kể cả khi tài khoản
        đang ở trạng thái `locked` (khác với mọi endpoint khác trong toàn
        hệ thống, vốn bị chặn bởi API Gateway khi tài khoản bị khoá) — đây
        là lý do kênh khiếu nại được thiết kế tách biệt hoàn toàn khỏi chat
        thông thường ngay từ đầu.
      responses:
        "200":
          description: Lịch sử khiếu nại
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/ComplaintMessage"

    post:
      tags: [Complaints]
      summary: Gửi tin nhắn khiếu nại
      description: Tham chiếu UC-09 bước 4, UC-30 bước 4. Xem lưu ý ở GET cùng path.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [message]
              properties:
                message:
                  type: string
      responses:
        "201":
          description: Khiếu nại đã được ghi nhận
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ComplaintMessage"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  parameters:
    ConversationId:
      name: conversationId
      in: path
      required: true
      schema:
        type: integer
        format: int64

  schemas:
    Conversation:
      type: object
      properties:
        id:
          type: integer
          format: int64
        type:
          type: string
          enum: [p2p, group]
        workspaceId:
          type: integer
          format: int64
          nullable: true
        lastMessageAt:
          type: string
          format: date-time
          nullable: true

    Message:
      type: object
      properties:
        id:
          type: integer
          format: int64
        conversationId:
          type: integer
          format: int64
        senderId:
          type: integer
          format: int64
          nullable: true
          description: null = tin nhắn hệ thống
        senderDisplayName:
          type: string
          description: >-
            Tính động: nếu sender không còn là thành viên workspace (đã bị
            xoá khỏi nhóm, UC-22), giá trị này trả về "người trong nhóm"
            thay vì nickname thật — xem tài liệu thiết kế CSDL mục 5.6.
        type:
          type: string
          enum: [text, image, video, file, voice, vote, system]
        content:
          type: string
          nullable: true
        fileId:
          type: integer
          format: int64
          nullable: true
        isDeleted:
          type: boolean
        createdAt:
          type: string
          format: date-time

    CreateMessageRequest:
      type: object
      required: [type]
      properties:
        type:
          type: string
          enum: [text, image, video, file, voice, vote]
        content:
          type: string
          description: Nội dung text, hoặc caption đi kèm media
        fileId:
          type: integer
          format: int64
          description: Bắt buộc nếu type khác 'text' — lấy từ POST /files/upload-url

    FileMeta:
      type: object
      properties:
        id:
          type: integer
          format: int64
        fileType:
          type: string
          enum: [image, video, voice, file]
        sizeBytes:
          type: integer
          format: int64
        uploadedBy:
          type: integer
          format: int64
        uploadedAt:
          type: string
          format: date-time

    StorageInfo:
      type: object
      properties:
        plan:
          type: string
          enum: [free, paid]
        quotaBytes:
          type: integer
          format: int64
        usedBytes:
          type: integer
          format: int64
        isLocked:
          type: boolean
        expiresAt:
          type: string
          format: date-time
          nullable: true

    ComplaintMessage:
      type: object
      properties:
        senderRole:
          type: string
          enum: [user, admin]
        message:
          type: string
        createdAt:
          type: string
          format: date-time

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
```
### 6.4 Tiến độ triển khai

*Hạ tầng DB: `Tainguyen/infra/chat-db.yaml` — xem `HUONG-DAN-DEPLOY.md`. Schema tạo đủ
cho cả P2P và Group, nhưng Phase 2 chỉ code nhánh P2P. Code service (C#/.NET) chưa viết.*

**Cơ sở dữ liệu**
- [x] Tạo bảng `conversations` (kèm CHECK shape p2p/group, unique index cặp P2P, unique index 1 group/workspace)
- [x] Tạo bảng `messages`
- [x] Tạo bảng `group_chat_settings`
- [x] Tạo bảng `muted_members`
- [x] Tạo bảng `files`
- [x] Trigger `sync_storage_used` (2 chiều insert/delete)
- [x] Cron job tự động xoá conversation P2P sau 6 tháng không hoạt động — `P2PCleanupService`
      (BackgroundService, quét mỗi 24h), điều kiện "không hoạt động" = `LastMessageAt` quá hạn HOẶC
      (chưa từng có tin nhắn VÀ `CreatedAt` quá hạn, tránh xoá nhầm conversation vừa tạo) — xoá
      cascade Messages/Files/MessageRecipientKeys qua FK có sẵn

*Phase 2 chỉ code nhánh P2P (theo roadmap mục 2). Các mục dưới đây đánh dấu **(Group)** thuộc
Phase 3, chưa làm.*

**API**
- [x] `GET /conversations` — **tự đề xuất, thiếu sót phát hiện khi build Frontend F2** ("Danh sách
      cuộc trò chuyện"): OpenAPI gốc chỉ có thao tác theo `{conversationId}` cụ thể, không có endpoint
      liệt kê theo user đang đăng nhập. P2P đọc thẳng từ Chat DB; Group phải gọi sang WorkSpace Service
      (`GET /internal/users/{userId}/workspaces`, cũng tự thêm) trước để biết workspace nào của mình,
      vì Chat Service không giữ bản sao `workspace_members`. Trả `otherUserId` (P2P) hoặc `workspaceId`
      (Group) — Frontend tự đối chiếu với danh sách bạn bè/workspace đã tải sẵn để lấy tên hiển thị,
      Chat Service không resolve nickname thay. Verify thật qua curl: tạo P2P → cả 2 phía đều thấy
      đúng conversation trong danh sách của mình.
- [x] `GET /files/{fileId}/download-url` — **tự đề xuất, thiếu sót nghiêm trọng phát hiện khi build
      Frontend F2**: `StorageService` (trước là `MinioStorageService`) trước đó chỉ có `GeneratePresignedUploadUrl` (PUT) — hoàn
      toàn KHÔNG có cách nào lấy lại URL để xem/tải file đã gửi (ảnh/video/voice/file gửi xong sẽ
      không hiển thị lại được). Thêm `GeneratePresignedDownloadUrl` (GET) + endpoint kiểm tra quyền
      qua chính `ConversationId` của file (không nhận `conversationId` từ client để tránh giả mạo).
- [x] `POST /conversations/p2p` — idempotent, verify tạo lại trả đúng conversation cũ
- [x] `GET /conversations/{conversationId}` — chặn 403 nếu không phải participant
- [x] `GET /conversations/{conversationId}/messages`
- [x] `POST /conversations/{conversationId}/messages` — chặn `type=file` trong P2P (422), chặn
      video >50MB / voice >25MB (413, **chưa có nén tự động**, chỉ từ chối thẳng)
- [x] `DELETE /conversations/{conversationId}/messages/{messageId}` — **giả định cho P2P:** chỉ
      người gửi tự xoá được (bản gốc quy định "chỉ Trưởng nhóm", chỉ áp dụng cho Group)
- [x] `PATCH /conversations/{conversationId}/messages/{messageId}` — **tự đề xuất, không có trong
      OpenAPI gốc** (mục "Sửa/thu hồi tin nhắn" bị bỏ sót giữa spec ban đầu và các UC sau này, phát
      hiện lại khi rà soát `frontend-admin-page-dac-ta.md`). Sửa nội dung tin Text đã gửi: chỉ chính
      người gửi, chỉ trong 15 phút kể từ lúc gửi (`EditWindow`, chưa chốt trong tài liệu gốc), client
      tự mã hoá lại (nonce mới) và TÁI SỬ DỤNG session key cũ nếu là Group (không cần gửi lại
      `RecipientKeys`). Đánh dấu `is_edited=true`, `edited_at`, broadcast `MessageEdited` qua SignalR.
- [x] `POST /conversations/{conversationId}/messages/{messageId}/recall` — **tự đề xuất**, tách
      riêng khỏi `DELETE` ở trên: `DELETE` dành cho Trưởng nhóm xoá bất kỳ tin nào trong Group (không
      giới hạn thời gian); `recall` là BẤT KỲ người gửi nào (cả P2P lẫn Group) tự thu hồi tin CỦA
      MÌNH, chỉ trong cùng khung 15 phút với sửa tin. Dùng chung cơ chế soft-delete (`is_deleted`),
      broadcast `MessageDeleted`.
- [x] `POST /files/upload-url` — presigned URL qua MinIO (S3-compatible) tại `192.168.50.10:9000`,
      verify PUT thật lên bucket `chat-media` thành công + đọc lại đúng nội dung. Sửa 1 lỗi thật:
      AWSSDK.S3 luôn sinh presigned URL với scheme `https://` bất kể `UseHttp` config, trong khi
      MinIO của dự án chỉ nghe HTTP thường — phải ép lại scheme thủ công (xem `StorageService.cs`)
- [x] **Định tuyến kho lưu trữ theo dung lượng** — `MinioStorageService` (1 kho cố định) đổi thành
      `StorageService` (nhiều kho). File ≤ `Storage:HomeMaxBytes` (20MB) → `home`, lớn hơn → `cloud`;
      kết quả ghi vào cột `storage_provider`, lúc tải về đọc lại theo cột chứ không tính lại theo
      ngưỡng. Verify 10/10: dưới ngưỡng, đúng biên 20MB, trên ngưỡng khi cloud chưa/đã cấu hình,
      tải file ghi `home` lẫn `cloud`, file cũ có trước khi thêm cột, và 503 `storage_unavailable`
      khi kho đã ghi trong DB không còn cấu hình. Hai quyết định: chưa có cloud thì file lớn vẫn lưu
      `home` kèm cảnh báo log (từ chối upload là làm hỏng tính năng đang chạy vì một ô cấu hình chưa
      điền); kho không còn cấu hình thì báo 503 rõ chứ không âm thầm presign sang kho khác (sẽ trả
      URL tới object không tồn tại → 404 khó hiểu)
- [x] `GET /conversations/{conversationId}/files`
- [x] `DELETE /conversations/{conversationId}/files/{fileId}` — giả định tương tự: người upload
      tự xoá được (Group thì phải là Trưởng nhóm)
- [x] `POST /conversations/{conversationId}/mutes` — chỉ Trưởng nhóm, verify member bị mute nhận
      403 khi gửi tin, hết mute gửi lại được
- [x] `DELETE /conversations/{conversationId}/mutes/{userId}`
- [x] `GET /conversations/{conversationId}/storage`
- [x] `POST /conversations/{conversationId}/storage/topup` — chỉ Trưởng nhóm (403 nếu không phải);
      quy đổi tiền→bytes **CHƯA có bảng giá thật** (tài liệu gốc để ngỏ), tạm quy ước 1 đơn vị = 1GB
- [x] `POST /conversations/{conversationId}/storage/unlock` — chỉ Trưởng nhóm
- [x] `GET /complaints/messages` — verify hoạt động với JWT bất kỳ (không kiểm tra `status` tài
      khoản, đúng yêu cầu "hoạt động kể cả khi bị khoá")
- [x] `POST /complaints/messages` — verify TTL Redis ≈ 10 giờ đúng như thiết kế

**Tích hợp**
- [x] Publish `Chat Service Log` lên Kafka sau mỗi tin nhắn — topic `chat.service-log`, **đã bổ
      sung field `Content`** vào event (spec gốc không có) vì SpamTrackingService (mục 8) cần nội
      dung để phân tích trùng lặp/từ khoá
- [x] Consumer `Write Chat` đồng bộ Redis từ Kafka — `WriteChatConsumerService`, cùng service tự
      publish + tự consume lại `chat.service-log` (group id riêng `chat-service-write-chat`, tách
      biệt SpamTrackingService), đúng nguyên tắc "ghi Postgres trước, publish event để đồng bộ Redis
      sau" đã nêu ở mục 1. Đọc lại từ Postgres (không dùng thẳng `Content` trong event, vì tin Text
      mã hoá đã có `Content=null` trong Kafka event — xem mục 6.5) để có đủ dữ liệu cache. Cache dạng
      Hash (`chat:msg:{id}`, mutable — cập nhật được lúc xoá mềm) + Sorted Set index
      (`chat:msgidx:{id}`, sắp theo `CreatedAt`), tự dọn khi vượt 10.000 tin hoặc quá 10 ngày/conversation.
      Verify thực tế: gửi tin nhắn → `KEYS chat:*` trên Redis thấy đúng key được tạo.
- [x] Search Chat Service: route Redis (<10.000 tin & <10 ngày) / Postgres (còn lại) — `GET messages`
      thử Redis trước; nếu đủ số lượng yêu cầu thì dùng thẳng (không chạm Postgres); nếu thiếu (cache
      nguội/phân trang sâu vào lịch sử cũ) thì fallback TOÀN BỘ sang Postgres cho đúng request đó,
      đảm bảo luôn đúng/đủ dữ liệu thay vì cố merge 2 nguồn. Verify thực tế: đọc lại tin vừa gửi trả
      đúng nội dung từ Redis.
- [x] `GET /conversations/{conversationId}/messages/search` — **tự đề xuất, không có trong OpenAPI
      gốc** (mục "Tìm kiếm tin nhắn" cùng tình trạng bị bỏ sót với mục sửa/thu hồi ở trên). Vì tin
      Text luôn E2EE (`Content` là ciphertext), server KHÔNG THỂ full-text search trực tiếp — dùng
      **blind-index searchable encryption** (đúng cơ chế Facebook Messenger E2EE mặc định dùng): khi
      gửi/sửa tin, client tự tách từ khoá từ nội dung GỐC (trước khi mã hoá), băm bằng
      `HMAC(searchKey, từ)` với 1 search-key riêng (chỉ client giữ, KHÔNG BAO GIỜ gửi lên server —
      giống private key), gửi kèm token đã băm (`SearchTokens`) lên bảng `message_search_tokens`.
      Khi search, client tự băm lại từ khoá cần tìm bằng cùng search-key, gửi token qua query param
      `tokens` (phẩy phân cách) — server chỉ so khớp token == token (AND — tin phải chứa ĐỦ mọi
      token), không bao giờ biết được từ gốc là gì. Kèm filter metadata độc lập (`senderId`, `type`,
      `from`/`to`) hoạt động cả với tin không phải Text. **Đánh đổi đã xác nhận với người dùng dự án:**
      server biết được tần suất/mẫu xuất hiện token (ai gửi token giống nhau) dù không biết nghĩa —
      đây là đánh đổi thật mà các app lớn (kể cả Facebook) chấp nhận, không có cách nào search được
      mà kín tuyệt đối 100%.
- [x] Publish thông báo tin nhắn mới qua RabbitMQ → Identity Services — queue
      `identity.chat-message-notification` (`ChatMessageNotificationPublisher`), verify publish
      thành công qua `rabbitmqctl list_queues`. **Identity Service CHƯA có consumer** cho queue này
      (cùng tình trạng "chuẩn bị trước" với các queue khác trong dự án).
- [x] Lưu tạm hội thoại khiếu nại trong Redis, TTL 10 tiếng — TTL tính từ tin đầu tiên (không
      refresh mỗi tin mới), đúng theo mô tả `ComplaintSummary.expiresAt` ở mục 4.2
- [x] WebSocket cho realtime tin nhắn/presence — dùng **ASP.NET Core SignalR** (có sẵn trong shared
      framework, không phải "Signal IR" như liệt kê ban đầu — đính chính chính tả) thay vì raw
      WebSocket, tại `/hubs/chat`. JWT truyền qua query string `?access_token=` (trình duyệt không
      gửi được `Authorization` header lúc WebSocket handshake — đúng hạn chế chuẩn của SignalR JS
      client, không phải lỗi). Client tự gọi `JoinConversation(id)` khi mở màn hình chat (LAZY, không
      tự join hết mọi conversation lúc connect — vì WorkSpace Service chưa có endpoint "liệt kê
      workspace của chính mình" để biết trước cần join group nào); server verify quyền thành viên
      (tái dùng `IsMemberAsync`) trước khi cho join, chặn user tự xưng `conversationId` bất kỳ để
      nghe lén. Presence (online/offline) theo dõi trong bộ nhớ tiến trình (`PresenceTracker`, KHÔNG
      qua Redis — chỉ đúng khi Chat Service chạy 1 replica, cần chuyển sang Redis pub/sub nếu sau
      này scale ngang nhiều replica). Verify thực tế qua Docker: gửi tin nhắn qua REST → broadcast
      `MessageReceived` tới đúng SignalR group của conversation; Redis cache + RabbitMQ queue đều
      nhận đúng dữ liệu song song với broadcast.
- [x] Internal endpoint `POST /internal/conversations/group` (không có trong OpenAPI spec gốc —
      tự thêm để WorkSpace Service gọi tạo group conversation ngay khi tạo workspace, idempotent)
- [x] Internal endpoint `DELETE /internal/conversations/by-workspace/{workspaceId}` (không có
      trong OpenAPI spec gốc — tự thêm để WorkSpace Service gọi dọn dữ liệu khi xoá/giải tán
      workspace, xem mục 5.1) — verify cascade xoá đúng
- [x] Chuỗi cảnh báo xoá file (còn 3 ngày → 2 ngày → 1 ngày → 10 tiếng) — `StorageWarningService`
      (BackgroundService), publish qua RabbitMQ queue `identity.storage-warning` (**Identity Service
      chưa có consumer** cho queue này); khi hết hạn tự xoá file cũ nhất tới khi dưới hạn mức, thêm
      cột `group_chat_settings.last_warning_stage` (không có trong schema gốc) để tránh gửi trùng
      cảnh báo — cơ chế theo dõi mốc + hành động xoá là **tự đề xuất**, tài liệu gốc chỉ mô tả có
      tồn tại chuỗi cảnh báo, không đặc tả cơ chế
- [x] `internal/workspaces/{workspaceId}/members` (WorkSpace Service, không có trong OpenAPI gốc)
      — endpoint nội bộ để Chat Service kiểm tra thành viên/vai trò Group mà không cần JWT của
      từng thành viên cụ thể

### 6.5 E2EE cho tin nhắn Text — tự thiết kế (không có trong tài liệu gốc)

Tài liệu gốc chỉ ghi từ khoá "E2EE" ở mục tổng quan (mục 1) và mô tả Chat 1-1 (mục 6.1), **không mô
tả cơ chế mã hoá cụ thể nào**. Toàn bộ thiết kế dưới đây tự đề xuất trong quá trình trao đổi trực
tiếp với người dùng dự án, chốt các quyết định sau:

**Phạm vi:** chỉ tin nhắn `type=text` được mã hoá (giống Facebook Messenger "Cuộc trò chuyện bí
mật" cũng chỉ mã hoá được nội dung văn bản). Ảnh/video/voice/file/vote/system giữ nguyên plaintext
như trước — không đổi.

**Cơ chế (giống Signal Protocol/WhatsApp, không phải tự nghĩ ra thuật toán mới):**
- Mỗi user có 1 cặp khoá **X25519** (ECDH) sinh ngay trên thiết bị lúc thiết lập lần đầu. Khoá
  **riêng tư không bao giờ rời thiết bị, không bao giờ gửi lên server** — mã hoá tại chỗ bằng khoá
  dẫn xuất từ mã PIN cục bộ của user trước khi lưu (hoàn toàn phía client, ngoài phạm vi backend).
- Khoá **công khai** đăng ký lên Chat Service (`POST /keys`) — đóng vai trò "danh bạ khoá công
  khai", trao đổi khoá diễn ra **tự động, người dùng không thấy/không phải làm gì** (đúng như cách
  Facebook/WhatsApp vận hành, không phải "không trao đổi khoá" như cảm nhận bên ngoài).
- **P2P:** người gửi/nhận tự tính ra 1 shared secret giống hệt nhau qua ECDH (khoá riêng của mình +
  khoá công khai của đối phương lấy từ server) → SHA-256 shared secret này làm khoá AES-256-GCM mã
  hoá/giải mã trực tiếp. Không cần bảng phụ nào — 2 bên tự suy ra được khoá, không phải phân phối.
- **Group:** 1 tin nhắn = 1 khoá phiên AES-256 ngẫu nhiên, dùng 1 lần, mã hoá nội dung. Khoá phiên
  đó lại được mã hoá **riêng cho từng thành viên** bằng shared secret ECDH giữa người gửi và từng
  người nhận (fan-out, đúng pattern Signal/WhatsApp group) — lưu vào bảng `message_recipient_keys`.
  Mỗi người khi đọc **chỉ thấy đúng 1 bản mã hoá dành cho chính mình**, không thấy của người khác
  (verify thực tế: response `GET messages` chỉ trả về `recipientEncryptedKey` khớp với `sub` của
  JWT gọi, không phải mảng toàn bộ thành viên).
- **Server (Chat Service) không bao giờ giải mã, không có khả năng đọc nội dung** — chỉ lưu/relay
  ciphertext + nonce nguyên vẹn, và validate "hình dạng" dữ liệu (bắt buộc có nonce, bắt buộc có
  `recipientKeys` khi Group) chứ không thể verify mã hoá có đúng hay không.

**Đánh đổi đã xác nhận với người dùng:** SpamTrackingService **không còn đọc được nội dung tin nhắn
Text** để khớp từ khoá/phát hiện trùng lặp (ciphertext khác nhau mỗi lần dù cùng nội dung, do nonce
ngẫu nhiên) — chỉ còn tín hiệu tần suất gửi (rate-limit) hoạt động với tin nhắn Text. Đây là đánh
đổi bắt buộc của E2EE thật (Facebook/WhatsApp cũng không quét được nội dung tin nhắn đã mã hoá) —
xem mục 8.3 để biết `SpamDetector.cs` đã xử lý ra sao.

**Thiết kế CSDL (Chat DB, thêm mới):**

```sql
ALTER TABLE messages ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN content_nonce VARCHAR(64);

CREATE TABLE user_public_keys (
  user_id      BIGINT PRIMARY KEY,
  public_key   VARCHAR(200) NOT NULL,
  algorithm    VARCHAR(20) NOT NULL DEFAULT 'x25519',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE message_recipient_keys (
  id                  BIGSERIAL PRIMARY KEY,
  message_id          BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id   BIGINT NOT NULL,
  encrypted_key       VARCHAR(200) NOT NULL,
  UNIQUE (message_id, recipient_user_id)
);
```

**API mới (Chat Service, không có trong OpenAPI spec gốc):**
- [x] `POST /keys` — đăng ký/ghi đè khoá công khai của chính mình (upsert)
- [x] `GET /keys/{userId}` — lấy khoá công khai của 1 user, 404 nếu chưa đăng ký
- [x] `GET /keys/batch?ids=...` — lấy nhiều khoá cùng lúc (dùng khi mã hoá fan-out cho Group,
      tránh N+1)

**Thay đổi API hiện có:**
- [x] `POST /conversations/{conversationId}/messages` — khi `type=text`: bắt buộc `contentNonce`
      (400 nếu thiếu), Group bắt buộc thêm `recipientKeys` (400 nếu thiếu/rỗng). Kafka publish gửi
      `Content=null` cho tin nhắn Text đã mã hoá (server không còn plaintext để gửi)
- [x] `GET /conversations/{conversationId}/messages` — trả thêm `isEncrypted`, `contentNonce`,
      `recipientEncryptedKey` (Group: chỉ khoá của người gọi, P2P: luôn `null` vì không cần bảng
      phụ)

**Verify end-to-end thật** (script Node.js mô phỏng client thật, dùng `crypto.generateKeyPairSync
('x25519')` + `diffieHellman` + `aes-256-gcm` — không mock): sinh khoá thật cho 2 user → đăng ký
khoá công khai → tạo conversation P2P → mã hoá tin nhắn bằng shared secret ECDH → gửi → người nhận
tự tính lại đúng shared secret từ khoá công khai lấy từ server → giải mã đúng y hệt plaintext gốc.
Lặp lại cho Group (workspace 2 thành viên) với cơ chế fan-out — xác nhận qua truy vấn DB trực tiếp:
cột `content`/`encrypted_key` trong Postgres chỉ chứa ciphertext (chuỗi base64 ngẫu nhiên), không hề
có plaintext ở bất kỳ đâu trong Chat DB.

**Dẫn xuất search key cho tìm kiếm blind-index (`GET .../messages/search`, xem mục 6.4) — tự thiết
kế, định hướng cho Frontend:**

Search key **KHÔNG dùng thẳng private key cá nhân** của mỗi người (vì mỗi người có private key khác
nhau → tự băm sẽ ra token khác nhau, không ai khớp được với ai). Thay vào đó, derive từ chính khoá
**dùng chung** đã tính ra để mã hoá nội dung tin nhắn đó — khoá này về bản chất mọi người tham gia
đều tự tính ra **giống hệt nhau** dù input (private key riêng) khác nhau, nhờ tính chất toán học của
ECDH (Diffie-Hellman: `privA × pubB == privB × pubA`):
- **P2P:** `searchKey = HKDF(sharedSecret_ECDH, "search-index")` — cùng shared secret đã dùng để mã
  hoá/giải mã nội dung, 2 bên tự tính lại ra đúng cùng giá trị, không cần trao đổi gì thêm.
- **Group:** `searchKey = HKDF(sessionKey, "search-index")` — cùng `sessionKey` ngẫu nhiên của
  từng tin nhắn (mỗi thành viên tự giải gói `encrypted_key` fan-out của mình để lấy lại đúng
  `sessionKey` gốc), nên mọi thành viên đều derive ra cùng 1 `searchKey` cho tin đó.

Vì `sharedSecret`/`sessionKey` chỉ tính lại được từ private key cá nhân (được bảo vệ bởi PIN 6 số cục
bộ), PIN vẫn giữ đúng vai trò gốc rễ bảo vệ toàn bộ chuỗi khoá — chỉ khác là search key không phải
chính private key, mà là khoá **chung của hội thoại/tin nhắn**, để search khớp được giữa nhiều người
mà vẫn không cần gửi bí mật nào lên server.

**Frontend F3 (E2EE Text P2P) — hoàn thành, verify thật qua HTTP thật (không mock):**

- [x] `POST /keys/vault`, `GET /keys/vault` (Chat Service) — **tự thiết kế thêm**, xác nhận với người
      dùng dự án: lưu bản MÃ HOÁ (bằng khoá dẫn xuất từ PIN qua PBKDF2 100.000 vòng + salt ngẫu nhiên)
      của private key lên server, để khôi phục được trên thiết bị mới chỉ bằng đúng 6 số PIN — giống
      cơ chế backup key thật của Messenger/WhatsApp. Server không bao giờ thấy PIN hay private key gốc.
      **Đánh đổi đã xác nhận:** PIN 6 số chỉ có 1 triệu khả năng — nếu ai đó lấy được bản ghi này có
      thể brute-force offline; đây là đánh đổi thật mà Messenger/WhatsApp cũng chấp nhận, không có
      PIN ngắn nào chống brute-force tuyệt đối.
- [x] Thư viện crypto phía client: `@noble/curves` cho X25519 (Web Crypto API chưa hỗ trợ X25519 ổn
      định ở mọi trình duyệt), AES-256-GCM/PBKDF2/HKDF dùng thẳng `crypto.subtle` (Web Crypto chuẩn)
- [x] Màn hình thiết lập PIN lần đầu + nhập PIN khôi phục (`E2eeGate`, hiện ngay trong khung chat khi
      cần thay vì route riêng) — sinh cặp khoá X25519 thật, đăng ký public key, mã hoá + upload vault
- [x] Gửi/nhận tin nhắn Text P2P mã hoá thật trong `ChatRoomPage` — mã hoá bằng shared secret ECDH,
      giải mã tự động khi tin về qua SignalR hoặc tải lại lịch sử
- [x] Nút thu hồi tin nhắn Text (dùng endpoint `recall` đã có sẵn từ trước)

**Verify thật (2 vòng):**
1. Test thuần thuật toán (Node, không qua HTTP): sinh khoá X25519 thật cho Alice/Bob, xác nhận 2 bên
   tự tính ra đúng cùng 1 shared secret qua ECDH, mã hoá/giải mã AES-GCM round-trip đúng, người thứ 3
   (khoá khác) KHÔNG giải mã được (auth tag thất bại đúng như kỳ vọng), vault mã hoá/giải mã bằng PIN
   đúng/sai đều xử lý đúng.
2. Test tích hợp qua HTTP thật (services đang chạy thật, không mock): đăng ký public key thật lên
   Chat Service, lấy lại đúng public key qua API, tạo P2P, gửi tin Text mã hoá qua `POST
   /conversations/{id}/messages` — xác nhận trực tiếp **`content` trả về từ server là ciphertext,
   không đọc được** — Bob tự giải mã ra đúng plaintext gốc. Lưu vault qua `POST /keys/vault`, tải lại
   qua `GET /keys/vault`, khôi phục đúng private key gốc từ đúng PIN.

**Cập nhật — Group Text E2EE (fan-out) đã hoàn thành:**
- [x] `ChatRoomPage` nạp public key của TOÀN BỘ thành viên workspace (`GET
      /internal/workspaces/{id}/members` → `GET /keys/batch`), thành viên nào chưa thiết lập E2EE bị
      loại khỏi fan-out — hiện rõ số lượng "N thành viên chưa thiết lập E2EE" thay vì âm thầm bỏ qua
- [x] Gửi: sinh session key ngẫu nhiên/tin nhắn, mã hoá nội dung bằng session key, gói (wrap) session
      key riêng cho từng thành viên bằng khoá dẫn xuất ECDH giữa người gửi và thành viên đó (đúng
      pattern Signal/WhatsApp) — **người gửi cũng tự gói cho chính mình** để đọc lại được sau khi tải
      lại lịch sử
- [x] Nhận: mỗi người tự gỡ gói bằng khoá riêng của mình, không ai thấy được bản gói của người khác
      (verify qua `recipientEncryptedKey` server trả về đúng — chỉ đúng 1 bản dành riêng cho người gọi)

**Verify thật qua HTTP thật (workspace/user thật, không mock):** tạo workspace → thêm thành viên →
xác nhận Chat Service tự tạo group conversation → 2 người đăng ký public key thật → Trưởng nhóm gửi
tin Text mã hoá fan-out cho cả 2 → thành viên còn lại tự giải mã đúng plaintext gốc bằng khoá riêng →
Trưởng nhóm tự đọc lại đúng tin của chính mình (mô phỏng sau khi tải lại lịch sử). Đã dọn dữ liệu
test, xác nhận workspace/nhóm thật của người dùng dự án không bị ảnh hưởng.

**Sửa lỗi phát sinh sau khi người dùng test thật trên trình duyệt:**
- **Race condition khiến tin nhóm vừa gửi hiện "(không giải mã được)"** — nguyên nhân: khi tự gửi tin
  Group, có 2 nguồn ghi cạnh tranh vào cùng ô nhớ giải mã — (1) cache đúng tự có sẵn lúc mã hoá, (2)
  bản echo qua SignalR của chính tin đó (luôn thiếu `recipientEncryptedKey` vì broadcast dùng chung 1
  payload cho cả nhóm) cố giải mã và thất bại. Không có thứ tự đảm bảo giữa 2 luồng async này, đôi
  lúc bản lỗi ghi đè bản đúng. Sửa: nhận diện đúng "đây là echo của chính mình" → bỏ hẳn, không cho
  ghi gì cả; đồng thời hiệu ứng giải mã không bao giờ tự ý gán lỗi cho tin Group đang thiếu khoá nữa.
- **Private key mất sau F5, phải nhập lại PIN mỗi lần** — thiết kế ban đầu chỉ giữ private key trong
  bộ nhớ (RAM), tự đề xuất theo tinh thần "an toàn tối đa". Người dùng dự án phản hồi muốn trải
  nghiệm giống Facebook/Messenger web (không hỏi lại PIN liên tục) — đổi sang lưu private key **đã
  giải mã** ở `localStorage`, sống đến khi JWT hết hạn (tự gia hạn cùng nhịp với
  `POST /auth/refresh`, xoá khi đăng xuất hoặc refresh thất bại thật sự). **Đánh đổi bảo mật đã đổi
  theo yêu cầu người dùng:** ai truy cập được `localStorage` trên máy đó (vd XSS, dùng chung máy) đọc
  được private key mà không cần PIN — đây là đánh đổi thật, cùng cách các web client E2EE thật (
  Messenger/WhatsApp Web) vẫn làm để tránh hỏi lại mật khẩu liên tục, không phải lỗi thiết kế.

**F3 hoàn thành nốt — Tìm kiếm & Sửa tin nhắn:**

- [x] **Sửa lỗi thiết kế search Group tự phát hiện**: bản đầu dẫn xuất searchKey từ session key NGẪU
  NHIÊN của từng tin nhắn — mỗi tin một khoá khác nhau nên token không bao giờ khớp giữa các tin,
  khiến search vô dụng hoàn toàn. Sửa: searchKey phải là khoá ỔN ĐỊNH xuyên suốt hội thoại — dùng lại
  chính shared secret ECDH giữa người gửi và TỪNG người nhận (giống `wrapKey` đã có). Vì mỗi cặp
  (người gửi, người nhận) ra 1 khoá khác nhau, phải tính RIÊNG 1 bộ token cho từng người nhận rồi gộp
  chung gửi lên server — lúc search, mỗi người tự nhiên chỉ khớp đúng bộ token dành cho riêng mình.
  Verify qua Node: 2 tin khác nội dung, cùng chứa từ "hello" → cùng khớp 1 query token; người thứ 3
  không liên quan tự tính bằng khoá khác → không khớp.
- [x] Sửa tin nhắn (edit) — P2P re-encrypt bằng shared secret (deterministic, tính lại y hệt lần đầu);
  Group tái sử dụng ĐÚNG session key cũ bằng cách tự gỡ lại từ bản đã "gói" cho chính mình lúc gửi
  (`recoverGroupSessionKey`), khớp đúng yêu cầu backend "không cần gửi lại RecipientKeys"
- [x] UI tìm kiếm trong `ChatRoomPage` — P2P tính 1 bộ token; Group phải thử LẦN LƯỢT với từng thành
  viên có thể là người gửi (tính token bằng shared secret với từng người), gộp + khử trùng kết quả

**Verify thật qua HTTP thật (workspace/user thật, không mock)** — 1 script chạy tuần tự 7 bước: gửi
tin kèm token thật → tìm kiếm ra đúng tin → sửa tin, người khác đọc lại đúng nội dung mới → mute
thành viên (gửi tin bị chặn 403) → gỡ mute → Trưởng nhóm xoá tin không giới hạn thời gian → xem/nạp
dung lượng → gửi khiếu nại. Tất cả pass, đã dọn dữ liệu test.

**Backend — 2 gap mới phát hiện & vá trong lúc build:**
- [x] `GET /conversations/{id}/mutes` — thiếu sót: có POST/DELETE mute nhưng không có cách nào XEM
  lại đang mute những ai
- [x] Middleware bug: search `tokens` truyền qua query string chứa ký tự base64 (`+`, `/`, `=`) —
  nếu Frontend tự nối chuỗi URL thủ công KHÔNG encode đúng, ký tự `+` sẽ bị hiểu nhầm thành dấu cách,
  làm token sai lệch. `chatApi.ts` dùng `axios` params (tự động encode đúng) nên không dính lỗi này,
  nhưng đây là điểm cần lưu ý nếu sau này có client nào tự dựng URL thủ công.

**F4 hoàn thành — Quản trị nhóm chat & Khiếu nại:**
- [x] Mute/gỡ mute thành viên (chỉ Trưởng nhóm) — panel quản trị trong `ChatRoomPage`
- [x] Trưởng nhóm xoá tin nhắn bất kỳ, không giới hạn thời gian (khác nút "Thu hồi" tự thu hồi có
  giới hạn 15 phút, chỉ áp dụng cho chính người gửi)
- [x] Màn hình dung lượng lưu trữ nhóm (xem/nạp/mở khoá) + banner cảnh báo khi khoá hoặc sắp hết hạn
- [x] Màn hình Khiếu nại (`/complaints`, route độc lập ngoài `AppShell`/dock — không điều hướng sang
  tính năng chat bình thường, đúng yêu cầu "hoạt động kể cả khi tài khoản bị khoá")

**Thiết kế lại nạp dung lượng — theo phản hồi người dùng dự án**: bản đầu (`POST
.../storage/topup`) cho Trưởng nhóm tự cộng dung lượng ngay lập tức, không qua ai duyệt — người dùng
dự án chỉ ra đây là việc của Admin ("Trưởng nhóm nhắn tin Admin rồi Admin bấm cộng"), khớp đúng tài
liệu gốc mục 2.4 ("nạp tiền" — hành động tài chính cần xác nhận, không phải tự động). Thiết kế lại
theo mô hình yêu cầu/duyệt:

- [x] Bảng `storage_topup_requests` (Chat DB) — Admin Service không có CSDL riêng (lớp điều phối),
  nên bảng này vẫn nằm ở Chat DB, Admin Service chỉ gọi nội bộ qua HTTP
- [x] `POST/GET /conversations/{id}/storage/topup-requests` (Chat Service, public) — Trưởng nhóm gửi
  yêu cầu, mọi thành viên xem được trạng thái (`pending`/`approved`/`rejected`)
- [x] `GET/POST /internal/storage-topup-requests*` (Chat Service, nội bộ) — Admin Service gọi để
  liệt kê yêu cầu đang chờ / duyệt / từ chối; duyệt mới thực sự cộng quota (tái dùng đúng logic tính
  bytes cũ), từ chối không đổi gì
- [x] `GET/POST /admin/storage-requests*` (Admin Service, `AdminOnly` — JWT bắt buộc claim
  `role=admin`) — proxy sang Chat Service, cùng pattern với `ComplaintsAdminEndpoints.cs` đã có
- [x] Frontend: nút "Nạp thêm 1GB" (áp dụng ngay) đổi thành "Yêu cầu nạp thêm 1GB (chờ Admin duyệt)",
  hiện danh sách yêu cầu + trạng thái. **Chưa có màn hình Admin duyệt** — theo lựa chọn của người
  dùng dự án, F6 (Admin Page) sẽ làm màn hình duyệt thật sau; hiện tại Admin duyệt qua gọi API trực
  tiếp.

**Verify thật qua HTTP thật** (script 6 bước): Trưởng nhóm gửi yêu cầu → quota CHƯA đổi → user thường
gọi API Admin bị chặn 403 → tạo tài khoản, promote thành admin, **gọi lại `POST /auth/refresh`** (xác
nhận endpoint tự thêm ở F0 hoạt động đúng: JWT cũ không có claim `role=admin` vì stateless, phải làm
mới token sau khi promote mới có claim) → Admin thấy đúng yêu cầu đang chờ → duyệt → quota tăng đúng
2GB → duyệt lại lần 2 (đã xử lý) trả đúng 404. Đã dọn dữ liệu test.

**F5 hoàn thành — Họp trực tuyến (LiveKit) & Mini App IPTV:**

Backend Media Service đã xong từ Phase 5/6 nhưng **chỉ từng được test bằng script server-side**, nên
khi ghép Frontend thật mới lộ ra 6 lỗ hổng — tất cả đều là "không có API nào làm được việc mà giao
diện bắt buộc phải làm", không phải lỗi logic:

- [x] **Media Service thiếu CORS hoàn toàn** (không có cả `AddCors` lẫn `UseCors`) — cùng loại lỗi
  đã gặp ở Chat Service, nhưng ở đây nặng hơn vì thiếu cả hai vế. Script test gọi từ Node nên không
  bao giờ lộ ra; trình duyệt gọi từ `http://localhost:5173` sẽ bị chặn ngay ở bước preflight.
- [x] `GET /meetings/active?conversationId=` — **thiếu sót nghiêm trọng nhất**: khi Trưởng nhóm mở
  họp `mode=in_chat`, Chat Service chỉ nhận được 1 tin nhắn hệ thống dạng CHỮ ("X đã mở cuộc họp"),
  **không kèm meetingId**. Cả nhóm nhìn thấy dòng chữ đó mà không có cách nào biết vào cuộc họp nào —
  tính năng "họp trong nhóm chat" trên thực tế là bất khả thi từ phía client. Endpoint mới cho phòng
  chat tự hỏi "nhóm tôi có cuộc họp nào đang mở không".
- [x] `POST /meetings/{id}/join` — luồng invite có sẵn (`InvitesEndpoints.cs`) sinh ra để mời NGƯỜI
  NGOÀI: link invite thì **luôn phải chờ host duyệt**. Không ai đi tạo link mời rồi tự duyệt cho từng
  thành viên trong chính nhóm của mình. Endpoint mới cho thành viên nhóm vào thẳng (xác minh tư cách
  thành viên qua Chat Service, fail-closed nếu không hỏi được). Host luôn vào lại được phòng của chính
  mình — cần thiết vì token LiveKit chỉ được phát 1 lần lúc tạo/duyệt, tải lại trang là mất.
- [x] `GET /internal/conversations/{id}/members/{userId}` (**Chat Service**) — Media Service không có
  bản sao `workspace_members` nên không tự kiểm tra được tư cách thành viên. Trả kèm `isLeader` để
  khỏi phải gọi thêm WorkSpace Service.
- [x] `GET /meetings/{id}/participants` — đã có API kick/cấp quyền **theo userId** nhưng không có API
  nào liệt kê ai đang ở trong phòng để bấm. Trả kèm nickname thật (resolve qua Identity Service) và
  danh sách quyền đã cấp.
- [x] `POST /meetings/{id}/leave` — trước đó **chỉ có kick mới set `left_at`**; người tự đóng tab sẽ
  vĩnh viễn được đếm là "đang ở trong phòng", khiến trigger `trg_close_meeting_if_empty` không bao giờ
  chạy và số người hiển thị sai mãi mãi.
- [x] `GET /miniapps/iptv/channel-lists/{listId}/groups` — có POST tạo nhóm kênh/kênh nhưng **không có
  GET nào đọc lại được**: kênh tạo xong không hiển thị lại được ở bất kỳ đâu, Mini App IPTV không thể
  có giao diện. Trả nguyên cây (groups + channels lồng nhau) trong 1 request.

Frontend:
- [x] `MeetingRoomPage` (`/meetings/:id`) — **WebRTC thật qua `livekit-client` v2**, không phải mô
  phỏng: lưới video theo số người, bật/tắt mic/cam, trình chiếu màn hình, rời phòng, host kết thúc cho
  tất cả. Dùng `livekit-client` thuần (không dùng `@livekit/components-react`) để không kéo thêm một
  hệ thống UI riêng vào dự án — đổi lại phải tự ép render lại ô video mỗi khi LiveKit bắn sự kiện
  track/participant (LiveKit không phát sự kiện React nào).
- [x] Bảng điều khiển của host ngay trong phòng: phòng chờ (duyệt/từ chối), mời ra, cấp/thu quyền
  `share_screen` + `mini_app`, tạo link mời 24 giờ.
- [x] `JoinMeetingPage` (`/meetings/join/:token`) — xem trước (chủ phòng/số người/có cần duyệt không)
  → vào phòng → nếu phải chờ thì **poll** cho tới khi host duyệt rồi tự vào. Poll là bắt buộc: Media
  Service chưa có tầng WebSocket, token LiveKit nằm trong Redis và **chỉ đọc được đúng 1 lần**.
- [x] `ChatRoomPage`: nút "Gọi video" (mở họp gắn với hội thoại) + banner "Đang có cuộc họp — Tham
  gia" cho cả P2P lẫn Group, poll 10 giây/lần.
- [x] Mini App IPTV: `IptvManagePage` (`/app/iptv`, quản lý danh sách/nhóm/kênh riêng của mỗi người)
  và `IptvPanel` (chọn kênh xem ngay trong phòng họp, chỉ hiện với host hoặc người được cấp quyền
  `mini_app`).

**Giới hạn đã biết, ghi rõ để không hiểu nhầm là đã xong:**
- **Mini App chưa đồng bộ được cả phòng**: đúng như ghi chú sẵn có trong `MiniAppSessionEndpoints.cs`,
  `POST /mini-app/start` chỉ kiểm tra quyền rồi trả 200 — không có tầng WebSocket nên các client khác
  trong phòng không được báo. Mỗi người tự chọn kênh riêng; muốn "cùng xem 1 kênh" hiện phải tự thoả
  thuận qua chat. Đây là giới hạn của backend đã có, không phải thiếu sót của Frontend.
- **Luồng `.m3u8` (HLS) chưa phát được trên Chrome/Firefox** — thẻ `<video>` chỉ phát sẵn MP4/WebM
  (và HLS trên Safari). Cần thêm `hls.js` khi có nguồn phát thật để kiểm chứng; chưa đưa vào để không
  kéo thêm phụ thuộc cho một thứ chưa test được.
- **Rời phòng khi đóng tab** dùng `fetch` + `keepalive:true` chứ **không** dùng `navigator.sendBeacon`
  — beacon không gắn được header `Authorization` nên sẽ bị 401.

**Verify thật qua HTTP thật (script 13 bước, 43 phép kiểm tra, tất cả PASS):** preflight CORS từ đúng
origin Frontend → tạo 3 tài khoản + workspace + thêm thành viên thật → chưa họp thì `/meetings/active`
trả 204, người ngoài nhóm bị chặn 403 → Trưởng nhóm mở họp → thành viên **tự tìm thấy** cuộc họp →
vào thẳng không cần invite, **giải mã JWT LiveKit nhận được** để xác nhận đúng `room=meeting-{id}` và
đúng `identity` (không tin suông là "có token"), người ngoài nhóm bị 403 → liệt kê người trong phòng
(đúng nickname thật, đúng role) → cấp quyền `mini_app` rồi kiểm chứng lại qua `/participants` → tạo và
**đọc lại** danh sách kênh IPTV, người khác không đọc được của mình (404) → lấy stream URL (người
ngoài phòng 403) → rời phòng, kiểm tra danh sách giảm đúng, gọi lại lần 2 vẫn 204 (idempotent) → host
tải lại trang vẫn xin được token mới → **trọn vẹn luồng link mời**: tạo link → xem trước → người ngoài
vào phòng chờ → host thấy → duyệt → người đó poll nhận được token → **poll lần 2 xác nhận token đã bị
tiêu thụ** (`participant` + token `null`) → không phải host thì không kết thúc được (403) → host kết
thúc → `/meetings/active` lại trả 204. Đã dọn sạch dữ liệu test ở cả 4 CSDL (Identity/WorkSpace/Chat/
Media/MiniApp), xác nhận workspace "eberg" và tài khoản thật của người dùng dự án còn nguyên.

**Lỗi cấu hình LiveKit phát hiện khi người dùng dự án bấm mở phòng họp thật trên trình duyệt:** phòng
kết nối được signaling nhưng luôn `NegotiationError: negotiation timed out`. Đọc log LiveKit thấy rõ
nguyên nhân: `use_external_ip: true` khiến LiveKit hỏi STUN để tìm IP công cộng rồi **quảng bá chính
IP công cộng của nhà mạng (116.96.45.39) làm địa chỉ nhận media**. Trình duyệt ở ngay cùng máy gửi gói
UDP ra Internet tới IP đó và không bao giờ quay về được (NAT hairpin thất bại) — log ICE ghi
`requestsSent: 8, responsesReceived: 0`, `state: "failed"`. Signaling qua cổng 7880 vẫn OK nên nhìn bề
ngoài tưởng đã kết nối.

- [x] Sửa `Tainguyen/infra/livekit-values.yaml`: `use_external_ip: false` + thêm `node_ip: "127.0.0.1"`
  (bắt buộc đi kèm — nếu không LiveKit quảng bá IP pod `10.244.x.x` mà Windows host không route tới
  được). Dùng được vì kind đã map sẵn `7881/tcp` + `7882/udp` ra host. Đã `helm upgrade` + khởi động
  lại, xác nhận log đổi thành `nodeIP: 127.0.0.1`.
- **Lưu ý khi test 2 máy khác nhau trong cùng LAN:** phải đổi `node_ip` thành IP LAN của máy chạy
  LiveKit (vd `192.168.1.x`); `127.0.0.1` chỉ dùng được khi mọi client ở trên cùng 1 máy.
- **Đã kiểm chứng sửa xong bằng log server thật:** trước khi sửa
  `"state": "failed", requestsSent: 8, responsesReceived: 0`; sau khi sửa
  `"[local][selected:1] udp4 host 127.0.0.1:53398"` + `"connectionType": "udp"` và các lần rời phòng
  đều là `reason: "CLIENT_REQUEST_LEAVE"` (thoát bình thường) — tức WebRTC đã bắt tay thành công.
- **Vướng khi nâng cấp:** pod LiveKit dùng `hostPort` cho `rtc-tcp`/`rtc-udp`, mà cụm chỉ có 1 node —
  nên `rollout restart` sẽ treo vĩnh viễn ở `Pending` ("didn't have free ports for the requested pod
  ports") vì pod mới chờ pod cũ nhả cổng còn pod cũ chờ pod mới sẵn sàng. Phải **xoá tay pod cũ** để
  pod mới vào chỗ.

**Nâng LiveKit server 1.9.0 → 1.13.5:** client `livekit-client` 2.21 gọi đường dẫn signaling **mới**
`/rtc/v1`, server 1.9.0 chưa có nên trả 404 (`"v1 RTC path not found. Consider upgrading your LiveKit
server version"`), client phải lùi về `/rtc` — vẫn chạy được nhưng mỗi lần kết nối tốn thừa một
request thất bại và một dòng lỗi đỏ trong console.

- [x] **Chart Helm lag hơn image**: bản chart mới nhất trên `helm.livekit.io` vẫn là `1.9.0`
  (appVersion v1.9.0), trong khi image trên Docker Hub đã tới `v1.13.5`. Không nâng được bằng cách
  đổi chart version — phải **ghi đè `image.tag`** trong `livekit-values.yaml`.
- [x] `kind load docker-image` **thất bại** với image đa nền tảng (`ctr: content digest ... not found`)
  — bỏ qua, để node tự pull thẳng từ Docker Hub.
- **Verify thật qua HTTP thật:** Media Service tạo phòng trên bản 1.13.5 trả 201 (xác nhận Server API
  còn tương thích với SDK `Livekit.Server.Sdk.Dotnet` đang dùng) → host lấy được token → gọi
  `/rtc/v1/validate` trả **400 `join_request is required`** thay vì **404 `not found`** (400 = endpoint
  ĐÃ TỒN TẠI, chỉ thiếu tham số mà client thật luôn gửi kèm) → đường dẫn cũ `/rtc/validate` vẫn trả 200
  (tương thích ngược). Service vẫn giữ đúng NodePort 30880/30881/30882 và các cổng host 7880/7881/7882.
  Đã dọn dữ liệu test.

**Lỗi nghiêm trọng nhất của F5 — "tải lại trang một cái là chết cả cuộc họp"** (tự gây ra, tự phát
hiện qua ảnh chụp màn hình của người dùng dự án: phòng hiện *"Người tham gia (0)"* và
*"Không tạo được link mời"* trong khi họ đang ngồi trong phòng). Truy CSDL thấy ngay:

```
meeting 7:      status=ended,  ended_at=03:22:59.260222
participant 49: joined 03:22:47, left_at=03:22:59.259659   <- cùng thời điểm
```

Nguyên nhân: Frontend đăng ký handler `pagehide` gọi `POST /meetings/{id}/leave` để "dọn `left_at` khi
đóng tab". Nhưng `pagehide` chạy cả khi **TẢI LẠI TRANG** (F5, Vite tự reload sau khi sửa code, điều
hướng). Chuỗi đổ vỡ: F5 → `/leave` → `left_at` được set → trigger `trg_close_meeting_if_empty` thấy
phòng rỗng → **kết thúc luôn cuộc họp**. Người dùng quay lại thì phòng đã `ended`, nên
`GET /participants` trả 0 người và `POST /invites` trả 404. Nó còn gây thêm lỗi camera: bản trang cũ
chưa kịp nhả camera thì bản mới đã đòi → `NotReadableError` dù **không có ứng dụng nào khác dùng
camera** (Chrome hiển thị đúng triệu chứng này: Camera *"Recently used"*, Microphone *"Using now"*).

- [x] **Gỡ bỏ hoàn toàn handler `pagehide`** — tải lại trang KHÔNG PHẢI là rời phòng. Chỉ còn ghi nhận
  rời phòng khi người dùng **bấm nút** rời / bị kick / host kết thúc.
- [x] Bù lại chỗ hổng "đóng tab thẳng thì không ai set `left_at`" bằng cơ chế đúng thay vì đoán:
  `LiveKitService.RoomExistsAsync()` + tự chữa lành trong `GET /meetings/active` — LiveKit tự dọn
  phòng rỗng sau `EmptyTimeout` (5 phút), nên "phòng bên LiveKit không còn" là tín hiệu đáng tin cậy
  rằng cuộc họp đã tan; lúc đó mới đánh dấu `ended` + set `left_at` cho những người còn sót.
  **Fail-open**: LiveKit lỗi/không gọi được thì coi như phòng vẫn còn — một sự cố tạm thời của LiveKit
  không được phép đi kết thúc cuộc họp thật của người dùng.
- [x] Thử lại 1 lần sau 700ms khi bật camera/mic thất bại — xử lý đúng khoảng tranh chấp thiết bị lúc
  trang cũ chưa nhả mà trang mới đã đòi.
- [x] Frontend nhận biết `status === "ended"` → hiện màn hình *"Cuộc họp này đã kết thúc"*. Trước đây
  không kiểm tra: màn hình đứng yên, hiện 0 người, mọi thao tác 404 mà không nói lý do.

**Verify thật qua HTTP thật (9/9 PASS)** đúng kịch bản gây lỗi: mở họp → vào phòng (1 người) →
**mô phỏng F5** → xin lại token OK → cuộc hop **vẫn `active`** → vẫn đếm đúng 1 người (không phải 0) →
**vẫn tạo được link mời** (đúng thứ trước đây báo *"Không tạo được link mời"*) → thành viên khác vẫn
thấy cuộc họp đang mở → cuối cùng bấm "Rời phòng" thật thì cuộc họp **vẫn kết thúc đúng như thiết kế**
(không phá mất hành vi đúng khi sửa bug). Đã dọn dữ liệu test, xác nhận workspace "eberg" và tài khoản
thật còn nguyên.

**Nguyên nhân THẬT của "camera luôn báo bị chiếm dù không ứng dụng nào bật"** — người dùng dự án phản
bác đúng lời giải thích ban đầu ("đóng Zoom/Teams đi"), và log lần sau chỉ thẳng thủ phạm:

```
connection state changed: disconnected -> connecting     <- HAI LAN
disconnect from room  /  Abort connection attempt due to user initiated disconnect
DataChannel error on lossy: User-Initiated Abort ... sctpCauseCode: 12
publisher data channel 'RELIABLE' closed unexpectedly
client leave request received (action=0)                 <- LiveKit DUOI phien cu ra
```

`<StrictMode>` (bật trong `main.tsx`) **gọi effect 2 lần** ở chế độ dev. Effect kết nối phòng trước
đây tạo 1 `Room` mỗi lần và chạy song song, gây hai hậu quả:
1. Cả 2 `Room` dùng **cùng identity** (= userId) nên LiveKit coi bản mới là phiên trùng và **đuổi bản
   cũ ra** — chính là chuỗi `client leave request` + data channel đóng đột ngột (`sctpCauseCode: 12`).
2. Cả 2 cùng đòi camera → bản thứ hai **luôn** nhận `NotReadableError: Could not start video source`
   dù máy không có ứng dụng nào khác dùng camera.

- [x] Sửa: **tuần tự hoá** mọi thao tác kết nối/ngắt qua một promise dùng chung (`connectionChain`) —
  việc ngắt phòng cũ luôn chạy xong TRƯỚC khi việc kết nối phòng mới bắt đầu, nên chỉ có đúng 1 `Room`
  sống tại một thời điểm và camera được nhả hoàn toàn trước khi đòi lại. Lần chạy bị StrictMode huỷ
  được đánh dấu `cancelled` trước khi tới lượt nên **bỏ qua hẳn** — không tạo `Room`, không đụng camera.
- [x] Việc ngắt phòng trong cleanup cũng phải xếp hàng: gọi trực tiếp thì nó chạy trong lúc `connect()`
  của chính lần đó còn dở (`Room` chưa kịp gán vào biến), khiến phòng cũ không bao giờ được đóng tử tế
  và vẫn giữ camera.
- [x] Sửa lại nội dung cảnh báo — bản cũ khẳng định chắc nịch là "do ứng dụng khác chiếm dụng", chính
  là lời giải thích sai đã làm người dùng đi tìm nhầm hướng.

**3 lỗi Frontend lộ ra sau khi luồng media chạy được** (trước đó bị lỗi ICE che mất):
- [x] `enableCameraAndMicrophone()` **thất bại nguyên khối** — camera đang bị ứng dụng khác chiếm
  (`NotReadableError: Could not start video source`) làm mất LUÔN cả micro dù micro hoàn toàn rảnh.
  Sửa: bật mic và cam **riêng biệt**, cái nào hỏng chỉ mất cái đó.
- [x] Các nút bật/tắt mic/cam/trình chiếu **không bắt lỗi** → lỗi rơi tự do thành unhandled rejection:
  người dùng bấm nút và **không thấy gì xảy ra**, không biết tại sao. Sửa: bọc try/catch, phân biệt
  `NotAllowedError` (bị chặn quyền → hướng dẫn bấm biểu tượng khoá trên thanh địa chỉ) với
  `NotReadableError` (thiết bị bị chiếm dụng → hướng dẫn đóng ứng dụng kia).
- [x] Thêm trạng thái `notice` (vàng) tách khỏi `error` (đỏ) — hỏng camera thì phòng **vẫn dùng được**,
  không được hiển thị như lỗi chí mạng làm người dùng tưởng phải thoát ra.

**Người lạ vào họp bằng link — theo yêu cầu người dùng dự án** ("người lạ vào link chỉ bảo họ điền
biệt danh thôi, nếu người đó đăng nhập sẵn thì vào luôn, nó tiện với người lạ"). Trước đó
`/meetings/join/:token` bị bọc `ProtectedRoute` nên **người chưa có tài khoản không vào được** — link
mời gần như vô dụng với đúng đối tượng nó sinh ra để phục vụ.

- [x] Bỏ `ProtectedRoute` khỏi route `/meetings/join/:token`. Trang tự phân nhánh: **đã đăng nhập** →
  hiện "Bạn đang đăng nhập là X" + bấm vào thẳng, không hỏi lại gì; **chưa đăng nhập** → chỉ hỏi
  **đúng một** ô tên hiển thị.
- [x] Tái dùng `POST /auth/guest` (UC-04, Identity Service đã có sẵn từ F0) để cấp JWT cho khách —
  không dựng cơ chế danh tính mới, không bắt đăng ký email/mật khẩu.
- [x] **Vá thêm một lỗ hổng phát hiện khi làm phần này:** khách được duyệt xong mà **F5 lại trang là
  kẹt cứng** — token duyệt nằm trong Redis và chỉ đọc được ĐÚNG 1 LẦN, còn `POST /meetings/{id}/join`
  thì trả 403 vì khách không phải thành viên hội thoại. Sửa: ai **đã là người trong phòng**
  (`left_at IS NULL`) thì luôn được cấp lại token — họ đã được nhận vào rồi, tải lại trang không phải
  là mất quyền.

**Verify thật qua HTTP thật (12/12 PASS)**, mô phỏng đúng người lạ hoàn toàn: xem trước link **không
cần đăng nhập** (200) → cố vào phòng khi chưa có danh tính bị chặn đúng (401) → chỉ với 1 biệt danh là
có phiên Guest (`userType=guest`, không email/mật khẩu) → vào phòng chờ → **host thấy đúng cái tên
khách tự đặt** → duyệt → khách nhận token → **F5 vẫn xin được token mới** (chỗ trước kia kẹt cứng) →
một người lạ KHÁC chưa được duyệt vẫn bị chặn 403 (không mở toang cửa) → khách hiện đúng trong danh
sách người trong phòng. Đã dọn dữ liệu test.

**Thảo luận trong cuộc họp — theo yêu cầu người dùng dự án, KHÔNG có trong tài liệu gốc.** Mục 7.1
liệt kê đầy đủ tính năng Media Service (mở họp / mời / phân quyền / dọn dẹp / chia sẻ định danh /
Mini App / hạ tầng) và **không hề có chat trong cuộc họp**; Media DB cũng không có bảng nào lưu tin
nhắn, UC-31→UC-37 không có use case nào về việc này. Đây là phần mở rộng tự thêm, tham chiếu cách
Microsoft Teams làm (người ẩn danh chat được trong lúc họp, mất quyền khi rời).

**Ba quyết định thiết kế chính:**

- [x] **Nằm trong chính bảng `messages` của hội thoại nhóm**, phân biệt bằng cột mới `meeting_id`
  (NULL = luồng chat chính), thay vì tạo một conversation riêng. Lý do quyết định: file đính kèm **tự
  động** tính vào hạn mức lưu trữ của nhóm — trigger DB cộng `storage_used_bytes` theo
  `conversation_id` — đúng yêu cầu "file cũng tính vào 2GB tổng" mà không phải viết thêm một dòng
  logic kế toán nào.
- [x] **Không mã hoá** (`is_encrypted = false`). Khách vãng lai vào họp bằng link **không có cặp khoá
  X25519 nào** nên không thể dùng E2EE của chat nhóm. Đánh đổi đã biết và được chấp nhận — Teams cũng
  không mã hoá đầu cuối chat trong họp.
- [x] **Quyền truy cập hai nhánh**: thành viên nhóm vào được bất kể cuộc họp còn hay đã kết thúc (theo
  lựa chọn "giữ lại, vẫn nhắn tiếp được"); khách vãng lai chỉ khi **đang thực sự ở trong cuộc họp VÀ
  cuộc họp còn diễn ra** — rời phòng/hết họp là mất quyền, giống Teams. Với thành viên nhóm **không**
  gọi Media Service (đỡ một vòng gọi mạng mỗi request, và không để sự cố của Media Service làm chết
  luôn thảo luận của thành viên thật); an toàn vì mọi truy vấn đều ràng buộc `conversation_id`.

**API mới:**
- [x] `GET /internal/meetings/{id}/membership/{userId}` (**Media Service**) — Chat Service hỏi "người
  này có đang ở trong cuộc họp đó không". Trả kèm `conversationId` để đối chiếu cuộc họp có đúng thuộc
  hội thoại đang mở hay không, và `status` để phân biệt còn/đã kết thúc.
- [x] `GET/POST /conversations/{cid}/meetings/{mid}/messages` (**Chat Service**) — đọc/gửi trong thảo
  luận. Text ở đây **không** đòi `contentNonce`/`recipientKeys` như luồng chat chính.
- [x] `GET /conversations/{cid}/meetings` — liệt kê các cuộc họp đã có thảo luận, để phòng chat hiện
  link xem lại. Lấy từ chính Chat DB chứ không hỏi Media Service: cái màn hình cần là "những thảo luận
  **có nội dung** để xem", không phải "mọi cuộc họp từng mở".
- [x] `POST /files/upload-url` nhận thêm `meetingId` (tuỳ chọn) — khách gửi được file trong thảo luận;
  `GET /files/{id}/download-url` lấy `meetingId` từ **chính tin nhắn chứa file** (không nhận từ client,
  tránh giả mạo).
- [x] SignalR: group **riêng** `meeting-{id}` (không dùng chung group của conversation) — khách nghe
  được thảo luận nhưng **tuyệt đối không** nghe lén được luồng chat chính của nhóm.
- [x] `GET /conversations/{id}/messages` nay lọc `meeting_id IS NULL`; tin thảo luận **cố ý không** ghi
  vào cache Redis (cache đánh chỉ mục theo conversation, tin thảo luận chui vào sẽ lẫn sang chat chính).
- [x] Chat Service có thêm `IdentityClient` — tên người gửi trong thảo luận phải hỏi Identity Service
  vì khách vãng lai không thuộc workspace nào, lấy theo cách cũ sẽ ra "người trong nhóm" cho mọi khách.

**Frontend:**
- [x] **Thẻ cuộc họp** trong phòng chat (thay banner chữ đơn thuần trước đây): "Cuộc họp đang diễn ra"
  + nút **Gia nhập** + nút **Xem thảo luận**. Kèm mục "Thảo luận của các cuộc họp trước" khi không có
  cuộc họp nào đang mở.
- [x] `MeetingDiscussion` dùng chung cho 2 chỗ: trang thảo luận riêng (`/app/chat/:id/meetings/:mid`)
  và panel ngay trong phòng họp (nút "💬 Thảo luận"). Gửi được chữ, ảnh, video, ghi âm, tệp.
  **Không cần nhập PIN** vì luồng này không mã hoá.

**Lỗi thật gặp trong lúc làm:** EF Core không dịch được `GroupBy(...).Select(...)` khi gọi thẳng
constructor của record (`The LINQ expression ... could not be translated`, trả 500). Sửa: chiếu sang
kiểu ẩn danh trước rồi map sang record trong bộ nhớ.

**Verify thật qua HTTP thật (19 + 5 = 24 phép kiểm tra, tất cả PASS):** thành viên gửi tin không mã hoá
và đọc lại đúng nội dung gốc → khách **chưa** vào họp bị chặn 403 → khách vào bằng link, được duyệt →
đọc/gửi được, **tên khách hiện đúng** (không phải "người trong nhóm") → khách **không** đọc được luồng
chat chính (403) → người ngoài nhóm và ngoài họp bị chặn → **tin thảo luận không lẫn vào luồng chat
chính** → khách upload file: **dung lượng nhóm tăng đúng đúng số byte** (0 → 12345), thành viên tải
được file đó, người ngoài thì 403 → hết họp: thành viên **vẫn nhắn tiếp được**, khách **mất quyền** →
liệt kê đúng số cuộc hop có thảo luận, đếm đúng số tin, sắp xếp mới nhất trước, người ngoài nhóm không
liệt kê được. Đã dọn sạch dữ liệu test ở cả 4 CSDL.

**Focus mode — khung trình bày ở trung tâm, chỉ một người trình bày một lúc.** Phần này **có trong
đặc tả gốc** nhưng trước đó chưa làm giao diện: sơ đồ `Tainguyen/Drawing2.pdf` ghi Mini App "mở dưới
dạng mini web nhúng trong khuôn cuộc họp, hiển thị ở **focus view**" và liệt kê "bật/tắt focus mode"
là một tính năng **cấp phép riêng lẻ**; schema `meeting_permissions.permission_type` cũng đã có sẵn
giá trị `'focus_mode'` bên cạnh `'share_screen'`/`'mini_app'`.

- [x] **Trạng thái "ai đang trình bày" lưu trong METADATA CỦA PHÒNG bên LiveKit**, không phải bảng
  riêng trong Media DB. Ba lý do: (a) LiveKit **tự** broadcast `RoomMetadataChanged` cho cả phòng nên
  Media Service không cần tầng WebSocket riêng (vốn vẫn chưa có); (b) người vào **muộn** đọc được ngay
  từ `room.metadata` lúc kết nối, không bao giờ lỡ mất trạng thái; (c) phòng tan thì metadata mất
  theo, không để lại rác.
- [x] `GET/POST/DELETE /meetings/{id}/presentation` — giành/nhả suất trình bày. **Chỉ một người tại
  một thời điểm**: người sau nhận **409** kèm tên người đang trình bày, không đè lên người trước
  (đúng cách Teams làm). Người đang trình bày bấm lại thì được coi là đổi nội dung, không tự chặn mình.
- [x] Quyền **riêng lẻ theo từng loại**: `kind=screen` đòi `share_screen`, `kind=mini_app` đòi
  `mini_app` — quyền này **không** dùng thay cho quyền kia. Host luôn trình bày được.
- [x] Dừng trình bày: chính người đó, **hoặc Chủ phòng** (để gỡ kẹt khi người trình bày mất mạng mà
  không kịp tắt).
- [x] Frontend: bố cục đổi hẳn khi có người trình bày — khung trình bày chiếm **trung tâm**, lưới
  người tham gia co lại thành **dải ngang** bên dưới; thanh báo "🔴 X đang trình chiếu màn hình / đang
  mở Mini App" kèm nút Dừng. Nội dung trình chiếu dùng `object-fit: contain` (không cắt viền như video
  khuôn mặt — cắt nội dung trình chiếu là mất chữ).
- [x] Nút "Trình chiếu" nay **giành suất TRƯỚC** rồi mới bật chia sẻ màn hình. Nếu người dùng bấm Huỷ ở
  hộp chọn màn hình của trình duyệt thì **trả lại suất vừa giành** — nếu không, cả phòng sẽ kẹt ở focus
  mode với một màn hình trống.

**Ghim người vào giữa — LÀM SAI RỒI SỬA LẠI theo phản hồi người dùng dự án.** Bản đầu tôi dựng ghim
thành **lệnh áp cho cả phòng** (kiểu Spotlight của Teams): lưu trạng thái ở server, kiểm tra quyền
`focus_mode`, ai ghim thì màn hình mọi người đều đổi theo. Người dùng dự án bác lại: *"ghim này chỉ
hoạt động ở front end mỗi người thôi chứ, cái focus mode chỉ là tự động chứ không bắt buộc"*.

Phản hồi này đúng và làm thiết kế gọn hơn hẳn. Nguyên tắc rút ra: **chỉ những thứ THỰC SỰ dùng chung
mới cần trạng thái ở server.** Màn hình đang chia sẻ và mini app đang mở là dùng chung thật (ai cũng
xem cùng một nguồn) — còn "tôi muốn nhìn ai to hơn" thuần tuý là sở thích xem của từng người, đưa lên
server là vừa thừa vừa tước quyền tự chọn của người khác.

- [x] **Gỡ bỏ** `kind=focus` khỏi API — trạng thái trình bày ở server nay chỉ còn `screen`/`mini_app`.
- [x] Ghim chuyển thành **trạng thái cục bộ của Frontend** (`pinnedUserId`), không gửi lên server,
  không ảnh hưởng ai. Hệ quả: **không cần quyền gì cả**, ai cũng ghim được trên màn hình của mình.
- [x] Focus mode **tự động** bật khi có người trình chiếu, nhưng **không bắt buộc**: thêm nút
  "Xem dạng lưới" để tự thoát, và ghim của chính mình luôn **thắng** focus mode tự động.
- [x] Việc thoát focus mode chỉ áp dụng cho **lượt trình bày đang diễn ra**, không phải tắt vĩnh viễn:
  mỗi lượt trình bày mới (người khác bắt đầu, hoặc đổi loại) sẽ trả lại chế độ tự động. Nếu không,
  thoát một lần là những lần sau người khác trình chiếu cũng không được đưa vào khung trình bày nữa —
  vừa khó hiểu vừa làm mất luôn ý nghĩa của "tự động".
- [x] **Tự bỏ ghim khi người bị ghim rời phòng** — nếu không, khung trung tâm kẹt ở một ô trống mãi.

**Hệ quả cần ghi nhận thẳng thắn:** quyền `focus_mode` trong `meeting_permissions` giờ **không còn
đường dùng** — vì hành vi mà nó định bảo vệ đã được xác định lại là thao tác cục bộ, không cần cấp
phép. Cột vẫn giữ nguyên trong schema (không xoá dữ liệu đã có), nhưng không endpoint nào kiểm tra nó
nữa. Đây là chỗ đặc tả gốc và thiết kế thực tế lệch nhau, ghi lại để không ai tưởng là bỏ sót.

**Verify sau khi sửa (5/5 PASS):** chia sẻ màn hình vẫn chạy → payload **không còn** trường ghim →
vẫn chỉ một người trình bày một lúc (409) → `kind=focus` **đã bị gỡ, trả 400** → mini app vẫn chạy.
*(Lần chạy đầu báo FAIL ở bước 409 vì test quên cấp quyền `share_screen` trước nên bị chặn ở tầng
quyền — lỗi của test, không phải sản phẩm; đã sửa test và chạy lại.)*

**Verify thật qua HTTP thật (18/18 PASS):** chưa ai trình bày → 204 → thành viên chưa được cấp quyền bị
chặn 403 → host bật được ngay (không cần tự cấp quyền cho mình) → **cấp quyền `share_screen` cho thành
viên rồi, họ vẫn KHÔNG đè lên được (409)** kèm đúng tên người đang trình bày → người khác trong phòng
đọc được trạng thái (nên vào muộn vẫn thấy focus mode) → người ngoài phòng 403 → người khác không tự ý
dừng được của người ta (403) → chính chủ dừng → suất được nhả, người kia giành được → **host gỡ kẹt
được cho người khác** → Mini App theo đúng cơ chế đó với quyền `mini_app` riêng, **quyền `share_screen`
không dùng thay được** → `kind` sai trả 400. Đã dọn dữ liệu test.

**Rà soát lại toàn bộ UC-31→UC-37 sau khi làm xong F5 — vá nốt 5 gap.** Đối chiếu
`Tainguyen/usecase-media-service.docx` và `media-service-api.yaml` với code: **mọi endpoint trong
OpenAPI gốc đều đã có**, nhưng còn 5 chỗ lệch trong luồng use case:

- [x] **UC-34 bước 1d — điều chỉnh âm lượng của người khác** (đặc tả ghi rõ "xử lý phía client").
  Dùng `RemoteParticipant.setVolume()` của LiveKit chứ không đặt `<audio volume>`: cách sau sẽ mất tác
  dụng mỗi khi track được gắn/tháo lại.
- [x] **UC-34 bước 1e — tắt hiển thị camera người khác** ("client-side, tiết kiệm băng thông"). Dùng
  `RemoteTrackPublication.setSubscribed(false)` chứ **không** ẩn bằng CSS: ẩn CSS thì trình duyệt VẪN
  tải video về, mất đúng mục đích tiết kiệm băng thông của tính năng. Huỷ đăng ký là LiveKit ngừng gửi
  luồng đó tới máy này.
- [x] **UC-31 bước 4 — publish sự kiện TẠO PHÒNG qua RabbitMQ.** Trước đó chỉ publish khi *mời trực
  tiếp* (UC-32), còn việc *mở cuộc họp* không phát sự kiện nào. Thêm hàng đợi **riêng**
  `media.meeting-created` (không dùng chung `media.meeting-invite`) vì đối tượng nhận khác hẳn: mời
  trực tiếp là gửi cho đúng 1 người đã chọn, còn tạo phòng là sự kiện cần báo cho cả nhóm. Media
  Service không có bản sao `workspace_members` nên chỉ gửi kèm `ConversationId`, để consumer tự tra
  danh sách người nhận. **Vẫn chưa có consumer bên Identity** — cùng tình trạng với mọi queue khác.
- [x] **UC-37 bước 5 + lỗ hổng lớn hơn: thẻ `<video>` thuần KHÔNG phát được `.m3u8` trên
  Chrome/Firefox** (chỉ Safari phát được HLS sẵn). Nghĩa là Mini App IPTV trước đây **thực tế chưa xem
  được kênh nào**, dù toàn bộ API đã chạy đúng — đây mới là gap lớn nhất của UC-37 chứ không phải bước
  5. Thêm `hls.js` + tách `IptvPlayer.tsx`: phát được ở mọi trình duyệt, đọc danh sách audio track
  **thật từ luồng** (`hls.audioTracks`) để chọn, kèm thanh âm lượng riêng. Cột `audio_track` trong DB
  chuyển vai trò thành "track ưu tiên mặc định" — chỉ là gợi ý do người tạo kênh nhập, trình phát đối
  chiếu với track thật trong luồng, không khớp thì giữ mặc định của luồng.
- [x] **Sai tên giá trị `mode`**: spec định nghĩa `enum: [in_chat, standalone]` nhưng Frontend gửi
  `"direct"`. Chạy đúng (backend chỉ so `== "in_chat"`) nhưng lệch hợp đồng API — đã sửa.

**Verify thật:** `mode=standalone` tạo được cuộc hop với `conversationId=null`, `mode=in_chat` vẫn gắn
đúng hội thoại → đọc thẳng RabbitMQ thấy **đúng 2 message** trong `media.meeting-created` với payload
đúng như thiết kế (`{"MeetingId":23,"HostId":119,"ConversationId":null,...}` cho cuộc họp độc lập và
`ConversationId:27` cho cuộc họp trong nhóm). Đã dọn dữ liệu test và làm rỗng hàng đợi.

**Còn lại, KHÔNG phải gap mà là quyết định đã ghi nhận:** UC-32 kiểm tra bạn bè (hệ thống không có
tính năng bạn bè ở bất kỳ service nào), UC-32 floating notification (chưa có consumer), UC-35 quyền
`focus_mode` (đã xác định lại ghim là cá nhân hoá, không cần cấp phép), UC-37 4a lệch vài giây giữa
các client (đánh đổi đã chấp nhận trong chính đặc tả).

**Ghi chú thêm về lỗi CORS giả:** khi Identity Service ném exception chưa bắt (vd sai mật khẩu CSDL →
`28P01`), response 500 **không đi qua middleware CORS** nên không có header `Access-Control-Allow-Origin`
— trình duyệt báo thành "blocked by CORS policy" thay vì hiện lỗi 500 thật. Đã kiểm chứng sau khi sửa:
preflight trả 204 và cả response 401 (sai mật khẩu thật) đều kèm đúng header CORS. **Khi thấy lỗi CORS
bất ngờ ở một endpoint vốn vẫn chạy, phải xem log server trước — rất có thể là lỗi 500 đội lốt.**

**Ghi chú:** trong lúc test có phát hiện `POST /workspaces/{id}/members` **không kiểm tra `userId` có
tồn tại thật hay không** (gửi thiếu trường thì thêm nhầm thành viên `userId=0` mà vẫn trả 201). Đây là
lỗ hổng có thật của WorkSpace Service nhưng nằm ngoài phạm vi F5 — đã dọn dữ liệu rác, ghi lại ở đây
để vá sau.

---

**Frontend F6 (Admin Page) — hoàn thành, verify thật qua HTTP thật:**

Route `/admin/*`, 5 màn hình dùng chung vỏ `AdminShell` (KHÔNG dùng `AppShell` — dock dưới của
`AppShell` là điều hướng của người dùng thường, trộn vào chỉ làm rối):

- [x] `/admin/users` — danh sách + tìm kiếm + phân trang; panel chi tiết kèm danh sách vi phạm,
      nút gỡ khoá và xoá vĩnh viễn (có `confirm`)
- [x] `/admin/violations` — vi phạm spam, phân trang
- [x] `/admin/complaints` — danh sách + hội thoại + gửi phản hồi, hiện rõ "còn N giờ" theo TTL Redis
- [x] `/admin/storage` — duyệt/từ chối yêu cầu nạp dung lượng *(nợ từ F4)*
- [x] `/admin/system` — CPU/RAM theo pod/node (tự làm mới 15s) + form scale service

**Quyền:** `AdminRoute` đọc claim `role` **từ chính access token** chứ không từ `authStore.user`
(`AuthUser` không có trường `isAdmin`), qua `decodeJwtIsAdmin` trong `lib/jwt.ts`. Đây chỉ là lớp ẩn
giao diện — AdminService vẫn tự trả 403 cho mọi `/admin/*`, đã verify bằng token thiếu claim → 403.

**Một lỗi thật của backend lộ ra khi ghép Frontend:**
- [x] `POST /admin/system/services/{name}/scale` trả **500 với body RỖNG** khi deployment không tồn
      tại — chỉ bắt mỗi `HttpOperationException` với status `Forbidden`, còn `NotFound` rơi thẳng
      xuống unhandled. Chọn nhầm tên deployment là thao tác sai bình thường của Admin (nhất là khi
      service đang chạy bằng Docker Compose chứ không trong K8s), mà màn hình chỉ hiện được câu lỗi
      chung chung. Đã thêm nhánh `NotFound` → 404 `deployment_not_found` kèm tên deployment, và
      nhánh còn lại → 502 `k8s_error`. Verify: 404 có thông báo đúng, `replicas=0` vẫn 400.

**Lỗi thật phát hiện lúc chuẩn bị deploy: Admin Service KHÔNG có CORS.**

Đây là service **duy nhất trong 6 service** không cấu hình CORS, trong khi trang Quản trị gọi thẳng
từ trình duyệt. Toàn bộ kiểm thử F6 trước đó dùng `curl` — mà `curl` không áp dụng same-origin
policy, nên lỗi không hề lộ ra: 13/13 test đều xanh trong khi trang thật sẽ chết ngay ở request đầu.
Bài học: **API xanh hết bằng curl vẫn chưa chứng minh được trang web dùng được.**

Đã thêm `AddCors` + `UseCors("Frontend")` đọc từ `Cors:AllowedOrigins` đúng theo mẫu của 4 service
kia, và thêm section `Cors` vào `appsettings.json`. Verify: preflight `OPTIONS /admin/users` với
`Origin: http://localhost:5173` → **204 + `Access-Control-Allow-Origin`** (trước đó không có header
nào).

**CỐ Ý KHÔNG LÀM — nút "Yêu cầu dựng thêm LiveKit":** sau khi chốt dùng LiveKit Cloud managed
(`HUONG-DAN-DEPLOY.md` mục 6.0) thì Cloud tự lo mở rộng. Endpoint `POST /admin/system/livekit/expand`
vốn cũng chỉ ghi 1 dòng log rồi trả 202 — dựng nút cho nó là tạo ra một nút giả vờ có tác dụng.
Endpoint vẫn giữ nguyên, muốn hiện lại chỉ cần thêm vào `AdminSystemPage.tsx`.

**Ghi chú về dashboard tài nguyên:** Metrics Server chỉ trả **lượng đang dùng**, không trả giới hạn,
nên không tính được phần trăm hạn mức thật. Thanh đo vẽ theo tương quan với pod ngốn nhất trong danh
sách và có ghi chú rõ điều đó — trung thực hơn là bịa ra một mức trần.

**Đã cấp quyền admin cho tài khoản `khoabeoloidom@gmail.com` (id 49)** qua
`POST /internal/users/49/promote-admin` — trước đó DB không có tài khoản admin nào nên không ai vào
được trang này.

---

**Phân trang lưới phòng họp — bắt buộc để phòng đông chạy được:**

Trước đó phòng họp render **toàn bộ** người tham gia. Ở 100 người (giới hạn trong đặc tả) mỗi máy
phải giải mã ~99 luồng video cùng lúc — trình duyệt đứng trước khi kịp lo chi phí. `adaptiveStream`
đã bật sẵn hạ được *bitrate* mỗi luồng khi ô nhỏ, nhưng **không giảm được số luồng**.

- [x] Phân trang: 9 ô/trang (desktop) · 4 (màn hẹp); focus mode 6 · 2. Theo dõi `matchMedia`
      `(max-width: 768px)` để đổi theo màn hình thật chứ không đoán.
- [x] **Focus mode đổi bố cục theo Teams**: khung lớn bên trái, cột ô nhỏ có phân trang bên phải
      (`meet-stage-row` + `meet-side-tiles`). Màn hẹp thì cột tụt xuống dưới thành dải ngang. Thay
      cho `meet-grid-strip` (dải ngang dưới đáy) trước đây.
- [x] **Chỉ subscribe ô đang hiển thị** — đây mới là phần tiết kiệm thật. Ba nguồn quyết định gộp
      lại: đang ở khung lớn → luôn giữ; ở trang hiện tại → giữ; bị người dùng tự ẩn → bỏ (thắng mọi
      thứ trên). Chỉ đụng `Track.Source.Camera`, **không** đụng audio (vẫn phải nghe được mọi người)
      và không đụng luồng chia sẻ màn hình.
- [x] `toggleHideVideo` bỏ phần tự gọi `setSubscribed`, chỉ đổi state — từ khi có phân trang thì có
      HAI nguồn cùng điều khiển một thứ, dễ lệch (vd bỏ ẩn một người đang ở trang khác sẽ subscribe
      lại luồng không ai nhìn). Nay effect điều phối là nguồn duy nhất.

**Lỗi thật lint bắt được, có sẵn từ trước:** ba nhánh `return` sớm (`status === "error" | "left" |
"ended"`) nằm **trước** một loạt `useEffect`, nên khi rời phòng hoặc cuộc họp kết thúc thì số hook
giảm giữa hai lần render → React ném *"Rendered fewer hooks than expected"*. 3 hook cũ đã dính sẵn
(reset `gridOverride`, áp lại âm lượng, tự bỏ ghim), 3 hook mới thêm vào làm nặng thêm. Sửa bằng
cách **dời ba nhánh thoát sớm xuống cuối**, sau toàn bộ hook — không phải nhồi hook lên trên.
`npm run lint` từ **6 lỗi → 0**.

---

**Đổi nguồn camera / micro / loa trong cuộc họp (`DevicePicker.tsx`) — ngoài đặc tả:**

Đã kiểm tra `Drawing2.pdf` và `usecase-media-service.docx`: **không** tài liệu nào yêu cầu chọn thiết
bị phần cứng. Danh sách tính năng phòng họp trong sơ đồ chỉ có bật/tắt cam, bật/tắt mic, chia sẻ màn
hình, mini app, chỉnh âm lượng người khác, tắt hiển thị camera người khác, duyệt/đuổi/kết thúc. Câu
*"chọn kênh âm thanh riêng nếu có"* thuộc UC-37 là audio track của luồng IPTV, đã làm từ F5.

Chọn **trong cuộc họp**, không làm màn hình kiểm tra thiết bị trước khi vào. Đổi lại được một thứ
quan trọng: đã ở trong phòng nghĩa là quyền camera/mic **đã được cấp**, nên `enumerateDevices` trả về
tên thật (`"HD Webcam C920"`) thay vì chuỗi rỗng như khi chưa có quyền — đúng cái bẫy lớn nhất của
màn hình pre-join.

- [x] Dùng `RoomEvent.MediaDevicesChanged` của LiveKit thay vì tự nghe
      `navigator.mediaDevices.ondevicechange` — SDK đã bọc sẵn. Cắm tai nghe giữa buổi là danh sách
      tự cập nhật.
- [x] `RoomEvent.ActiveDeviceChanged` để bắt trường hợp **không do mình bấm**: rút thiết bị đang dùng
      thì trình duyệt tự nhảy về mặc định, ô chọn phải đổi theo chứ không được hiện tên thiết bị đã rút.
- [x] Ẩn hẳn mục chọn loa khi trình duyệt không hỗ trợ — dò `"setSinkId" in HTMLMediaElement.prototype`
      chứ không đoán theo user agent. Firefox/Safari không có. Để một ô chọn bấm vào không có tác dụng
      còn tệ hơn là không có.
- [x] Nhớ lựa chọn qua `localStorage`, nhưng **chỉ áp lại khi thiết bị đó còn cắm** — mang laptop đi
      chỗ khác mà vẫn cố gán lại webcam ở nhà thì vô nghĩa.
- [x] Bắt `NotReadableError` / `NotAllowedError` khi đổi (camera đang bị ứng dụng khác giữ) và
      `refresh()` về đúng thiết bị đang thực sự chạy — cùng bài học với `toggleDevice` ở F5: không bắt
      thì lỗi thành unhandled rejection, người dùng chọn xong không thấy gì xảy ra.

---

## 7. Media Service & MiniApp

### 7.1 Mô tả

**Mở cuộc họp:** mở trong nhóm chat (gắn liền 1 group, tạo tin nhắn mời trong luồng chat) hoặc tự mở (độc lập).

**Mời tham gia:** tạo link mời (chờ duyệt) hoặc mời bạn bè trực tiếp (kiểm tra qua Identity Services).

**Phân quyền trong phòng:**
- *Chủ phòng họp:* bật/tắt cam/mic, chia sẻ màn hình, bắt đầu mini app, điều chỉnh âm lượng người khác, tắt hiển thị camera người khác (tiết kiệm băng thông), **duyệt người vào phòng (chỉ host)**, đuổi người tham gia, kết thúc cuộc họp.
- *Người dùng thường:* dùng được tính năng khi được **cấp phép riêng lẻ từng tính năng** (share màn hình / mini app / focus mode), không phải all-or-nothing.

**Dọn dẹp:** phòng tự giải phóng tài nguyên khi hết người.

**Chia sẻ định danh:** Guest chỉ chia sẻ nickname; user đăng nhập chia sẻ nickname + email.

**Mini App (ví dụ IPTV):** mở dưới dạng mini web trong focus view; user tự thêm playlist `.m3u8`; mỗi người trong phòng tự fetch stream riêng (không relay qua LiveKit) — đánh đổi: tiết kiệm băng thông LiveKit, đổi lại có thể lệch vài giây giữa các client.

**Hạ tầng:** LiveKit Service + TURN Service tích hợp chung, giới hạn 100 người/phòng. Media DB (Postgres + Redis) cho dữ liệu phiên; MiniApp DB (Postgres) riêng cho mini app.

---

### 7.2 Thiết kế CSDL

#### Phần A — Media DB

**Bảng `meetings`** — đại diện cho 1 phiên họp/cuộc gọi.

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| host_id | BIGINT | NOT NULL | Logical FK → users.id — Chủ phòng họp, bất biến trong suốt phiên |
| workspace_id | BIGINT | NULL | Logical FK → workspaces.id — có giá trị khi mở từ trong 1 nhóm (UC-31) |
| conversation_id | BIGINT | NULL | Logical FK → conversations.id — cố ý lưu trùng với workspace_id (denormalize) để tránh join qua nhiều DB |
| status | VARCHAR(10) | NOT NULL, DEFAULT 'active', CHECK IN ('active','ended') | |
| max_participants | INT | NOT NULL, DEFAULT 100 | Giới hạn theo cụm LiveKit hiện tại |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| ended_at | TIMESTAMPTZ | NULL | Set tự động khi phòng hết người (UC-36) |

**Bảng `meeting_participants`**

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| meeting_id | BIGINT | NOT NULL, FK → meetings(id) ON DELETE CASCADE | |
| user_id | BIGINT | NOT NULL | Logical FK |
| role | VARCHAR(10) | NOT NULL, DEFAULT 'participant', CHECK IN ('host','participant') | Chỉ để hiển thị UI; quyền thật dựa vào meetings.host_id |
| joined_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| left_at | TIMESTAMPTZ | NULL | NULL = vẫn đang trong phòng — dùng tính phòng hết người chưa (UC-36) |

**Bảng `meeting_invites`**

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| meeting_id | BIGINT | NOT NULL, FK → meetings(id) ON DELETE CASCADE | |
| invite_token | VARCHAR(100) | NOT NULL, UNIQUE | Chuỗi ngẫu nhiên trong link mời |
| invite_type | VARCHAR(10) | NOT NULL, DEFAULT 'link', CHECK IN ('link','direct') | 'link' hoặc 'direct' (UC-32) |
| created_by | BIGINT | NOT NULL | Logical FK |
| invited_user_id | BIGINT | NULL | Chỉ có giá trị khi invite_type='direct' |
| expires_at | TIMESTAMPTZ | NULL | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Bảng `meeting_permissions`**

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| meeting_id | BIGINT | NOT NULL, FK → meetings(id) ON DELETE CASCADE | |
| user_id | BIGINT | NOT NULL | Logical FK |
| permission_type | VARCHAR(20) | NOT NULL, CHECK IN ('share_screen','mini_app','focus_mode') | Cấp riêng lẻ từng tính năng (UC-35) |
| granted_by | BIGINT | NOT NULL | Logical FK — luôn là host |
| granted_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ràng buộc bổ sung:** `UNIQUE (meeting_id, user_id, permission_type)`.

#### Phần B — MiniApp DB

Ví dụ minh hoạ: Mini App 1 — App xem IPTV (UC-37).

**Bảng `iptv_channel_lists`**

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| user_id | BIGINT | NOT NULL | Logical FK — người tạo danh sách |
| name | VARCHAR(100) | NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Bảng `iptv_channel_groups`**

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| list_id | BIGINT | NOT NULL, FK → iptv_channel_lists(id) ON DELETE CASCADE | |
| group_name | VARCHAR(100) | NOT NULL | |

**Bảng `iptv_channels`**

| Cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| id | BIGSERIAL | PRIMARY KEY | |
| group_id | BIGINT | NOT NULL, FK → iptv_channel_groups(id) ON DELETE CASCADE | |
| channel_name | VARCHAR(100) | NOT NULL | |
| stream_url | VARCHAR(500) | NOT NULL | Link .m3u8 |
| audio_track | VARCHAR(100) | NULL | Danh sách track âm thanh nếu có (UC-37 bước 5); nếu cần nhiều track có cấu trúc, nên tách bảng con riêng |

**Ghi chú / Điểm mở:**
- `meetings` lưu cả workspace_id lẫn conversation_id dù có thể suy ra qua Social DB — denormalize CÓ CHỦ ĐÍCH để tránh join xuyên 2–3 database cho truy vấn thường dùng.
- Không có trạng thái "kênh IPTV đang phát trong phòng họp" ở Postgres — dữ liệu phiên (session-scoped) này hợp với Redis hơn, giống pattern online status đã dùng.

**SQL DDL:**

```sql
-- ===== Media DB =====
CREATE TABLE meetings (
  id                BIGSERIAL PRIMARY KEY,
  host_id           BIGINT NOT NULL,
  workspace_id      BIGINT,
  conversation_id   BIGINT,
  status            VARCHAR(10) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','ended')),
  max_participants  INT NOT NULL DEFAULT 100,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ
);

CREATE INDEX idx_meetings_workspace ON meetings(workspace_id);
CREATE INDEX idx_meetings_status ON meetings(status);

CREATE TABLE meeting_participants (
  id           BIGSERIAL PRIMARY KEY,
  meeting_id   BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL,
  role         VARCHAR(20) NOT NULL DEFAULT 'participant'
                 CHECK (role IN ('host','participant')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at      TIMESTAMPTZ
);

CREATE INDEX idx_participants_in_room
  ON meeting_participants(meeting_id) WHERE left_at IS NULL;

CREATE TABLE meeting_invites (
  id                BIGSERIAL PRIMARY KEY,
  meeting_id        BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  invite_token      VARCHAR(100) NOT NULL UNIQUE,
  invite_type       VARCHAR(10) NOT NULL DEFAULT 'link'
                      CHECK (invite_type IN ('link','direct')),
  created_by        BIGINT NOT NULL,
  invited_user_id   BIGINT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_permissions (
  id                BIGSERIAL PRIMARY KEY,
  meeting_id        BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL,
  permission_type   VARCHAR(20) NOT NULL
                      CHECK (permission_type IN ('share_screen','mini_app','focus_mode')),
  granted_by        BIGINT NOT NULL,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, user_id, permission_type)
);

-- Trigger: tu dong dong phong khi nguoi cuoi cung roi (UC-36)
CREATE OR REPLACE FUNCTION close_meeting_if_empty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.left_at IS NOT NULL AND OLD.left_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = NEW.meeting_id AND left_at IS NULL
    ) THEN
      UPDATE meetings
        SET status = 'ended', ended_at = now()
        WHERE id = NEW.meeting_id AND status = 'active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_meeting_if_empty
  AFTER UPDATE OF left_at ON meeting_participants
  FOR EACH ROW EXECUTE FUNCTION close_meeting_if_empty();

-- ===== MiniApp DB =====
CREATE TABLE iptv_channel_lists (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  name         VARCHAR(100) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE iptv_channel_groups (
  id           BIGSERIAL PRIMARY KEY,
  list_id      BIGINT NOT NULL REFERENCES iptv_channel_lists(id) ON DELETE CASCADE,
  group_name   VARCHAR(100) NOT NULL
);

CREATE TABLE iptv_channels (
  id             BIGSERIAL PRIMARY KEY,
  group_id       BIGINT NOT NULL REFERENCES iptv_channel_groups(id) ON DELETE CASCADE,
  channel_name   VARCHAR(100) NOT NULL,
  stream_url     VARCHAR(500) NOT NULL,
  audio_track    VARCHAR(100)
);
```
### 7.3 API (OpenAPI 3.0)

```yaml
openapi: 3.0.3
info:
  title: Media Service API
  version: "1.0.0"
  description: |
    API cho Media Service — mở/tham gia cuộc họp, điều khiển phòng, mini
    app. Tham chiếu Use Case: UC-31 đến UC-37.

    **Quan trọng — những gì KHÔNG nằm trong API này:** một số hành động ở
    UC-34 là thao tác client-side thuần tuý (client tự xử lý qua LiveKit
    JS SDK, không cần Media Service backend tham gia), nên KHÔNG có endpoint
    tương ứng ở đây:
      - Bật/tắt cam, mic của chính mình — gọi thẳng LiveKit SDK phía client.
      - Chia sẻ màn hình (của chính mình) — tương tự, LiveKit SDK client.
      - Điều chỉnh âm lượng người khác (client) — chỉ ảnh hưởng phía người
        nghe, xử lý local, không đồng bộ lên server.
      - Tắt hiển thị camera người khác (client) — tương tự, chỉ là lựa chọn
        render cục bộ để tiết kiệm băng thông phía người xem.

    Các hành động còn lại của UC-34 (đuổi người, duyệt vào phòng, kết thúc
    họp) cần thẩm quyền server-side thật sự (gọi LiveKit Server API), nên
    có endpoint riêng bên dưới.

servers:
  - url: https://api.example.com/media
    description: Qua API Gateway (Nginx) — rate limit + JWT check áp dụng ở tầng Gateway

tags:
  - name: Meetings
    description: Mở/xem/kết thúc cuộc họp (UC-31, UC-34)
  - name: Invites
    description: Mời & tham gia cuộc họp (UC-32, UC-33)
  - name: Participants
    description: Duyệt phòng chờ, đuổi người, cấp quyền (UC-33, UC-34, UC-35)
  - name: MiniApp
    description: Mini App IPTV (UC-37)

security:
  - bearerAuth: []

paths:
  # ============== MEETINGS ==============
  /meetings:
    post:
      tags: [Meetings]
      summary: Mở cuộc họp mới
      description: >-
        Tham chiếu UC-31. `mode=in_chat` gắn phòng với 1 conversation cụ
        thể (Chat Service sẽ tự tạo tin nhắn mời trong luồng chat của
        nhóm/cuộc trò chuyện đó); `mode=standalone` mở độc lập.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [mode]
              properties:
                mode:
                  type: string
                  enum: [in_chat, standalone]
                conversationId:
                  type: integer
                  format: int64
                  description: Bắt buộc nếu mode=in_chat
      responses:
        "201":
          description: Phòng đã được tạo
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Meeting"
        "503":
          description: >-
            Cụm LiveKit hiện tại đã đạt giới hạn 100 người/room cho các
            phòng đang chạy (UC-31, luồng ngoại lệ 2a) — cần Admin can
            thiệp scale thêm node
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /meetings/{meetingId}:
    get:
      tags: [Meetings]
      summary: Xem thông tin phòng họp
      parameters:
        - $ref: "#/components/parameters/MeetingId"
      responses:
        "200":
          description: Thông tin phòng
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Meeting"

  /meetings/{meetingId}/end:
    post:
      tags: [Meetings]
      summary: Kết thúc cuộc họp
      description: Tham chiếu UC-34. Chỉ Chủ phòng họp được gọi.
      parameters:
        - $ref: "#/components/parameters/MeetingId"
      responses:
        "204":
          description: Đã kết thúc
        "403":
          description: Người gọi không phải Chủ phòng họp

  # ============== INVITES ==============
  /meetings/{meetingId}/invites:
    post:
      tags: [Invites]
      summary: Tạo link mời hoặc mời bạn bè trực tiếp
      description: >-
        Tham chiếu UC-32. Với `type=direct`, Media Service kiểm tra qua
        Identity Service để xác nhận `invitedUserId` đúng là bạn bè của
        người gửi trước khi tạo lời mời.
      parameters:
        - $ref: "#/components/parameters/MeetingId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [type]
              properties:
                type:
                  type: string
                  enum: [link, direct]
                invitedUserId:
                  type: integer
                  format: int64
                  description: Bắt buộc nếu type=direct
      responses:
        "201":
          description: Lời mời đã tạo
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Invite"
        "422":
          description: invitedUserId không phải bạn bè của người gửi (UC-32, luồng ngoại lệ 1c)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /meetings/join/{inviteToken}:
    get:
      tags: [Invites]
      summary: Xem thông tin phòng trước khi tham gia (chưa vào phòng)
      description: Dùng để hiển thị màn hình xác nhận trước khi user bấm "Tham gia".
      parameters:
        - name: inviteToken
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Thông tin cơ bản của phòng
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MeetingPreview"
        "404":
          description: Link không hợp lệ hoặc đã hết hạn

    post:
      tags: [Invites]
      summary: Tham gia cuộc họp qua link
      description: >-
        Tham chiếu UC-33. Với Guest chỉ cần `nickname`; với user đã đăng
        nhập, `nickname` + email được lấy tự động từ JWT. Kết quả trả về
        tuỳ trạng thái duyệt: nếu phòng yêu cầu duyệt thủ công, trả
        `status=pending` và client phải chờ (poll `GET
        /meetings/{meetingId}` hoặc lắng nghe qua WebSocket); nếu được vào
        thẳng, trả kèm `livekitToken`.
      parameters:
        - name: inviteToken
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                nickname:
                  type: string
                  description: Bắt buộc nếu đang ở trạng thái Guest
      responses:
        "200":
          description: Kết quả tham gia
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/JoinResult"

  # ============== PARTICIPANTS ==============
  /meetings/{meetingId}/waiting-room:
    get:
      tags: [Participants]
      summary: Danh sách người đang chờ duyệt vào phòng
      description: >-
        Tham chiếu UC-33 bước 3. Chỉ Chủ phòng họp gọi được — quyền duyệt
        vào phòng CHỈ dành cho host, không áp dụng cho participant thường
        (đã xác nhận trong quá trình thiết kế).
      parameters:
        - $ref: "#/components/parameters/MeetingId"
      responses:
        "200":
          description: Danh sách đang chờ
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/WaitingParticipant"
        "403":
          description: Người gọi không phải Chủ phòng họp

  /meetings/{meetingId}/waiting-room/{userId}/approve:
    post:
      tags: [Participants]
      summary: Duyệt cho 1 người vào phòng
      parameters:
        - $ref: "#/components/parameters/MeetingId"
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Đã duyệt, người dùng nhận được livekitToken qua WebSocket
        "403":
          description: Người gọi không phải Chủ phòng họp

  /meetings/{meetingId}/waiting-room/{userId}/deny:
    post:
      tags: [Participants]
      summary: Từ chối cho 1 người vào phòng
      parameters:
        - $ref: "#/components/parameters/MeetingId"
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: Đã từ chối
        "403":
          description: Người gọi không phải Chủ phòng họp

  /meetings/{meetingId}/participants/{userId}/kick:
    post:
      tags: [Participants]
      summary: Đuổi người tham gia khỏi phòng
      description: >-
        Tham chiếu UC-34. Chỉ Chủ phòng họp được gọi. Gọi Server API của
        LiveKit (RemoveParticipant) để thực thi ngay lập tức. Hành động
        này là độc lập trong phạm vi 1 phiên họp — KHÔNG ảnh hưởng tới tư
        cách thành viên của người đó trong WorkSpace (khác với UC-22, xoá
        khỏi nhóm).
      parameters:
        - $ref: "#/components/parameters/MeetingId"
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "204":
          description: Đã đuổi khỏi phòng
        "403":
          description: Người gọi không phải Chủ phòng họp

  /meetings/{meetingId}/participants/{userId}/permissions:
    post:
      tags: [Participants]
      summary: Cấp quyền sử dụng 1 tính năng cho participant thường
      description: >-
        Tham chiếu UC-35. Cấp riêng lẻ từng tính năng (không phải
        all-or-nothing) — chỉ Chủ phòng họp được gọi.
      parameters:
        - $ref: "#/components/parameters/MeetingId"
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [permissionType]
              properties:
                permissionType:
                  type: string
                  enum: [share_screen, mini_app, focus_mode]
      responses:
        "201":
          description: Đã cấp quyền
        "403":
          description: Người gọi không phải Chủ phòng họp

    delete:
      tags: [Participants]
      summary: Thu hồi quyền đã cấp
      description: >-
        Không nêu tường minh trong UC-35, nhưng suy ra cần thiết theo cùng
        logic đã áp dụng cho endpoint mute/unmute bên Chat Service — nếu
        chỉ có chiều cấp quyền mà không có chiều thu hồi, Chủ phòng họp
        không có cách nào rút lại quyền đã cấp nhầm hoặc không còn muốn
        cấp nữa.
      parameters:
        - $ref: "#/components/parameters/MeetingId"
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
        - name: permissionType
          in: query
          required: true
          schema:
            type: string
            enum: [share_screen, mini_app, focus_mode]
      responses:
        "204":
          description: Đã thu hồi
        "403":
          description: Người gọi không phải Chủ phòng họp

  /meetings/{meetingId}/mini-app/start:
    post:
      tags: [Participants]
      summary: Bắt đầu mini app trong phòng (broadcast cho cả phòng)
      description: >-
        Tham chiếu UC-34 (Chủ phòng họp) và UC-35 (participant được cấp
        quyền mini_app). Server kiểm tra quyền tương ứng trước khi phát
        sự kiện qua WebSocket cho toàn phòng biết mini app nào vừa được mở.
      parameters:
        - $ref: "#/components/parameters/MeetingId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                appId:
                  type: string
                  example: iptv
      responses:
        "200":
          description: Mini app đã được kích hoạt cho cả phòng
        "403":
          description: Không phải host và không được cấp quyền mini_app (UC-35, luồng ngoại lệ 3a)

  # ============== MINI APP: IPTV ==============
  /miniapps/iptv/channel-lists:
    get:
      tags: [MiniApp]
      summary: Xem danh sách kênh của chính mình
      responses:
        "200":
          description: Danh sách
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/IptvChannelList"

    post:
      tags: [MiniApp]
      summary: Tạo danh sách kênh mới
      description: Tham chiếu UC-37 bước 2.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
      responses:
        "201":
          description: Đã tạo
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/IptvChannelList"

  /miniapps/iptv/channel-lists/{listId}/groups:
    post:
      tags: [MiniApp]
      summary: Tạo nhóm kênh trong 1 danh sách
      parameters:
        - name: listId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [groupName]
              properties:
                groupName:
                  type: string
      responses:
        "201":
          description: Đã tạo

  /miniapps/iptv/channel-lists/{listId}/groups/{groupId}/channels:
    post:
      tags: [MiniApp]
      summary: Thêm 1 kênh (.m3u8) vào nhóm kênh
      parameters:
        - name: listId
          in: path
          required: true
          schema:
            type: integer
            format: int64
        - name: groupId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [channelName, streamUrl]
              properties:
                channelName:
                  type: string
                streamUrl:
                  type: string
                audioTrack:
                  type: string
                  nullable: true
      responses:
        "201":
          description: Đã thêm kênh

  /meetings/{meetingId}/mini-app/iptv/stream-url:
    get:
      tags: [MiniApp]
      summary: Lấy link tải riêng cho chính client này
      description: >-
        Tham chiếu UC-37 bước 4: mỗi người trong phòng tự gọi endpoint này
        để lấy link `.m3u8` riêng — KHÔNG relay qua LiveKit, mỗi client tự
        fetch trực tiếp từ nguồn. Có thể lệch vài giây giữa các client do
        cách này (đánh đổi đã chấp nhận, xem UC-37 Ghi chú).
      parameters:
        - $ref: "#/components/parameters/MeetingId"
        - name: channelId
          in: query
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Link stream riêng cho client này
          content:
            application/json:
              schema:
                type: object
                properties:
                  streamUrl:
                    type: string
                  audioTrack:
                    type: string
                    nullable: true

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  parameters:
    MeetingId:
      name: meetingId
      in: path
      required: true
      schema:
        type: integer
        format: int64

  schemas:
    Meeting:
      type: object
      properties:
        id:
          type: integer
          format: int64
        hostId:
          type: integer
          format: int64
        status:
          type: string
          enum: [active, ended]
        maxParticipants:
          type: integer
        createdAt:
          type: string
          format: date-time

    MeetingPreview:
      type: object
      description: Thông tin tối giản, xem được TRƯỚC khi tham gia (chưa xác thực là thành viên phòng)
      properties:
        meetingId:
          type: integer
          format: int64
        hostNickname:
          type: string
        participantCount:
          type: integer
        requiresApproval:
          type: boolean

    Invite:
      type: object
      properties:
        id:
          type: integer
          format: int64
        type:
          type: string
          enum: [link, direct]
        inviteToken:
          type: string
        expiresAt:
          type: string
          format: date-time
          nullable: true

    JoinResult:
      type: object
      properties:
        status:
          type: string
          enum: [approved, pending]
        livekitToken:
          type: string
          nullable: true
          description: Chỉ có giá trị khi status=approved
        meetingId:
          type: integer
          format: int64

    WaitingParticipant:
      type: object
      properties:
        userId:
          type: integer
          format: int64
        nickname:
          type: string
        requestedAt:
          type: string
          format: date-time

    IptvChannelList:
      type: object
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
        createdAt:
          type: string
          format: date-time

    ErrorResponse:
      type: object
      properties:
        error:
          type: string
        message:
          type: string
```
### 7.4 Tiến độ triển khai

**Phạm vi:** Phase 5 (Meetings/Invites/Participants, Media DB) và Phase 6
(MiniApp IPTV, MiniApp DB) nay đã LÀM CẢ HAI — cùng nằm trong 1 service
`MediaService.Api` (đúng như OpenAPI spec muc 7.3 gộp chung 1 tài liệu/1
server), chỉ tách CSDL riêng theo "database per service".

**Cơ sở dữ liệu (Media DB)**
- [x] Tạo bảng `meetings`
- [x] Tạo bảng `meeting_participants` — **sửa lỗi thiết kế gốc:** cột `role`
      khai `VARCHAR(10)` nhưng giá trị `'participant'` dài 11 ký tự, không
      vừa — phát hiện thực tế khi test (lỗi Postgres `22001 value too long`).
      Đã sửa thành `VARCHAR(20)` trong DDL (cả `media-db-init.sql` lẫn tài
      liệu này) và `ALTER TABLE` trên instance đang chạy.
- [x] Tạo bảng `meeting_invites`
- [x] Tạo bảng `meeting_permissions`
- [x] Trigger `trg_close_meeting_if_empty` — verify thực tế: kick người cuối
      cùng → `meetings.status` tự chuyển `ended`.

**Cơ sở dữ liệu (MiniApp DB)** — hoàn thành ở Phase 6, CSDL Postgres riêng
(`Tainguyen/infra/miniapp-db-init.sql`, namespace `miniapp-db`, port 5437,
"database per service" tách khỏi Media DB đúng tinh thần kiến trúc chung).
- [x] Tạo bảng `iptv_channel_lists`
- [x] Tạo bảng `iptv_channel_groups`
- [x] Tạo bảng `iptv_channels`

**API**
- [x] `POST /meetings` — tạo `Meeting` + insert host vào
      `meeting_participants` + gọi LiveKit `CreateRoom` thật (verify qua log
      LiveKit server: `API RoomService.CreateRoom ... status: 200`). 503 khi
      LiveKit từ chối (dọn lại row vừa tạo, tránh "phòng ma").
      `mode=in_chat` gọi Chat Service tạo tin nhắn hệ thống (endpoint mới,
      xem mục Tích hợp).
- [x] `GET /meetings/{meetingId}` — **mở rộng so với schema `Meeting` gốc**
      (thêm `callerStatus`/`livekitToken`/`livekitUrl`) — xem giải thích ở
      mục Tích hợp bên dưới (cơ chế poll thay WebSocket).
- [x] `POST /meetings/{meetingId}/end` — chỉ host, gọi LiveKit `DeleteRoom`
      thật (verify qua log: `status: 200`), dọn waiting room trong Redis.
- [x] `POST /meetings/{meetingId}/invites` — cả `link` và `direct`. Verify
      thực tế: direct invite tới user không tồn tại → 422; tới user tồn tại
      → 201 + publish RabbitMQ (verify `rabbitmqctl list_queues` thấy
      message).
- [x] `GET /meetings/join/{inviteToken}` — preview, tính `requiresApproval`
      (xem quyết định tự thiết kế bên dưới).
- [x] `POST /meetings/join/{inviteToken}` — verify thực tế cả 2 nhánh: link
      invite → `status=pending` (vào waiting room); direct invite → duyệt
      ngay, trả `livekitToken` hợp lệ (giải mã JWT xác nhận đúng `room`,
      `identity`, `attributes.email`).
- [x] `GET /meetings/{meetingId}/waiting-room` — chỉ host.
- [x] `POST /meetings/{meetingId}/waiting-room/{userId}/approve` — verify
      thực tế toàn bộ chuỗi: join (pending) → host approve → member poll
      `GET /meetings/{meetingId}` nhận đúng `callerStatus=approved` +
      `livekitToken` thật (1 lần duy nhất, lần poll sau `callerStatus`
      chuyển `participant` và `livekitToken=null`) — **sửa 1 bug thực tế
      trong lúc test:** thứ tự kiểm tra ban đầu để nhánh "đã là participant"
      chặn trước nhánh "có token đang chờ", khiến người vừa được duyệt
      KHÔNG BAO GIỜ nhận được token — đã đổi thứ tự ưu tiên kiểm tra token
      trước.
- [x] `POST /meetings/{meetingId}/waiting-room/{userId}/deny` — đánh dấu
      trong Redis, người bị từ chối đọc được 1 lần qua poll
      (`callerStatus=denied`).
- [x] `POST /meetings/{meetingId}/participants/{userId}/kick` — gọi LiveKit
      `RemoveParticipant` thật (verify qua log — trả 404 "participant not
      found" vì test không có client WebRTC thật nào thực sự kết nối vào
      phòng, đúng như dự kiến do đây là test tầng backend/API, không phải
      test đầu-cuối trình duyệt thật; code đã bọc try/catch để không coi đây
      là lỗi).
- [x] `POST /meetings/{meetingId}/participants/{userId}/permissions` —
      verify 403 khi không phải host, 201 khi host cấp quyền.
- [x] `DELETE /meetings/{meetingId}/participants/{userId}/permissions` —
      verify 204.
- [x] `POST /meetings/{meetingId}/mini-app/start` — kiểm tra quyền (host
      HOẶC được cấp `mini_app`), verify 403 cho người ngoài phòng, 200 cho
      host. **Giới hạn đã biết:** vì chưa có tầng WebSocket, endpoint này
      CHỈ xác nhận quyền và trả 200 — KHÔNG thực sự "broadcast cho cả
      phòng" như mô tả gốc (UC-34/UC-35), các client khác trong phòng không
      có cách nào được báo real-time. Cần bổ sung khi dự án có tầng
      WebSocket/SignalR.
- [x] `GET /miniapps/iptv/channel-lists` — theo user (JWT), không thấy danh
      sách của người khác.
- [x] `POST /miniapps/iptv/channel-lists`
- [x] `POST /miniapps/iptv/channel-lists/{listId}/groups` — verify quyền sở
      hữu list (404 nếu list không phải của người gọi).
- [x] `POST /miniapps/iptv/channel-lists/{listId}/groups/{groupId}/channels`
- [x] `GET /meetings/{meetingId}/mini-app/iptv/stream-url` — verify 403 cho
      người không ở trong phòng, 200 kèm đúng `streamUrl`/`audioTrack` cho
      người trong phòng. **Quyết định tự đưa ra:** tài liệu gốc không nói rõ
      ai được gọi endpoint này — suy luận hợp lý nhất theo đúng tinh thần
      UC-37 ("mỗi người TRONG PHÒNG tự fetch riêng") là bất kỳ ai đang ở
      trong phòng (kể cả người thường, không riêng host/người được cấp
      quyền `mini_app`), vì việc XEM link không phải là hành động điều
      khiển mini app.

**Tích hợp**
- [x] LiveKit Service + TURN Service — cluster đã có từ Phase 0
      (`kind-livekit-cluster`). **Bổ sung theo yêu cầu:** STUN server dùng
      của Google (`stun.l.google.com:19302`, `stun1.l.google.com:19302`,
      miễn phí không giới hạn) thay vì tự dựng STUN riêng — cấu hình tại
      `Tainguyen/infra/livekit-values.yaml` (`rtc.stun_servers`), đã
      `helm upgrade` áp dụng lên cluster thật. TURN local vẫn giữ nguyên
      (bật `turn.enabled: true`) cho các trường hợp STUN không đủ (NAT đối
      xứng/firewall chặt).
- [x] Gọi LiveKit Server API thật qua `Livekit.Server.Sdk.Dotnet` (SDK cộng
      đồng chính thức được LiveKit liệt kê cho .NET) — `CreateRoom`,
      `DeleteRoom`, `RemoveParticipant`, `AccessToken` (sinh JWT cho
      client). KHÔNG có `Mute/Cam` server-side vì đúng như OpenAPI spec đã
      ghi chú rõ — bật/tắt cam/mic của CHÍNH MÌNH là thao tác client-side
      thuần tuý qua LiveKit JS SDK, không cần Media Service.
- [x] Publish thông báo mời họp qua RabbitMQ → Identity Services — queue
      `media.meeting-invite`, verify publish thành công. **CHƯA có consumer
      bên Identity Service** (cùng tình trạng với queue
      `workspace.member-notifications` của WorkSpace Service) — hệ thống
      chưa có cơ chế push-notification chung, chuẩn bị sẵn hàng đợi để dùng
      sau.
- [x] Kiểm tra bạn bè qua Identity Service khi mời trực tiếp — **KHÔNG làm
      đúng như tài liệu gốc được vì hệ thống này chưa có tính năng "bạn bè"
      ở BẤT KỲ service nào** (Identity/WorkSpace/Chat đều không có bảng
      friends). Quyết định tự thiết kế: thay bằng kiểm tra tối thiểu —
      `invitedUserId` phải là 1 user có thật trong hệ thống (422 nếu không).
      Cần bổ sung tính năng bạn bè thật sự ở service phù hợp trước khi ràng
      buộc này khớp đúng UC-32 nguyên bản.
- [x] Chat Service tạo tin nhắn mời khi mở họp trong nhóm chat — thêm
      endpoint nội bộ mới `POST /internal/conversations/{conversationId}/system-message`
      (Chat Service, dùng `MessageType.System` + `SenderId=null` đã có sẵn
      trong model từ trước nhưng chưa từng dùng tới cho đến bây giờ).

**Quyết định tự đưa ra khác (không có trong tài liệu gốc):**
- Không có cột `requiresApproval` nào trong schema `meetings`. Tự suy ra:
  invite `type=link` LUÔN cần duyệt (host chưa biết trước ai sẽ bấm link),
  invite `type=direct` KHÔNG cần duyệt (host đã chủ động chọn đúng người).
- Tài liệu gốc mô tả luồng "poll `GET /meetings/{meetingId}` hoặc lắng nghe
  qua WebSocket" nhưng dự án này CHƯA có tầng WebSocket/SignalR nào (kiểm
  tra toàn bộ codebase, không có service nào dùng). Since du an chua co lop
  nay, đã mở rộng response của `GET /meetings/{meetingId}` với
  `callerStatus`/`livekitToken`/`livekitUrl` để cơ chế poll THỰC SỰ hoạt
  động được, không chỉ là mô tả suông trong spec. Trạng thái "đang chờ
  duyệt"/"vừa được duyệt (token chờ lấy 1 lần)"/"bị từ chối (đọc 1 lần)" lưu
  trong Redis — dữ liệu phiên, không bền vững, đúng tinh thần "session-scoped
  hợp với Redis hơn" đã ghi trong Ghi chú/Điểm mở mục 7.2.


---

## 8. SpamTrackingService, Kafka, RabbitMQ

### 8.1 Mô tả

**SpamTrackingService:** consume Chat Log từ Kafka để phân tích spam (bất đồng bộ, có độ trễ tự nhiên). Escalation ladder: phát hiện spam → publish "Khóa tài khoản" qua RabbitMQ → Identity Services khoá tài khoản + đẩy thông báo → user khiếu nại → Admin xem xét → gỡ khoá hoặc publish "Delete Account Spam" → xoá vĩnh viễn.

**Apache Kafka — topic đang có:** `Register` (Login, Register History từ Identity Service), `Chat Log` (mọi tin nhắn, dùng cho SpamTrackingService và đồng bộ Redis), `Error Log` (chỉ ở mức hệ thống tổng thể, phục vụ admin/ops, chưa có consumer cụ thể).

**RabbitMQ — bảng tổng hợp Publisher → Consumer:**

| Publisher | Consumer | Sự kiện | Mục đích |
|---|---|---|---|
| SpamTrackingService | Identity Services | Khóa tài khoản | Khoá tạm khi phát hiện spam |
| SpamTrackingService | Identity Services | Delete Account Spam | Xoá vĩnh viễn sau khi Admin xác nhận |
| WorkSpace Service | Identity Services | Thông báo rời/bị xoá nhóm | Push notification |
### 8.2 API (OpenAPI 3.0)

```yaml
openapi: 3.0.3
info:
  title: SpamTrackingService API
  version: "1.0.0"
  description: |
    API cho SpamTrackingService (AntiSpamService). Tham chiếu Use Case:
    UC-11, UC-38.

    **Vì sao spec này rất mỏng:** SpamTrackingService về bản chất là một
    service hướng sự kiện (event-driven), không phải service hướng API:
      - Đầu vào (phát hiện spam): consume liên tục từ Kafka topic `Chat
        Log` — không có endpoint REST nào kích hoạt việc phân tích.
      - Đầu ra (hành động khi phát hiện vi phạm): publish "Khóa tài khoản"
        / "Delete Account Spam" qua RabbitMQ — không trả kết quả qua REST.

    REST API dưới đây CHỈ tồn tại cho 1 mục đích duy nhất: cho Admin
    Service truy vấn dữ liệu đã phân tích, phục vụ UC-11 (xem danh sách vi
    phạm) và UC-12 (xem chi tiết trước khi quyết định). Không có endpoint
    nào để "yêu cầu" SpamTrackingService phân tích hay hành động — đó là
    việc tự động, bất đồng bộ, không đồng bộ hoá được qua HTTP request/response.

servers:
  - url: https://internal.example.com/spam-tracking
    description: >-
      Nội bộ — chỉ Admin Service gọi được, KHÔNG đi qua API Gateway public.

tags:
  - name: Violations
    description: Truy vấn dữ liệu vi phạm đã phân tích (UC-11, UC-38)

security:
  - bearerAuth: []

paths:
  /internal/violations:
    get:
      tags: [Violations]
      summary: Danh sách người dùng vi phạm spam
      description: >-
        Tham chiếu UC-11. Dữ liệu phản ánh kết quả phân tích BẤT ĐỒNG BỘ từ
        Kafka Chat Log — có thể chưa cập nhật vi phạm vừa xảy ra trong vài
        giây/phút gần nhất (UC-11, luồng ngoại lệ 2a). Không có cách nào
        để client "ép" service phân tích ngay lập tức và chờ kết quả đồng bộ.
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: pageSize
          in: query
          schema:
            type: integer
            default: 20
        - name: status
          in: query
          description: Lọc theo trạng thái xử lý hiện tại
          schema:
            type: string
            enum: [locked, deleted]
      responses:
        "200":
          description: Danh sách vi phạm
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items:
                      $ref: "#/components/schemas/Violation"
                  total:
                    type: integer

  /internal/violations/{userId}:
    get:
      tags: [Violations]
      summary: Chi tiết lịch sử vi phạm của 1 user
      description: >-
        Dùng bởi Admin Service khi Admin xem chi tiết trước khi ra quyết
        định ở UC-12. Trả về TOÀN BỘ lịch sử vi phạm đã ghi nhận, không chỉ
        vi phạm gần nhất.
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        "200":
          description: Lịch sử vi phạm
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Violation"
        "404":
          description: User này chưa từng bị đánh dấu vi phạm

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    Violation:
      type: object
      properties:
        userId:
          type: integer
          format: int64
        nickname:
          type: string
        detectedAt:
          type: string
          format: date-time
        reason:
          type: string
          description: >-
            Diễn giải lý do vi phạm — ngưỡng/thuật toán phát hiện cụ thể
            (tần suất tin nhắn, từ khoá, pattern lặp...) thuộc phạm vi nội
            bộ của service này, CHƯA được đặc tả chi tiết ở tầng use case
            (xem UC-38, phần Ghi chú/Điểm mở) nên không đưa vào enum cố
            định ở đây — để dạng free-text cho tới khi quyết định nghiệp
            vụ đó được chốt.
        accountStatus:
          type: string
          enum: [locked, deleted]
```

### 8.3 Tiến độ triển khai

*Code: `SpamTrackingService/` (C#/.NET). Hạ tầng: `Tainguyen/infra/spamtracking-db.yaml` — schema
`violations` tự thiết kế, KHÔNG có trong tài liệu gốc (mục 8 chỉ mô tả API + luồng sự kiện, không
có "Thiết kế CSDL" riêng).*

**Thuật toán phát hiện spam — tự đề xuất** (tài liệu gốc ghi rõ UC-38 "điểm mở", chưa chốt thuật
toán/ngưỡng): kết hợp 3 tín hiệu chấm điểm — tần suất tin nhắn (rate), nội dung trùng lặp
(duplicate hash), từ khoá/pattern spam — tổng điểm vượt ngưỡng mới ghi nhận vi phạm, xem
`SpamDetector.cs`. Có thể cần hiệu chỉnh lại ngưỡng khi có dữ liệu thật.

**Cập nhật do E2EE (mục 6.5, sau khi tin nhắn Text được mã hoá client-side):** tín hiệu 2 (nội
dung trùng lặp) và tín hiệu 3 (từ khoá) **không còn hoạt động với tin nhắn Text** — Chat Service
publish `Content=null` lên Kafka cho tin nhắn Text đã mã hoá vì bản thân nó cũng không đọc được nội
dung. `SpamDetector.CheckAsync` đã có sẵn guard `if (!string.IsNullOrWhiteSpace(content))` bao quanh
2 tín hiệu này từ trước — không cần sửa logic, tự động bỏ qua đúng cách khi `content=null`, không
gây false-positive (nếu không có guard này, hash của chuỗi rỗng sẽ trùng nhau ở MỌI tin nhắn Text,
kích hoạt "phát hiện trùng lặp" sai cho toàn bộ user). Chỉ còn tín hiệu 1 (tần suất) hoạt động đầy đủ
cho tin nhắn Text — đánh đổi đã xác nhận với người dùng, giống hạn chế thật của Facebook/WhatsApp.

**Quyết định tự đưa ra:** vì Admin Service (nơi ra quyết định `Delete Account Spam` theo UC-12)
chưa tồn tại, cho SpamTrackingService **tự động leo thang**: vi phạm lần đầu → khoá; vi phạm lặp
lại (đã có violation trước đó) → tự động xoá vĩnh viễn, không chờ Admin duyệt. Cần sửa lại khi có
Admin Service (Phase 4).

**API (SpamTrackingService)**
- [x] `GET /internal/violations` — resolve nickname qua Identity Service, verify pagination
- [x] `GET /internal/violations/{userId}`

**Tích hợp**
- [x] SpamTrackingService: consumer Kafka topic `Chat Log` (tên thật: `chat.service-log`) —
      verify end-to-end: gửi tin trùng lặp + từ khoá spam → điểm 70/60 → ghi violation
- [x] SpamTrackingService: publish `Khóa tài khoản` qua RabbitMQ (queue `identity.account-locked`,
      **dùng lại đúng queue** Identity Service đã tạo sẵn ở Phase 1) — verify Identity Service
      nhận và khoá tài khoản thật, login sau đó bị 403
- [x] SpamTrackingService: publish `Delete Account Spam` qua RabbitMQ (queue MỚI
      `identity.delete-account-spam`, thêm consumer tương ứng bên Identity Service — không có
      trong code Phase 1 vì SpamTrackingService lúc đó chưa tồn tại) — verify xoá vĩnh viễn user
      thật khỏi DB khi vi phạm lần 2
- [x] Kafka: topic `Register` (Login, Register History) — tên thật: `identity.auth-history` (đã
      làm ở Phase 1)
- [x] Kafka: topic `Chat Log` — tên thật: `chat.service-log` (đã làm ở Phase 2, bổ sung field
      `Content` ở Phase 3 để phục vụ phân tích spam)
- [x] Kafka: topic `Error Log` — tên thật: `system.error-log`. Chỉ làm phần **producer** (đúng tinh
      thần "chưa có consumer cụ thể" của tài liệu gốc — chuẩn bị dữ liệu sẵn cho công cụ ops/ELK sau
      này, không tự bịa 1 consumer không được yêu cầu). `ErrorLogPublisher` + middleware bắt
      unhandled exception (publish rồi `throw` tiếp, không nuốt lỗi, không đổi hành vi trả lỗi mặc
      định của ASP.NET Core) — **CHỈ áp dụng cho 3 service đã có sẵn Kafka client** (Identity, Chat,
      SpamTrackingService); KHÔNG áp dụng cho WorkSpace/Admin/Media vì 3 service này chưa tích hợp
      Kafka, thêm mới chỉ cho tính năng log lỗi phụ này không tương xứng chi phí/lợi ích — ghi chú rõ
      đây là **phủ sóng một phần**, không phải toàn bộ 6 service như đúng nghĩa "mức hệ thống tổng
      thể" ban đầu.
- [x] RabbitMQ: hàng đợi cho từng cặp publisher → consumer đã liệt kê ở mục 8.1 — cả 3 cặp
      (SpamTracking→Identity khoá/xoá, WorkSpace→Identity thông báo rời nhóm) đã publish, chỉ
      riêng "thông báo rời nhóm" bên Identity CHƯA có consumer (mới publish, chưa xử lý)
**Sửa lỗi: mất RabbitMQ làm SẬP CẢ Identity Service** (phát hiện khi Docker khởi động lại):

`AccountLockedConsumerService.ExecuteAsync` gọi thẳng `CreateConnectionAsync`. Khi cả cụm cùng bật,
RabbitMQ (trong `kind-messaging-cluster`) lên sau container service → lỗi thoát ra ngoài → .NET mặc
định `BackgroundServiceExceptionBehavior.StopHost` → **dừng cả host**. Triệu chứng thật đã gặp:
container vào crash loop `exit 139`, toàn bộ luồng đăng nhập chết theo một thành phần chỉ phục vụ
việc khoá tài khoản vì spam.

- [x] Vòng thử lại có backoff 5→10→20→40→60s bọc quanh toàn bộ phần kết nối + consume. Mất RabbitMQ
      giờ chỉ làm chậm việc khoá tài khoản, **không** làm sập đăng nhập.
- [x] `AutomaticRecoveryEnabled = true` + `NetworkRecoveryInterval` cho trường hợp broker rớt **giữa
      chừng** — khác với lúc khởi động (vòng thử lại lo). Thiếu nó thì RabbitMQ restart một cái là
      consumer im lặng vĩnh viễn mà không hề báo lỗi.
- [x] Các lambda consumer bắt **biến cục bộ** `channel` thay vì field `_channel`: sau một lần nối
      lại, field đã trỏ sang channel mới trong khi consumer cũ còn sống → ack nhầm channel.
- [x] `StopAsync` dùng `CleanupAsync` (nuốt lỗi) thay vì `CloseAsync` trực tiếp — kết nối đang hỏng
      là đúng trường hợp hay gặp nhất lúc tắt service, `CloseAsync` ném lỗi ngay trong đường tắt.

**Verify thật bằng đúng kịch bản đã gây sập:** `kubectl scale deploy/rabbitmq --replicas=0` → restart
Identity → container **Up (healthy)**, `POST /auth/register` 201 và `/auth/login` 200 (trước đây chết
theo). Log backoff chạy đúng 20s → 40s. Bật RabbitMQ lại → **02:45:40 consumer tự nối lại**, không
cần restart Identity.

**Phạm vi:** chỉ Identity có lỗ này. Các publisher RabbitMQ ở Chat/Media/WorkSpace/Admin/SpamTracking
nối **lười** (trong method, không phải constructor) nên broker chết chỉ làm request publish lỗi,
không giết host.

**Triển khai thật lên server nhà + CI/CD — hoàn thành:**

Toàn hệ thống chạy trên **k3s** ở máy Ubuntu (8 nhân, 7,2 GB RAM): 18 pod, 2 namespace
(`chat-data` 11 pod, `chat-app` 7 pod), ResourceQuota 60/30/10 theo mục 5.4. LiveKit dùng Cloud,
Docker đã gỡ hẳn khỏi server — chỉ còn containerd của k3s, build bằng `nerdctl` + buildkit.

- [x] CI trên GitHub Actions: 6 service `dotnet build` + frontend lint/typecheck/build — **xanh ngay
      lần chạy đầu**
- [x] Release: 7 image lên GHCR, thẻ SHA + `latest`, cache layer qua Actions cache
- [x] CD kiểu **KÉO** (`image-watcher` CronJob trong k3s): CGNAT chặn chiều vào nên Actions không
      deploy thẳng được; cụm tự hỏi GHCR mỗi 2 phút, so **digest** với ConfigMap, khác thì rollout
- [x] Tách bí mật khỏi cấu hình: `appsettings.json` ×6 bỏ trống 13 khoá → **commit được** (trước đó
      5/6 file bị `.gitignore` chặn, nên image dựng từ CI sẽ thiếu cấu hình và chết lúc khởi động)
- [x] `dashboard.cachephoarong.click` qua cloudflared — dịch vụ đầu tiên ra được Internet thật

**Ba lỗi thật lộ ra trong quá trình này, đều thuộc loại "báo thành công nhưng không chạy":**

| Lỗi | Vì sao khó thấy |
|---|---|
| ResourceQuota thiếu 68Mi | `deployment/minio` báo *created* nhưng **không có pod nào** — quota từ chối tạo pod, deployment vẫn báo thành công |
| Traefik giữ cổng 80 | `frontend-lb` kẹt `EXTERNAL-IP <pending>` vĩnh viễn, curl vào 80 trả 404 của Traefik chứ không phải trang web |
| Admin Service không có CORS | 13/13 test F6 đều xanh vì test bằng `curl` — mà `curl` không áp dụng same-origin policy. Trang thật sẽ chết ở request đầu |

Bài học chung: **API xanh hết bằng `curl` chưa chứng minh được trang web dùng được**, và **tài nguyên
K8s báo "created" chưa chứng minh được nó đang chạy**.

- [x] Xác nhận KHÔNG dùng RabbitMQ cho `Delete Account Expired` — đúng, `GuestCleanupService` xử
      lý bằng cron job nội bộ Identity Service (đã làm ở Phase 1)

