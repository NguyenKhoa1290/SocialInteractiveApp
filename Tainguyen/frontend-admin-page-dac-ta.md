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
| Mời bạn bè vào cuộc họp | UC-32 | Media — `POST /meetings/{id}/invites` (`type=direct`) |
| **Thông báo** (tab riêng + huy hiệu chưa đọc) | *(roadmap mục 1, 8.1)* | Identity — `/notifications*` + WebSocket `/hubs/notifications` |
| **Tìm kiếm tin nhắn** | *(bổ sung, xem mục 5)* | Chat — `GET /conversations/{id}/messages/search` |
| **Sửa tin nhắn** | *(bổ sung, xem mục 5)* | Chat — `PATCH /conversations/{id}/messages/{messageId}` |
| **Thu hồi tin nhắn** | *(bổ sung, xem mục 5)* | Chat — `POST /conversations/{id}/messages/{messageId}/recall` |

---

## 4. Danh sách màn hình cần xây

**Đăng nhập/Đăng ký**
- [x] Màn hình đăng nhập (email + Google/Facebook + lối vào Guest)
- [x] Màn hình nhập nickname (Guest, và sau đăng ký/OAuth lần đầu)
- [x] Màn hình đăng ký
- [x] Màn hình quên mật khẩu (email → OTP → mật khẩu mới)
- [x] Màn hình tài khoản bị khoá → điều hướng Khiếu nại
- [x] Màn hình thiết lập mã PIN 6 số cho E2EE (lần đầu bật mã hoá)
- [x] Màn hình nhập PIN khôi phục khoá (khi đăng nhập trên thiết bị mới)

**Workspace**
- [x] Danh sách nhóm của tôi
- [x] Tạo nhóm mới
- [x] Cài đặt nhóm (avatar, tên, xoá nhóm — có dialog xác nhận rõ ràng)
- [x] Danh sách thành viên + quản lý vai trò

**Chat**
- [x] Danh sách cuộc trò chuyện (1-1 + nhóm)
- [x] Khung chat (gửi text/ảnh/video/file/voice/vote)
- [x] Quản trị phiên chat (chỉ hiện với Trưởng nhóm: mute, xoá tin nhắn/file)
- [x] Màn hình dung lượng lưu trữ nhóm + banner cảnh báo hết hạn
- [x] Khung chat Khiếu nại (route riêng)

**Thông báo**
- [x] Tab Thông báo ở thanh điều hướng, kèm huy hiệu số chưa đọc hiện ở mọi màn hình
- [x] Nhận thông báo realtime qua WebSocket tới Identity Service (không phải service sinh ra sự kiện)
- [x] Bấm vào thông báo là nhảy tới đúng chỗ (phòng chat, trang tham gia họp, trang khiếu nại)
- [x] Đánh dấu đã đọc từng cái / tất cả, xoá thông báo
- [x] **Popup** cho thông báo có tính khẩn (mở họp, mời họp, khoá tài khoản) — nổi ở góc màn hình
      kèm nút "Gia nhập", tự tắt sau 15 giây, xếp chồng tối đa 3 cái

**Media**
- [x] Màn hình mở cuộc họp
- [x] Màn hình mời (link / bạn bè) — cả hai đường: nút "Tạo link mời (24 giờ)" (ai bấm link cũng
      phải qua Phòng chờ) và danh sách bạn bè có nút "Mời" (lời mời khoá đúng 1 người, vào thẳng
      không cần duyệt). Bạn được mời nhận link ngay trong khung chat 1-1 — xem mục 5.
- [x] Màn hình chờ duyệt vào phòng
- [x] Giao diện phòng họp (video grid + thanh điều khiển)
- [x] Mini App IPTV (thêm kênh, chọn kênh, player)
- [x] **Đổi nguồn camera / micro / loa ngay trong cuộc họp** — *không có trong đặc tả gốc*. Đã tìm cả
      `Drawing2.pdf` (trích 22.345 ký tự, có cả nhãn trong sơ đồ) lẫn `usecase-media-service.docx`:
      không chỗ nào nhắc tới chọn thiết bị phần cứng. Câu *"chọn kênh âm thanh riêng nếu có"* trong
      UC-37 là **audio track của luồng IPTV**, đã làm ở `IptvPlayer.tsx` — việc khác. Bổ sung vì
      laptop cắm webcam rời hay cắm tai nghe giữa buổi là chuyện thường ngày.

