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

**Hạ tầng nền:** Apache Kafka (event log: Register, Chat Log, Error Log) · RabbitMQ (task-queue cho notification/side-effect) · Redis (cache chung, đồng bộ từ Postgres qua Kafka) · MinIO (object storage) · LiveKit + TURN (WebRTC, giới hạn 100 người/room) · K8s (Admin Service dùng Service Account read-only để giám sát).

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

**Cơ sở dữ liệu**
- [ ] Tạo bảng `users` (kèm CHECK constraint chặn Guest có email/mật khẩu)
- [ ] Tạo bảng `oauth_links`
- [ ] Index `idx_users_email`, `idx_users_last_active`
- [ ] Cron job dọn Guest hết hạn 6 tháng (quét `last_active_at`)

**API**
- [ ] `POST /auth/login`
- [ ] `POST /auth/oauth/{provider}`
- [ ] `POST /auth/guest`
- [ ] `POST /auth/logout`
- [ ] `POST /auth/forgot-password`
- [ ] `POST /auth/verify-otp`
- [ ] `POST /auth/reset-password`
- [ ] `POST /auth/register`
- [ ] `GET /users/me`
- [ ] `PATCH /users/me/nickname`
- [ ] `GET /internal/users/{userId}`
- [ ] `GET /internal/users` (batch)
- [ ] `POST /internal/users/{userId}/unlock`

**Tích hợp**
- [ ] Publish `Login` / `Register History` lên Kafka
- [ ] Consumer RabbitMQ: `Khóa tài khoản`, `Delete Account Spam`
- [ ] Ghi/đọc session trong Redis
- [ ] Lưu OTP tạm trong Redis (TTL 5–10 phút)


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
- [ ] `GET /admin/users`
- [ ] `GET /admin/users/{userId}`
- [ ] `DELETE /admin/users/{userId}`
- [ ] `GET /admin/spam-violations`
- [ ] `POST /admin/users/{userId}/unlock`
- [ ] `GET /admin/complaints`
- [ ] `GET /admin/complaints/{userId}`
- [ ] `POST /admin/complaints/{userId}/reply`
- [ ] `GET /admin/system/resources`
- [ ] `POST /admin/system/services/{serviceName}/scale`
- [ ] `POST /admin/system/livekit/expand`

**Tích hợp**
- [ ] Gọi nội bộ Identity Service (danh sách user, unlock)
- [ ] Gọi nội bộ SpamTrackingService (danh sách/chi tiết vi phạm)
- [ ] Gọi nội bộ Chat Service (đọc/phản hồi khiếu nại)
- [ ] Publish `Delete Account Spam` qua RabbitMQ
- [ ] K8s Service Account read-only (`get`/`list` trên pods, nodes, metrics.k8s.io)
- [ ] K8s Role RIÊNG cho phép `patch` trên `deployments/scale` (tách khỏi Role read-only ở trên)
- [ ] Xác nhận Metrics Server đã cài trong cluster


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

**Cơ sở dữ liệu**
- [ ] Tạo bảng `workspaces`
- [ ] Tạo bảng `workspace_members`
- [ ] `UNIQUE INDEX idx_workspace_one_leader`
- [ ] Trigger `trg_cascade_delete_workspace_on_leader_leave`

**API**
- [ ] `POST /workspaces`
- [ ] `GET /workspaces/{workspaceId}`
- [ ] `PATCH /workspaces/{workspaceId}`
- [ ] `DELETE /workspaces/{workspaceId}`
- [ ] `GET /workspaces/{workspaceId}/members`
- [ ] `POST /workspaces/{workspaceId}/members`
- [ ] `DELETE /workspaces/{workspaceId}/members/{userId}` (kick / tự rời / giải tán nếu là leader)
- [ ] `PATCH /workspaces/{workspaceId}/members/{userId}/role`

**Tích hợp**
- [ ] Publish thông báo rời/bị xoá nhóm qua RabbitMQ → Identity Services
- [ ] Gọi Chat Service để dọn dữ liệu chat khi xoá/giải tán workspace (tránh dữ liệu mồ côi — xem mục 1)
- [ ] Trigger ngắt WebSocket phía Chat Service khi kick/rời nhóm


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
| object_key | VARCHAR(500) | NOT NULL | Đường dẫn object trong MinIO |
| file_type | VARCHAR(20) | NOT NULL, CHECK IN ('image','video','voice','file') | |
| size_bytes | BIGINT | NOT NULL | Dùng cộng/trừ storage_used_bytes qua trigger |
| uploaded_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Ghi chú / Điểm mở:**
- Hiển thị "người trong nhóm" khi 1 thành viên bị xoá khỏi group (UC-22) được **TÍNH ĐỘNG** lúc truy vấn (join sender_id với workspace_members), KHÔNG lưu cứng vào bảng messages — rẻ hơn nhiều so với update hàng loạt message rows.
- Edge case chưa xác nhận: nếu người bị xoá được thêm lại vào nhóm, theo cách tính động ở trên thì TOÀN BỘ tin nhắn cũ của họ sẽ tự động hiện lại tên thật. Nếu muốn ẩn danh giữ nguyên vĩnh viễn, cần đổi sang lưu cứng (snapshot).
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

