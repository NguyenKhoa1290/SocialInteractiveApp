# ĐẶC TẢ FRONTEND & ADMIN PAGE

*Tổng hợp toàn bộ tính năng đã thảo luận trong suốt quá trình thiết kế hệ thống — không có CSDL/API riêng, chỉ gọi API của 6 service backend (Identity, Admin, WorkSpace, Chat, Media, SpamTrackingService).*

---

## Mục lục

1. [Tổng quan kỹ thuật](#1-tổng-quan-kỹ-thuật)
2. [Danh sách tính năng đầy đủ](#2-danh-sách-tính-năng-đầy-đủ)
3. [Bản đồ gọi API](#3-bản-đồ-gọi-api)
4. [Danh sách màn hình cần xây](#4-danh-sách-màn-hình-cần-xây)
5. [Ghi chú / Điểm mở](#5-ghi-chú--điểm-mở)
6. [Tiến độ triển khai](#6-tiến-độ-triển-khai)

---

## 1. Tổng quan kỹ thuật

**Frontend (người dùng thường)**
- **E2EE**: mã hoá đầu cuối theo cơ chế khoá bất đối xứng (public/private key) — cơ chế đã được thống nhất và phần logic mã hoá đã code xong; phần còn lại là **tích hợp phía Frontend**: sinh/lưu private key an toàn trên thiết bị, lấy public key của người nhận, mã hoá trước khi gửi và giải mã khi nhận — server không bao giờ thấy nội dung gốc.
- **Guest Token**: lưu & tự động gắn JWT Guest vào mọi request; xử lý sliding expiration (JWT tự gia hạn khi còn hoạt động, không cần user làm gì).
- **LiveKit JS Client**: kết nối trực tiếp tới LiveKit Service cho luồng audio/video — không đi qua Media Service backend, Media Service chỉ cấp token.
- **WebSocket (Signal IR)**: nhận tin nhắn/presence realtime, tách biệt khỏi REST API.

**Admin Page**
- App/route tách biệt hoàn toàn khỏi Frontend người dùng thường.
- Dùng chung cơ chế đăng nhập với Identity Service (không có luồng đăng nhập riêng cho Admin).
- Chỉ gọi Admin Service — không gọi trực tiếp các service backend khác (Admin Service là lớp điều phối).

---

## 2. Danh sách tính năng đầy đủ

### 2.1 Định danh & Tài khoản
- Đăng nhập bằng email + mật khẩu
- Đăng nhập bằng Google
- Đăng nhập bằng Facebook
- Truy cập dạng Guest (chỉ nhập nickname)
- Đăng ký bằng email + mật khẩu
- Đăng ký bằng Google / Facebook (kèm bước bắt buộc nhập nickname)
- Quên mật khẩu (gửi OTP qua email → xác thực → đặt mật khẩu mới)
- Đặt mật khẩu lần đầu cho tài khoản chỉ từng đăng nhập OAuth (thông điệp UI khác với "reset")
- Đăng xuất
- Xem/đổi nickname
- Nhận thông báo tài khoản bị khoá khi đăng nhập → điều hướng sang Khiếu nại

### 2.2 Workspace (Nhóm)
- Tạo nhóm mới (tên + avatar tuỳ chọn)
- Sửa tên / avatar nhóm (Trưởng nhóm, Phó nhóm)
- Xoá nhóm — **cảnh báo mạnh vì không thể hoàn tác** (Trưởng nhóm)
- Thêm thành viên (Trưởng nhóm, Phó nhóm)
- Phong hàm: Nhóm viên → Phó nhóm (Trưởng nhóm)
- Xoá phong hàm: Phó nhóm → Nhóm viên (Trưởng nhóm)
- Xoá thành viên / kick (Trưởng nhóm)
- Tự rời nhóm (Phó nhóm, Nhóm viên)
- Trưởng nhóm tự rời nhóm — **UI phải cảnh báo rõ: hành động này xoá LUÔN CẢ NHÓM**, không chỉ riêng tư cách thành viên của họ
- Xem thông tin nhóm & danh sách thành viên kèm vai trò

### 2.3 Chat 1-1 (P2P)
- Gửi tin nhắn văn bản (E2EE)
- Gửi ảnh (tĩnh, GIF)
- Gửi video (<50MB — tự nén nếu vượt; thông báo từ chối nếu nén xong vẫn quá lớn)
- Gửi voice (<25MB)
- Tạo vote/bình chọn
- *(Không hỗ trợ gửi file thông thường — quyết định có chủ đích)*
- Xem lịch sử trò chuyện (phân trang)

### 2.4 Chat Nhóm
- Toàn bộ tính năng của Chat 1-1, **cộng thêm**:
- Gửi file (tính vào quota lưu trữ nhóm)
- (Trưởng nhóm) Cấm chat 1 thành viên (mute) / gỡ mute
- (Trưởng nhóm) Xoá tin nhắn bất kỳ
- (Trưởng nhóm) Quản lý file: xem danh sách, xoá file để giải phóng quota
- (Trưởng nhóm) Xem dung lượng đang dùng, nạp tiền tăng hạn mức
- (Trưởng nhóm) Mở khoá + quy định lại thời gian lưu trữ khi nhóm bị khoá vì vượt hạn mức
- Banner cảnh báo hết hạn dung lượng: còn 3 ngày → 2 ngày → 1 ngày → 10 tiếng
- Tin nhắn của thành viên đã rời/bị xoá khỏi nhóm hiển thị ẩn danh ("người trong nhóm")

### 2.5 Khiếu nại
- Gửi tin nhắn khiếu nại qua kênh riêng (truy cập được kể cả khi tài khoản bị khoá)
- Xem lịch sử khiếu nại của chính mình
- Route/giao diện tách biệt khỏi chat thông thường

### 2.6 Gọi video / Cuộc họp (Media)
- Mở cuộc họp: trong nhóm chat, hoặc tự mở độc lập
- Mời tham gia: tạo link mời, hoặc mời trực tiếp bạn bè
- Tham gia qua link (chia sẻ nickname nếu Guest, nickname + email nếu đã đăng nhập)
- Màn hình chờ duyệt (waiting room) khi phòng yêu cầu duyệt thủ công
- **Chủ phòng họp:** duyệt/từ chối người vào phòng, đuổi người tham gia, kết thúc cuộc họp, cấp/thu hồi quyền riêng lẻ cho participant (chia sẻ màn hình / mini app / focus mode)
- **Mọi người trong phòng (không phân biệt vai trò):** bật/tắt cam-mic của chính mình, điều chỉnh âm lượng của TỪNG người khác theo ý mình (chỉ ảnh hưởng phía nghe của chính mình, xử lý cục bộ), tắt hiển thị camera của người khác theo ý mình (cục bộ, tiết kiệm băng thông phía mình xem)
- **Người dùng thường:** dùng các tính năng cần quyền (chia sẻ màn hình / mini app / focus mode) khi được Chủ phòng họp cấp riêng
- Tự động rời phòng khi phòng hết người (không cần thao tác)

### 2.7 Mini App — IPTV (ví dụ minh hoạ)
- (Chủ phòng họp, hoặc người được cấp quyền `mini_app`) Bắt đầu/mở mini app cho cả phòng
- **Sau khi mini app đã mở, mọi người trong phòng đều tự dùng được — không cần thêm quyền riêng:**
  - Thêm danh sách kênh (nhập link `.m3u8`) của riêng mình
  - Tạo nhóm kênh, thêm kênh vào nhóm
  - Chọn nhóm kênh → chọn kênh → phát trong mini web — **mỗi người có thể chọn kênh khác nhau**, vì kiến trúc là mỗi client tự fetch stream độc lập, không phải 1 kênh chung đồng bộ cho cả phòng
  - Chọn track âm thanh riêng nếu kênh có nhiều lựa chọn
  - Tự chỉnh âm lượng video của riêng mình
- *(Lưu ý: vì mỗi client tự tải riêng, có thể lệch vài giây giữa những người đang xem CÙNG 1 kênh — đánh đổi đã chấp nhận)*

### 2.8 Admin Page
- Xem danh sách toàn bộ người dùng + tìm kiếm
- Xem danh sách người dùng vi phạm spam
- Xem chi tiết vi phạm của 1 user
- Gỡ khoá tài khoản
- Xoá vĩnh viễn tài khoản
- Xem & phản hồi khiếu nại
- Xem dashboard tài nguyên hệ thống (CPU/RAM theo pod/node)
- Yêu cầu mở rộng (scale) 1 service
- Yêu cầu dựng thêm server LiveKit + TURN

---

## 3. Bản đồ gọi API

| Tính năng | Use Case | Service — Endpoint |
|---|---|---|
| Đăng nhập email/Google/Facebook/Guest | UC-01→04 | Identity — `POST /auth/login`, `/auth/oauth/{provider}`, `/auth/guest` |
| Đăng xuất | — | Identity — `POST /auth/logout` |
| Quên mật khẩu | UC-05 | Identity — `POST /auth/forgot-password`, `/auth/verify-otp`, `/auth/reset-password` |
| Đăng ký email/Google/Facebook | UC-06→08 | Identity — `POST /auth/register`, `/auth/oauth/{provider}` |
| Xem/đổi nickname | UC-04,07,08 | Identity — `GET /users/me`, `PATCH /users/me/nickname` |
| Tạo/sửa/xoá nhóm | UC-17→19 | WorkSpace — `POST/PATCH/DELETE /workspaces/{id}` |
| Xem thông tin & thành viên nhóm | UC-24 | WorkSpace — `GET /workspaces/{id}`, `/workspaces/{id}/members` |
| Thêm/xoá/phong hàm thành viên | UC-20→23 | WorkSpace — `/workspaces/{id}/members/*` |
| Tạo/lấy cuộc trò chuyện P2P | UC-25 | Chat — `POST /conversations/p2p` |
| Gửi/xem tin nhắn | UC-25,27 | Chat — `GET/POST /conversations/{id}/messages` |
| Xoá tin nhắn | UC-28 | Chat — `DELETE /conversations/{id}/messages/{messageId}` |
| Upload file/ảnh/video/voice | UC-25,27 | Chat — `POST /files/upload-url` |
| Quản lý file nhóm | UC-28 | Chat — `GET/DELETE /conversations/{id}/files/*` |
| Mute/gỡ mute thành viên | UC-28 | Chat — `POST/DELETE /conversations/{id}/mutes/*` |
| Xem/nạp/mở khoá dung lượng | UC-29 | Chat — `/conversations/{id}/storage*` |
| Gửi/xem khiếu nại | UC-09,13,30 | Chat — `GET/POST /complaints/messages` |
| Mở cuộc họp | UC-31 | Media — `POST /meetings` |
| Mời tham gia | UC-32 | Media — `POST /meetings/{id}/invites` |
| Xem trước / tham gia qua link | UC-33 | Media — `GET/POST /meetings/join/{token}` |
| Duyệt phòng chờ | UC-33 | Media — `/meetings/{id}/waiting-room/*` |
| Đuổi người, kết thúc họp | UC-34 | Media — `/meetings/{id}/participants/{id}/kick`, `/meetings/{id}/end` |
| Cấp/thu hồi quyền participant | UC-35 | Media — `/meetings/{id}/participants/{id}/permissions` |
| Bật/tắt cam-mic, chỉnh âm lượng/ẩn camera người khác — **áp dụng cho mọi người trong phòng** | UC-34 | **Không qua Media Service** — gọi thẳng LiveKit JS SDK, xử lý hoàn toàn cục bộ trên máy từng người |
| Mini App IPTV — quản lý kênh | UC-37 | Media — `/miniapps/iptv/*` |
| Mini App IPTV — lấy stream riêng | UC-37 | Media — `GET /meetings/{id}/mini-app/iptv/stream-url` |
| Admin: danh sách user, vi phạm, khoá/gỡ khoá | UC-10→12 | Admin — `/admin/users*`, `/admin/spam-violations` |
| Admin: xử lý khiếu nại | UC-13 | Admin — `/admin/complaints/*` |
| Admin: giám sát & scale | UC-14→16 | Admin — `/admin/system/*` |
| **Tìm kiếm tin nhắn** | *(chưa có UC/API)* | **Chưa có endpoint — xem mục 5** |
| **Sửa / thu hồi tin nhắn** | *(chưa có UC/API)* | **Chưa có endpoint — xem mục 5** |

---

## 4. Danh sách màn hình cần xây

**Đăng nhập/Đăng ký**
- [ ] Màn hình đăng nhập (email + Google/Facebook + lối vào Guest)
- [ ] Màn hình nhập nickname (Guest, và sau đăng ký/OAuth lần đầu)
- [ ] Màn hình đăng ký
- [ ] Màn hình quên mật khẩu (email → OTP → mật khẩu mới)
- [ ] Màn hình tài khoản bị khoá → điều hướng Khiếu nại
- [ ] Màn hình thiết lập mã PIN 6 số cho E2EE (lần đầu bật mã hoá)
- [ ] Màn hình nhập PIN khôi phục khoá (khi đăng nhập trên thiết bị mới)

**Workspace**
- [ ] Danh sách nhóm của tôi
- [ ] Tạo nhóm mới
- [ ] Cài đặt nhóm (avatar, tên, xoá nhóm — có dialog xác nhận rõ ràng)
- [ ] Danh sách thành viên + quản lý vai trò

**Chat**
- [ ] Danh sách cuộc trò chuyện (1-1 + nhóm)
- [ ] Khung chat (gửi text/ảnh/video/file/voice/vote)
- [ ] Quản trị phiên chat (chỉ hiện với Trưởng nhóm: mute, xoá tin nhắn/file)
- [ ] Màn hình dung lượng lưu trữ nhóm + banner cảnh báo hết hạn
- [ ] Khung chat Khiếu nại (route riêng)

**Media**
- [ ] Màn hình mở cuộc họp
- [ ] Màn hình mời (link / bạn bè)
- [ ] Màn hình chờ duyệt vào phòng
- [ ] Giao diện phòng họp (video grid + thanh điều khiển)
- [ ] Mini App IPTV (thêm kênh, chọn kênh, player)

**Admin Page**
- [ ] Danh sách người dùng + tìm kiếm
- [ ] Danh sách vi phạm spam
- [ ] Xử lý khiếu nại
- [ ] Dashboard tài nguyên hệ thống
- [ ] Yêu cầu scale service / dựng thêm LiveKit

---

## 5. Ghi chú / Điểm mở

- **Khôi phục khoá khi đổi thiết bị: dùng mã PIN 6 số do user tự đặt và ghi nhớ** (giống cơ chế của Messenger) — PIN dùng để mã hoá/khôi phục private key khi đăng nhập trên thiết bị mới. Cần thêm màn hình thiết lập PIN (lúc bật E2EE lần đầu) và màn hình nhập PIN để khôi phục (khi đăng nhập thiết bị mới) — xem mục 4.

- **"Sửa và thu hồi tin nhắn"** — có trong sơ đồ tính năng gốc (giai đoạn đầu thiết kế) nhưng KHÔNG xuất hiện ở bất kỳ use case hay API nào sau đó. Hiện tại Chat Service chỉ hỗ trợ "Xoá tin nhắn" (quyền Trưởng nhóm, UC-28) — không có quyền cho chính người gửi tự sửa/thu hồi tin nhắn của mình. Nếu đây vẫn là tính năng cần có, cần bổ sung: use case mới, endpoint `PATCH /conversations/{id}/messages/{messageId}` (sửa) và có thể tái dùng cơ chế soft-delete hiện có cho "thu hồi" (thêm điều kiện: người gọi phải là chính sender, có thể giới hạn khung thời gian được thu hồi).

- **"Tìm kiếm tin nhắn"** — cũng có trong sơ đồ tính năng gốc, và tầng kiến trúc (Search Chat Service) đã thiết kế kỹ cơ chế routing dữ liệu (Redis cho <10.000 tin & <10 ngày, Postgres cho phần còn lại) — nhưng chưa từng có endpoint REST cụ thể nào được viết ra trong `chat-service-api.yaml`. Cần bổ sung endpoint dạng `GET /conversations/{id}/messages/search?q=...` (hoặc tương đương) trước khi Frontend có gì để gọi cho tính năng này.

- **Trưởng nhóm rời nhóm = xoá cả nhóm** (quyết định đã chốt ở phần thiết kế CSDL) — đây là hành động phá huỷ dữ liệu lớn nhất trong toàn hệ thống mà 1 cú bấm nhầm có thể gây ra. Bắt buộc phải có dialog xác nhận 2 bước hoặc yêu cầu gõ lại tên nhóm để xác nhận, không chỉ 1 nút "Đồng ý" đơn giản.

---

## 6. Tiến độ triển khai

- [ ] Thiết lập Frontend project (framework, routing, state management)
- [ ] Lớp gọi API dùng chung (interceptor tự gắn JWT, tự xử lý sliding expiration)
- [ ] Tích hợp LiveKit JS Client SDK
- [ ] WebSocket client (Signal IR) cho realtime chat/presence
- [ ] Tích hợp E2EE phía Frontend (sinh cặp khoá client-side, lưu private key an toàn trên thiết bị, lấy public key người nhận, mã hoá/giải mã) — cơ chế backend đã có sẵn
- [ ] Luồng thiết lập & khôi phục PIN 6 số cho E2EE (thiết lập lần đầu + khôi phục trên thiết bị mới)
- [ ] Toàn bộ màn hình ở mục 4
- [ ] Admin Page — project/route tách biệt
- [ ] Xác nhận với team: có cần bổ sung "Tìm kiếm tin nhắn" và "Sửa/thu hồi tin nhắn" vào backend trước khi Frontend cần tới không (mục 5)