**Admin Page** — route `/admin/*`, vào bằng link "Quản trị" ở header (chỉ hiện với tài khoản có
claim `role=admin`)
- [x] Danh sách người dùng + tìm kiếm (phân trang, chi tiết, gỡ khoá, xoá vĩnh viễn)
- [x] Danh sách vi phạm spam
- [x] Xử lý khiếu nại (hội thoại + gửi phản hồi)
- [x] Duyệt yêu cầu nạp dung lượng nhóm *(nợ từ F4, không có trong danh sách gốc)*
- [x] Dashboard tài nguyên hệ thống (CPU/RAM theo pod/node)
- [x] Yêu cầu scale service
- [~] **Yêu cầu dựng thêm LiveKit — CỐ Ý KHÔNG LÀM.** Sau khi chốt dùng LiveKit Cloud managed
      (`infra/HUONG-DAN-DEPLOY.md` mục 6.0), Cloud tự lo phần mở rộng nên nút này không còn việc để
      làm. Endpoint `POST /admin/system/livekit/expand` vốn cũng chỉ ghi 1 dòng log rồi trả 202 —
      dựng nút cho nó là tạo ra một nút giả vờ có tác dụng. Endpoint vẫn còn, muốn hiện lại thì
      thêm vào `AdminSystemPage.tsx`.

---

## 5. Ghi chú / Điểm mở

- **Khôi phục khoá khi đổi thiết bị: dùng mã PIN 6 số do user tự đặt và ghi nhớ** (giống cơ chế của Messenger) — **ĐÃ LÀM.** `components/E2eeGate.tsx` chặn phần soạn tin nhắn Text cho tới khi có private key: lần đầu hiện màn thiết lập PIN (sinh cặp khoá X25519 thật, mã hoá private key bằng khoá dẫn xuất từ PIN qua PBKDF2 rồi đẩy vault ciphertext lên server), các lần sau hiện màn nhập PIN để mở khoá. Server chỉ thấy ciphertext + public key. Xem `lib/crypto/vault.ts`.

- **Nhập sai PIN thì client biết ngay và chắc chắn.** Vault dùng AES-256-GCM, có thẻ xác thực 128
  bit: PIN sai → khoá dẫn xuất sai → thẻ không khớp → `crypto.subtle.decrypt` ném lỗi. Nó **không**
  trả về dữ liệu rác — điểm này mới là quan trọng. Với AES-CBC hay stream cipher, PIN sai sẽ lặng lẽ
  cho ra 32 byte ngẫu nhiên, client tưởng đó là private key, đăng ký một public key rác lên server,
  rồi mọi tin nhắn hỏng theo cách không ai truy ra được. Xác suất PIN sai mà lọt: 2⁻¹²⁸.

- **Quên PIN thì có đường đặt lại** (`E2eeGate` mode `reset`). Khoá cũ chỉ tồn tại dưới dạng đã mã
  hoá bằng chính cái PIN đã quên, nên không có cách nào lấy lại — đặt lại nghĩa là sinh **cặp khoá
  hoàn toàn mới**, và toàn bộ tin nhắn Text cũ vĩnh viễn không đọc lại được. Vì thế màn hình bắt tick
  xác nhận trước khi cho bấm. File/ảnh/video và tin nhắn trong cuộc họp không bị ảnh hưởng (không
  mã hoá E2EE).

  Trước đây **không có lối thoát nào**: đã có vault thì màn nhập PIN là cửa duy nhất, quên PIN nghĩa
  là không bao giờ gửi được tin nhắn Text nữa ở bất kỳ cuộc trò chuyện nào.

- **Brute-force PIN 6 số: chấp nhận, giống Messenger.** Vault tải nguyên về máy rồi thử PIN hoàn toàn
  phía client — không đếm số lần sai, không khoá tạm. PBKDF2 100.000 vòng chỉ làm chậm chứ không cứu
  được không gian một triệu khả năng. Signal/WhatsApp nhốt bộ đếm trong HSM/enclave để vault không bao
  giờ tải về được; hệ thống này không có thứ đó. Đây là **đánh đổi đã cân nhắc và chấp nhận**, không
  phải thiếu sót.

- **"Sửa và thu hồi tin nhắn"** — có trong sơ đồ tính năng gốc nhưng không xuất hiện ở use case/API nào sau đó. **ĐÃ BỔ SUNG.** `PATCH /conversations/{id}/messages/{messageId}` để sửa (chỉ sender, chỉ Type=Text, trong 15 phút kể từ lúc gửi; client tự mã hoá lại với nonce mới, tái dùng khoá phiên cũ nên không phải gửi lại `recipientKeys`) và `POST .../recall` để thu hồi (dùng lại soft-delete sẵn có, thêm điều kiện phải là chính sender và cũng trong 15 phút). Khác hẳn "Xoá tin nhắn" của Trưởng nhóm ở UC-28: quyền đó không giới hạn thời gian và áp dụng cho mọi tin trong nhóm. Sau khi sửa, Chat Service phát `MessageEdited` qua SignalR để mọi người trong phòng thấy ngay.