**Cơ sở dữ liệu**
- [ ] Tạo bảng `conversations` (kèm CHECK shape p2p/group, unique index cặp P2P, unique index 1 group/workspace)
- [ ] Tạo bảng `messages`
- [ ] Tạo bảng `group_chat_settings`
- [ ] Tạo bảng `muted_members`
- [ ] Tạo bảng `files`
- [ ] Trigger `sync_storage_used` (2 chiều insert/delete)
- [ ] Cron job tự động xoá conversation P2P sau 6 tháng không hoạt động

**API**
- [ ] `POST /conversations/p2p`
- [ ] `GET /conversations/{conversationId}`
- [ ] `GET /conversations/{conversationId}/messages`
- [ ] `POST /conversations/{conversationId}/messages`
- [ ] `DELETE /conversations/{conversationId}/messages/{messageId}`
- [ ] `POST /files/upload-url`
- [ ] `GET /conversations/{conversationId}/files`
- [ ] `DELETE /conversations/{conversationId}/files/{fileId}`
- [ ] `POST /conversations/{conversationId}/mutes`
- [ ] `DELETE /conversations/{conversationId}/mutes/{userId}`
- [ ] `GET /conversations/{conversationId}/storage`
- [ ] `POST /conversations/{conversationId}/storage/topup`
- [ ] `POST /conversations/{conversationId}/storage/unlock`
- [ ] `GET /complaints/messages` (phải hoạt động kể cả khi tài khoản bị khoá)
- [ ] `POST /complaints/messages` (phải hoạt động kể cả khi tài khoản bị khoá)

**Tích hợp**
- [ ] Publish `Chat Service Log` lên Kafka sau mỗi tin nhắn
- [ ] Consumer `Write Chat` đồng bộ Redis từ Kafka
- [ ] Search Chat Service: route Redis (<10.000 tin & <10 ngày) / Postgres (còn lại)
- [ ] Publish thông báo tin nhắn mới qua RabbitMQ → Identity Services
- [ ] Lưu tạm hội thoại khiếu nại trong Redis, TTL 10 tiếng
- [ ] WebSocket (Signal IR) cho realtime tin nhắn/presence


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
  role         VARCHAR(10) NOT NULL DEFAULT 'participant'
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

**Cơ sở dữ liệu (Media DB)**
- [ ] Tạo bảng `meetings`
- [ ] Tạo bảng `meeting_participants`
- [ ] Tạo bảng `meeting_invites`
- [ ] Tạo bảng `meeting_permissions`
- [ ] Trigger `trg_close_meeting_if_empty`

**Cơ sở dữ liệu (MiniApp DB)**
- [ ] Tạo bảng `iptv_channel_lists`
- [ ] Tạo bảng `iptv_channel_groups`
- [ ] Tạo bảng `iptv_channels`

**API**
- [ ] `POST /meetings`
- [ ] `GET /meetings/{meetingId}`
- [ ] `POST /meetings/{meetingId}/end`
- [ ] `POST /meetings/{meetingId}/invites`
- [ ] `GET /meetings/join/{inviteToken}`
- [ ] `POST /meetings/join/{inviteToken}`
- [ ] `GET /meetings/{meetingId}/waiting-room`
- [ ] `POST /meetings/{meetingId}/waiting-room/{userId}/approve`
- [ ] `POST /meetings/{meetingId}/waiting-room/{userId}/deny`
- [ ] `POST /meetings/{meetingId}/participants/{userId}/kick`
- [ ] `POST /meetings/{meetingId}/participants/{userId}/permissions`
- [ ] `DELETE /meetings/{meetingId}/participants/{userId}/permissions`
- [ ] `POST /meetings/{meetingId}/mini-app/start`
- [ ] `GET /miniapps/iptv/channel-lists`
- [ ] `POST /miniapps/iptv/channel-lists`
- [ ] `POST /miniapps/iptv/channel-lists/{listId}/groups`
- [ ] `POST /miniapps/iptv/channel-lists/{listId}/groups/{groupId}/channels`
- [ ] `GET /meetings/{meetingId}/mini-app/iptv/stream-url`

**Tích hợp**
- [ ] LiveKit Service + TURN Service — cluster + Redis đồng bộ room state
- [ ] Gọi LiveKit Server API (Mute/Cam/Token, RemoveParticipant)
- [ ] Publish thông báo mời họp qua RabbitMQ → Identity Services
- [ ] Kiểm tra bạn bè qua Identity Service khi mời trực tiếp
- [ ] Chat Service tạo tin nhắn mời khi mở họp trong nhóm chat


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

**API (SpamTrackingService)**
- [ ] `GET /internal/violations`
- [ ] `GET /internal/violations/{userId}`

**Tích hợp**
- [ ] SpamTrackingService: consumer Kafka topic `Chat Log`
- [ ] SpamTrackingService: publish `Khóa tài khoản` qua RabbitMQ
- [ ] SpamTrackingService: publish `Delete Account Spam` qua RabbitMQ
- [ ] Kafka: topic `Register` (Login, Register History)
- [ ] Kafka: topic `Chat Log`
- [ ] Kafka: topic `Error Log` (mức hệ thống tổng thể — chưa có consumer)
- [ ] RabbitMQ: hàng đợi cho từng cặp publisher → consumer đã liệt kê ở mục 8.1
- [ ] Xác nhận KHÔNG dùng RabbitMQ cho `Delete Account Expired` (xử lý bằng cron job nội bộ Identity Service)