- **"Tìm kiếm tin nhắn"** — cũng có trong sơ đồ tính năng gốc nhưng chưa từng có endpoint. **ĐÃ BỔ SUNG:** `GET /conversations/{id}/messages/search`. Vì tin Text luôn E2EE nên server không thể full-text search được — dùng **blind index**: client tự băm từ khoá bằng search-key riêng (HMAC, xem `lib/crypto/searchTokens.ts`) trước khi mã hoá nội dung, server chỉ so khớp token == token và không thể suy ngược ra từ gốc. Các bộ lọc còn lại (`senderId`, `type`, `from`, `to`) chạy trên metadata không mã hoá nên dùng được độc lập.

- **Thông báo đi qua Identity Service, không đi tắt.** Tài liệu thiết kế đặt Identity làm đầu mối
  notification của toàn hệ thống (roadmap mục 1: *"Identity Service — đăng nhập/đăng ký, quản lý JWT,
  notification"*, và bảng Publisher → Consumer mục 8.1). Đường đi đầy đủ:
  **service phát sự kiện → RabbitMQ → Identity Service (lưu + đẩy) → WebSocket → tab Thông báo**.
  Bốn hàng đợi trước đây publish mà không ai consume nay đều có người nhận:
  `identity.chat-message-notification`, `identity.storage-warning`, `workspace.member-notifications`,
  `media.meeting-invite`. Cộng thêm `identity.account-locked` cũng sinh thông báo.

- **Mở họp trong nhóm báo theo hai đường, cho hai nhóm người khác nhau — không trùng:**
  *tin nhắn hệ thống* trong khung chat cho người **đang mở** phòng chat đó (họ thấy nó hiện ra giữa
  khung chat, kèm thẻ "Cuộc hop đang diễn ra"), và *thông báo* qua Identity cho người đang ở màn hình
  khác hoặc đang offline. Chat Service trả về danh sách người nhận **đã loại sẵn** nhóm đầu
  (`GET /internal/conversations/{id}/notify-recipients`), nên không ai bị báo hai lần.

  Trước đây hàng đợi `media.meeting-created` từng bị bỏ với lý do *"nhóm đã có tin nhắn hệ thống rồi"*.
  Lý do đó **sai**: tin nhắn trong nhóm chỉ tới được người đang mở nhóm đó — ai đang ở màn hình khác
  thì không biết gì cả, và danh sách cuộc trò chuyện cũng không có dấu hiệu chưa đọc nào.

- **Người đang mở chính phòng chat đó thì không nhận thông báo tin nhắn mới** — họ đã thấy tin nhắn
  hiện ra trước mắt qua SignalR rồi. Không lọc bước này thì một nhóm đông người đang trò chuyện sẽ
  sinh ra một thông báo cho *từng* thành viên trên *mỗi* tin nhắn.

- **UC-32 "chỉ mời được bạn bè" nay đã thực thi đúng.** Lúc viết Media Service, hệ thống chưa có
  tính năng kết bạn nên ràng buộc này bị hạ xuống thành "invitedUserId phải là user có thật".
  Identity Service về sau đã có bảng `friendships`, nên Media Service giờ hỏi sang
  `GET /internal/users/{id}/friends/{otherId}` và từ chối 403 `not_friends` nếu hai người chưa kết bạn.

- **Trưởng nhóm rời nhóm = xoá cả nhóm** (quyết định đã chốt ở phần thiết kế CSDL) — đây là hành động phá huỷ dữ liệu lớn nhất trong toàn hệ thống mà 1 cú bấm nhầm có thể gây ra. Bắt buộc phải có dialog xác nhận 2 bước hoặc yêu cầu gõ lại tên nhóm để xác nhận, không chỉ 1 nút "Đồng ý" đơn giản.

---

## 6. Tiến độ triển khai

- [x] Thiết lập Frontend project (framework, routing, state management)
- [x] Lớp gọi API dùng chung (interceptor tự gắn JWT, tự xử lý sliding expiration)
- [x] Tích hợp LiveKit JS Client SDK
- [x] WebSocket client (Signal IR) cho realtime chat/presence
- [x] Tích hợp E2EE phía Frontend (sinh cặp khoá client-side, lưu private key an toàn trên thiết bị, lấy public key người nhận, mã hoá/giải mã) — cơ chế backend đã có sẵn
- [x] Luồng thiết lập & khôi phục PIN 6 số cho E2EE (thiết lập lần đầu + khôi phục trên thiết bị mới)
- [x] Toàn bộ màn hình ở mục 4
- [x] Admin Page — project/route tách biệt
- [x] Xác nhận với team: có cần bổ sung "Tìm kiếm tin nhắn" và "Sửa/thu hồi tin nhắn" vào backend không (mục 5) — **có**, cả ba đã làm xong cả backend lẫn giao diện.
