# NHẬT KÝ: ĐỔI TÊN MIỀN VÀ CẢI TIẾN CHAT / PHÒNG HỌP

**Đợt làm 02–05/09/2026** — Frontend (React), Media/Workspace/Identity Service
(.NET), hạ tầng Cloudflare + k3s

Tiếp nối [nhật ký Mini App IPTV và giao diện phòng họp](nhat-ky-iptv-va-giao-dien-phong-hop.md).
Tài liệu này ghi lại những gì đã đổi, **vì sao** đổi, và số đo thu được trên hệ
thống thật. Từ đợt này hệ thống chạy ở **`callimeet.com`** (trước là
`cachephoarong.click`).

Mục 1–9 là chuyện giao diện và tên miền; **mục 10–12 đi vào phần nghiệp vụ**:
ai cầm quyền trong một cuộc họp, ai được mở nhóm, và xác thực email khi đăng ký.
Ba mục đó động tới cả CSDL nên có kèm lệnh đổi lược đồ trong
[HUONG-DAN-DEPLOY.md](../Tainguyen/infra/HUONG-DAN-DEPLOY.md).

Quy ước đọc giữ như tài liệu cũ: mọi số đo lấy từ hệ thống thật qua Chrome
headless, không ước lượng từ ảnh chụp.

> **Không thuộc đợt này.** Phần *nhập khoá / giải mã nội dung DRM* trong lịch sử
> commit là do chủ dự án tự làm. Lý do mình không làm phần đó vẫn giữ nguyên ở
> mục 7 của tài liệu cũ.

---

## Mục lục

1. [Đổi tên miền sang callimeet.com](#1-đổi-tên-miền-sang-callimeetcom)
2. [Popup xem ảnh thay cho link tải về](#2-popup-xem-ảnh-thay-cho-link-tải-về)
3. [Lưới media trong panel thông tin](#3-lưới-media-trong-panel-thông-tin)
4. [Gộp nút gửi media, tự nhận diện loại](#4-gộp-nút-gửi-media-tự-nhận-diện-loại)
5. [Trình phát file âm thanh trong tin nhắn](#5-trình-phát-file-âm-thanh-trong-tin-nhắn)
6. [Chấm đỏ tin mới và đưa người gửi lên đầu](#6-chấm-đỏ-tin-mới-và-đưa-người-gửi-lên-đầu)
7. [Phòng họp: người đang nói lên đầu và sáng viền](#7-phòng-họp-người-đang-nói-lên-đầu-và-sáng-viền)
8. [Phát file âm thanh trực tiếp trong IPTV](#8-phát-file-âm-thanh-trực-tiếp-trong-iptv)
9. [Sửa vặt](#9-sửa-vặt)
10. [Phòng vô chủ: phó phòng và chuyển quyền](#10-phòng-vô-chủ-phó-phòng-và-chuyển-quyền)
    - [10.1. Phó phòng - nói trước ai sẽ thay mình](#101-phó-phòng---nói-trước-ai-sẽ-thay-mình)
    - [10.2. Chủ phòng thật quay lại thì đòi lại quyền](#102-chủ-phòng-thật-quay-lại-thì-đòi-lại-quyền)
    - [10.3. Bỏ kế vị ngẫu nhiên - phòng được phép vô chủ](#103-bỏ-kế-vị-ngẫu-nhiên---phòng-được-phép-vô-chủ)
11. [Khách không tạo được nhóm](#11-khách-không-tạo-được-nhóm)
12. [Xác thực email khi đăng ký](#12-xác-thực-email-khi-đăng-ký)
13. [Vá lỗ hổng Microsoft.OpenApi](#13-vá-lỗ-hổng-microsoftopenapi)
14. [Nhóm: lối vào quản trị thành viên](#14-nhóm-lối-vào-quản-trị-thành-viên)
    - [14.1. Dọn đường phụ trong Cài đặt](#141-dọn-đường-phụ-trong-cài-đặt)
15. [Bẫy đã vấp](#15-bẫy-đã-vấp)
16. [Việc còn phải làm](#16-việc-còn-phải-làm)
17. [Ghi chú vận hành](#17-ghi-chú-vận-hành)

---

## 1. Đổi tên miền sang callimeet.com

**Vấn đề.** Chủ dự án muốn chuyển hẳn hệ thống từ `cachephoarong.click` sang
`callimeet.com` và **xoá tên miền cũ**, kèm token của một Cloudflare Tunnel mới.

**Khảo sát trước khi làm.** Ba phát hiện quyết định cách làm:

- Tunnel đang chạy là loại **locally-managed**: `e1f67fd0-…`, định tuyến nằm
  trong `/etc/cloudflared/config.yml` trên máy Ubuntu, kèm `cert.pem`.
- Token được đưa là của **một tunnel khác**, loại **remotely-managed** — định
  tuyến phải cấu hình trên dashboard Cloudflare, mà mình không có quyền vào.
- Nhưng **cùng một tài khoản** Cloudflare (`e443b204…`), và `callimeet.com` đã
  nằm sẵn trên Cloudflare.

Cài đè tunnel mới sẽ **giết luôn đường SSH** của chính mình (SSH đi qua
`ssh.cachephoarong.click` của tunnel cũ) trong khi định tuyến mới chưa có →
sập site, không rollback được. Nên đã chọn hướng an toàn: **giữ tunnel hiện
tại, thêm callimeet.com vào đó**. Token tunnel mới không dùng tới.

**Đã làm** (không downtime, theo hai pha):

*Pha 1 — dựng callimeet song song với cachephoarong:*

| Bước | Chi tiết |
|---|---|
| DNS | Tạo **12 CNAME proxied** (`callimeet.com` + `identity/workspace/chat/media/admin/files/dashboard/ssh/rdp/minio/rabbit`) trỏ `e1f67fd0-….cfargotunnel.com`, qua Cloudflare API |
| Tunnel | Thêm khối `callimeet.com` vào `config.yml`, **giữ nguyên** khối cũ → cả hai tên miền cùng chạy |
| k8s | `Cors__AllowedOrigins__0` → `https://callimeet.com`, thêm `__2` = cachephoarong (tạm), `Storage__Providers__home__Endpoint` → `https://files.callimeet.com` |
| Frontend | `PUBLIC_DOMAIN` trong `gen-manifests.py` và fallback trong `release.yml` → `callimeet.com`, build lại |

*Pha 2 — gỡ cachephoarong:*

Chuyển SSH sang `ssh.callimeet.com` trước, rồi mới: rút khối cachephoarong khỏi
`config.yml` → bỏ `Cors__AllowedOrigins__2` → xoá 12 bản ghi DNS cũ.

**Đo được.**

- `callimeet.com` → 200; đăng ký qua `identity.callimeet.com` → **201** kèm
  `access-control-allow-origin: https://callimeet.com`.
- Trong lúc chuyển tiếp: **cả hai** tên miền cùng trả 200 → không có phút nào
  gián đoạn.
- Sau khi gỡ: `cachephoarong.click` → 530, `chat.cachephoarong.click` → không
  phân giải; origin cachephoarong **không còn** được CORS chấp nhận.

---

## 2. Popup xem ảnh thay cho link tải về

**Vấn đề.** Bấm vào ảnh trong khung chat là **nhảy sang tab tải về** — mất chỗ
đang đọc, và muốn xem ảnh tiếp theo phải quay lại rồi bấm lại.

**Đã làm.** Thêm `components/ImageViewer.tsx` + `image-viewer.css`: lớp phủ nền
tối, ảnh giữ đúng tỉ lệ (`object-fit: contain`, tối đa 84vh), đóng bằng **nền /
Esc / nút X**, khoá cuộn nền khi mở, và **giữ nút "Tải về"** cho ai cần lưu.
Nhận cả ảnh lẫn video.

Gắn vào hai chỗ: ảnh trong luồng chat (`FileMessageContent`) và lưới media ở
panel thông tin (`ConversationInfo`). Thẻ `<a>` vẫn trỏ URL thật nên
**Ctrl/⌘/giữa chuột vẫn mở tab mới** như thói quen cũ — chỉ bấm thường mới vào
popup.

**Đo được.** 9/9 mục đạt: popup mở, ảnh thật (`naturalWidth > 0`), **URL trang
không đổi** (không điều hướng), có nút Tải về, Esc đóng, bấm nền đóng.

---

## 3. Lưới media trong panel thông tin

**Vấn đề.** Khung "Danh sách file media đã gửi" luôn vẽ **đủ 9 ô**: gửi 2 ảnh
thì còn 7 ô xám trống, mà gửi hơn 9 thì **không xem được ảnh thứ 10 trở đi**.
Thứ tự cũng lộn xộn.

**Đã làm.**

- Bỏ hẳn ô giữ chỗ; vẽ đúng số file thật có. Lưới `repeat(3, …)` tự thêm hàng
  nên gửi bao nhiêu hiện bấy nhiêu.
- Chưa có ảnh thì hiện một dòng chữ nhỏ, không phải 9 ô xám. Lúc đang tải thì
  không hiện gì (tránh nháy chữ "chưa có").
- **Ký URL cho tất cả file**, không chỉ 9 ô đầu — nhưng theo **từng đợt 6 cái**
  và đổ dần vào lưới, để một hội thoại nhiều ảnh không bắn hàng trăm request
  cùng lúc.
- **Sắp mới nhất lên đầu.** Nguyên nhân lộn xộn: endpoint
  `GET /conversations/{id}/files` **không có `OrderBy`** nên thứ tự do CSDL
  quyết định, không đảm bảo. Sắp ở client theo `uploadedAt` giảm dần.

**Đo được.** Gửi 5 ảnh theo thứ tự `anh-nhom-1…5`, lưới hiển thị đúng
`5, 4, 3, 2, 1`; số ô = số ảnh (`oTrong: 0`).

---

## 4. Gộp nút gửi media, tự nhận diện loại

**Vấn đề.** Composer có ba nút riêng (ghi âm / ảnh / video) — người dùng phải
tự biết file của mình thuộc loại nào rồi bấm đúng nút.

**Đã làm.** Gộp thành **một nút** với `accept="image/*,video/*,audio/*"`. Loại
tin nhắn suy ra từ chính tệp — `lib/mediaKind.ts`:

1. Ưu tiên MIME của trình duyệt (`image/` → ảnh, `video/` → video, `audio/` →
   voice).
2. MIME rỗng thì **dự phòng theo đuôi tên** — có máy không nhận `.mkv`,
   `.flac`, `.m4a`.
3. Không nhận dạng được thì **báo rõ**, không gửi bừa.

Giữ riêng nút **Tệp** (kẹp giấy, chỉ ở nhóm) vì chat 1-1 không nhận loại `file`.
Dùng chung cho cả chat lẫn **thảo luận trong cuộc họp**.

**Đo được.** Trong thảo luận cuộc họp: còn đúng 2 input (media gộp + Tệp), gửi
**PNG** → ra tin **ảnh**, gửi **WAV** qua **cùng** input đó → ra tin **âm
thanh**.

---

## 5. Trình phát file âm thanh trong tin nhắn

**Vấn đề.** File âm thanh trong tin nhắn dùng trình phát **mặc định của trình
duyệt** (`<audio controls>`), không theo thiết kế.

**Đã làm.** Dựng lại theo Figma **154:2 "Mẫu file âm thanh đang phát"**: nút
tròn teal `#85AEB0` play/pause icon trắng + tên file (cắt bằng dấu ba chấm khi
dài), thẻ nền `#F4F8F9` bo 16 viền `#293546`; dòng dưới là **thanh tua** —
`thời gian hiện tại | slider | tổng thời gian`. Thời gian định dạng `m:ss`
(`h:mm:ss` nếu dài hơn một tiếng); luồng không rõ độ dài thì hiện `--:--` và
khoá tua.

CSS để **file riêng** (`file-message.css`) chứ không nhét vào `workspace.css` —
xem mục 15.

**Đo được.** File 3 giây: không còn `<audio controls>` nào, màu đúng
(`rgb(133,174,176)` / `rgb(41,53,70)`), bấm nút phát thật (0 → 1.97s), bấm lại
tạm dừng, kéo slider → `currentTime` nhảy đúng **1.50s**.

---

## 6. Chấm đỏ tin mới và đưa người gửi lên đầu

**Vấn đề.** Có tin nhắn mới thì danh sách **đứng im** — không biết ai vừa nhắn,
không có dấu hiệu nào chưa đọc.

**Đã làm.** Thêm `store/chatUnreadStore.ts` giữ ba thứ: hội thoại **đang mở**,
tập hội thoại **chưa đọc**, và **mốc hoạt động** của từng hội thoại.

Nguồn tin real-time: **tận dụng thông báo `new_message` đã có sẵn** —
`AppShell` vốn đã nghe `notificationHub`, và thông báo đó backend **chỉ gửi cho
người nhận**. Nhờ vậy **không phải join từng group SignalR** của mọi hội thoại.
`conversationId` lấy từ `link` của thông báo (`/app/chat/{id}`).

- **Danh sách** sắp *mới nhất lên đầu* (cả chat cá nhân lẫn nhóm), **chấm đỏ
  góc trên avatar** khi chưa đọc.
- **Thanh điều hướng**: chấm đỏ đặt **đúng biểu tượng** — hội thoại 1-1 → icon
  **Chat**, nhóm → icon **Nhóm**. Store nhớ *loại* từng hội thoại (seed lúc
  `AppShell` mount và khi danh sách nạp) vì thông báo không nói loại.
- **Mở hội thoại** thì xoá chấm; tin tới trong lúc đang mở không bị đánh dấu
  chưa đọc. Khi chính mình gửi, hội thoại cũng lên đầu.

**Đo được.** Chat 1-1 (A có 2 bạn B, C): B gửi → B **vượt C lên đầu**, chấm đỏ
trên avatar B, chấm đỏ trên icon Chat, mở ra thì chấm biến mất. Nhóm: B gửi vào
nhóm Alpha → Alpha lên đầu, chấm đỏ avatar nhóm, chấm đỏ trên icon **Nhóm** và
**không** dính icon Chat.

---

## 7. Phòng họp: người đang nói lên đầu và sáng viền

**Vấn đề.** Ô người tham gia **đứng im** theo thứ tự vào phòng — đông người thì
người đang nói có thể nằm ở trang sau, không ai thấy.

**Đã làm.** Bám sự kiện `ActiveSpeakersChanged` của LiveKit (LiveKit đã tự gom
theo *tập người nói*, không bắn từng khung tiếng, nên không giật). Tách **hai**
trạng thái từ cùng sự kiện đó — đây là điểm mấu chốt:

| Trạng thái | Dùng để | Vòng đời |
|---|---|---|
| `lastSpokeRef` — mốc *vừa nói* | **sắp thứ tự** | **giữ lại** cả khi đã im, tới khi có người mới nói đẩy xuống |
| `dangNoiRef` — tập *đang nói* | **sáng viền** | **tắt ngay** khi ngừng nói |

Sắp ô: ai vừa nói gần nhất lên trước; người im lặng **giữ nguyên** thứ tự cũ
(sort ổn định bằng cách kèm chỉ số gốc); ô màn hình chia sẻ và IPTV luôn ở
cuối. Hai người nói cùng lúc thì **cả hai** lên đầu, người nói sau nhỉnh hơn —
giống các phần mềm họp hiện nay. Ở **chế độ ghim**, dải bên phải chính là các ô
lưới trừ người được ghim, nên người nói tự lên đầu dải.

Viền sáng dùng `box-shadow` inset (mint `#9CE8DB`) chứ **không** dùng `outline`,
vì viền ghim đã chiếm `outline` — hai hiệu ứng nhờ vậy **chồng được** lên nhau
thay vì đè nhau; thêm transition 140ms cho khỏi nhấp nháy. Ô màn hình chia sẻ
không sáng viền (không phải mặt người).

**Đo được.** Hai client thật, B bật mic: ô của B **lên đầu sau ~2.5s** và
**sáng viền**; ô của A (im) không sáng; B tắt mic → **viền tắt** nhưng B **vẫn
giữ vị trí đầu** — đúng nết của app họp.

---

## 8. Phát file âm thanh trực tiếp trong IPTV

**Đã làm.** `doanLoaiLuong` nhận thêm đuôi âm thanh (`.mp3 .aac .m4a .ogg .oga
.opus .wav .flac .weba .mp2 .mpa`) → loại `"audio"`, phát **native** bằng thẻ
`<video>`, không cần thư viện nào; watchdog tự nối lại vẫn giữ. Picker coi audio
là luồng đơn (không liệt kê chất lượng / track tiếng).

Vì luồng chỉ có tiếng nên khung chiếu không có hình — thay ô đen bằng thẻ theo
Figma 154:2 (nút tròn play/pause + tên kênh) trên nền sáng. Nền phải đặt ở
**chính lớp phủ** chứ không ở khung ngoài, vì thẻ `<video>` nền đen phủ kín
khung.

**Đo được.** 7/7: thẻ hiện đúng màu, ẩn thanh điều khiển native, tên kênh đúng,
**âm thanh chạy thật** (8.5 → 12.0s), nút tròn tạm dừng (đứng ở 12.03s) và phát
tiếp (12.03 → 15.05s).

---

## 9. Sửa vặt

- **Khung nhập thảo luận trong cuộc họp** giống chat app: ô nhập bỏ bề rộng cố
  định 361px, đổi sang `flex: 1` để **dài hết thanh**; bỏ căn giữa; hạ chiều
  cao bar 83 → 66. *Đo:* ô nhập chiếm **73%** bề rộng bar (478/650px), cao
  56px, gõ chữ không co lại.
- **Danh sách kênh Mini App tràn ngang.** `.channel-structure` là grid mà grid
  item mặc định `min-width: auto` → track nở vừa tên kênh dài nhất, ellipsis vô
  hiệu. Khoá cột về `minmax(0, 1fr)` + `min-width: 0`. Popup trong cuộc họp
  dùng lớp `.mpop-*` riêng nên **vẫn hiển thị đầy đủ** như cũ.
- **Gạch ngang dài → ngắn.** Đổi 39 dấu em-dash `—` thành `-` trong 23 file
  dưới `Frontend/src` (không có en-dash nào). Mũi tên `→` giữ nguyên.

---

## 10. Phòng vô chủ: phó phòng và chuyển quyền

**Vấn đề.** `meetings.host_id` được đặc tả là *"bất biến trong suốt phiên"* (mục 7.2 tài liệu kiến
trúc). Chủ phòng rời đi thì cột đó vẫn trỏ vào người đã đi, và **mọi thứ đi qua `RequireHostAsync`
chết theo**: duyệt phòng chờ, đuổi người, kết thúc cuộc họp, tắt mic tất cả, sửa cài đặt phòng, gỡ
kẹt người đang trình bày. Cuộc họp lại chỉ tự đóng khi **hết người** (trigger
`trg_close_meeting_if_empty`), nên một phòng vô chủ sống tiếp hàng giờ.

Nặng nhất là phòng chờ: đặc tả quy định người vào bằng **link luôn phải chờ duyệt** - chủ đi rồi thì
họ kẹt vĩnh viễn, không còn đường nào khác vào phòng.

Đối chiếu: với **nhóm** thì luật đã chốt từ lâu là "Trưởng nhóm rời = giải tán, không có nhóm vô
chủ". Với **phòng họp** thì không giải tán được - những người còn lại vẫn đang họp thật.

**Đã làm.** `MediaService/src/MediaService.Api/Services/HostSuccession.cs`: chủ rời mà phòng còn
người thì **người vào sớm nhất còn ở lại** lên làm chủ. *(Luật này sau đó đã bị bỏ - xem mục 10.3.
Bản cuối chỉ phó phòng mới được lên.)*

| Điểm | Vì sao |
|---|---|
| Chủ chỉ **mất kết nối** thì KHÔNG chuyển | chừng nào `ParticipantReconciler` chưa kết luận là họ đã đi (vắng qua hai lần quan sát cách nhau 60 giây) thì `left_at` vẫn NULL. F5 một cái không phải là nhường quyền |
| Hàng cũ của chủ cũ **giữ nguyên `role='host'`** | làm dấu vết "đã từng là chủ", để `POST /join` cho họ vào lại phòng tuỳ chỉnh - phòng đó chỉ vào được bằng link mà chính người mở thường không giữ. Vào lại với tư cách **người thường** |
| Đổi chủ bằng một câu `UPDATE ... WHERE host_id = <chủ cũ>` | `/leave` và vòng đối chiếu có thể cùng phát hiện một lúc; ràng buộc này khiến chỉ một bên đổi được, không bao giờ có hai người cùng tưởng mình là chủ |

Gọi từ **cả ba** đường mà chủ có thể biến mất: `POST /leave`, `kick` (chủ tự mời mình ra), và
`ParticipantReconciler` (**đóng tab - đường hay gặp nhất**, vì đóng tab thì không có `/leave` nào
cả). Hàm tự kiểm tra "chủ còn trong phòng không" nên gọi thừa là vô hại.

Frontend chỉ cần một chỗ: vòng poll 4 giây vốn đã đọc `hostId`, thêm so sánh với vòng trước để hiện
băng báo *"Chủ phòng cũ đã rời - bạn là chủ phòng mới"*. Không có nó thì người được trao tự nhiên
mọc thêm một loạt nút điều khiển mà không hiểu vì sao.

**Đo được trên hệ thống thật:**

- **API 19/19.** Chưa ai rời → chủ không đổi · người thường rời → cũng không đổi · chủ rời → quyền
  sang **B (tài khoản thật)** chứ không sang khách dù khách vào trước · chủ mới xem được phòng chờ
  (200, trước đó 403) và sửa được cài đặt phòng · khách vẫn 403 · danh sách người có **đúng một**
  nhãn "host" · chủ cũ quay lại được nhưng **không** đòi lại quyền (403) · khi chỉ còn mỗi khách
  thì khách mới lên làm chủ · người cuối rời thì cuộc họp vẫn kết thúc như cũ.
- **Trình duyệt 8/8.** Hai Chrome thật, LiveKit thật, "đóng tab" bằng cách **giết hẳn tiến trình**
  Chrome của chủ: quyền chuyển sang B sau **~109 giây**, nút "Kết thúc cho tất cả" mọc trên màn
  hình B, băng báo hiện đúng chữ, và **chủ mới kết thúc được cuộc họp** - đúng cái trước đây không
  ai làm nổi.

~109 giây là **đúng thiết kế** chứ không phải chậm: reconciler cố ý đòi vắng mặt qua hai lần quan
sát cách nhau 60 giây, để một lần F5 hay một cú nghẽn mạng không bị hiểu nhầm thành rời phòng. Đổi
lại, trong khoảng đó phòng vẫn tạm thời vô chủ - chấp nhận được so với việc đuổi nhầm quyền của một
người chỉ đang nối lại mạng.


### 10.1. Phó phòng - nói trước ai sẽ thay mình

Luật kế vị ở trên đã lấp được lỗ hổng, nhưng chọn người thay hoàn toàn **máy móc**: ai vào sớm
nhất thì người đó lên. Chủ phòng không có cách nào nói trước "người này thay tôi", và suốt cuộc
họp cũng chỉ đúng một người cầm trịch - chủ phòng bận trình bày thì không ai duyệt phòng chờ.

**Đã làm.** Nút **"Phong đồng chủ"** trên từng hàng người trong bảng Quản lý thành viên.

Đồng chủ là người **điều phối**, không phải chủ phòng thứ hai - làm được đúng **ba việc**: duyệt/từ
chối phòng chờ, tắt mic cả phòng, tắt camera cả phòng. Cộng với việc là **người kế vị thứ nhất**.

| Không làm được | Vì sao |
|---|---|
| Kết thúc cuộc họp | chừng nào chủ phòng còn đó thì chỉ họ đóng được phòng. Chủ phòng rời thật thì đồng chủ **thành chủ**, lúc đó bấm được - không cần đường tắt nào ở giữa |
| Cấm mic/cam/chia sẻ của ai | *tắt* khác *cấm*: tắt là một lần ai cũng bật lại được, cấm là thu quyền - thu quyền là việc của chủ phòng |
| Đuổi người, sửa cài đặt phòng, phong đồng chủ khác, dừng trình bày của người khác | đều là quyền của chủ phòng |
| Tự miễn trừ cài đặt chung của phòng | `allow_mic = false` thì đồng chủ cũng không bật được mic, y hệt mọi người |

Hai điều còn giữ nguyên từ trước: không ai đuổi được chủ phòng, và không ai thu được mic/cam của
chủ phòng.

**Kế vị**: đồng chủ đứng **trước** luật "người vào sớm nhất" *(và tới mục 10.3 thì thành người kế
vị duy nhất)*. Nhiều đồng chủ thì lấy người vào sớm nhất trong số họ - kể cả khách vào bằng link,
vì chính chủ phòng đã chọn đích danh, không việc gì để tiêu chí máy móc phủ quyết. Lên làm chủ thật
thì hàng `co_host` bị xoá, để giao diện không hiện một người vừa là chủ vừa là đồng chủ.

**Chỗ lưu: `meeting_permissions`, không phải `meeting_participants.role`.** Hàng participant sinh
mới mỗi lần vào phòng, nên để ở `role` thì đồng chủ rớt mạng vào lại là mất chức. Hàng permission
sống theo cả cuộc họp. Giá phải trả là một lần đổi lược đồ - xem mục 15.

Giao diện chỉ cần thêm một biến: vòng poll 4 giây vốn đã trả về `permissions` của từng người, nên
`co_host` tới nơi miễn phí. Người vừa được phong (hoặc vừa bị thu) được **báo thành lời** - không
thì họ chỉ thấy một loạt nút tự mọc ra rồi tự biến mất.

**Đo được trên hệ thống thật:**

- **API 20/20.** Trước khi phong thì 403 · phong xong thì đồng chủ xem được phòng chờ, tắt được mic
  và camera cả phòng · và **403 ở tất cả phần còn lại**: kết thúc cuộc họp, sửa cài đặt phòng, cấm
  mic, thu quyền, đuổi người, phong đồng chủ khác · cuộc họp vẫn `active` sau khi đồng chủ thử kết
  thúc · chính chủ phòng cũng không tự mời mình ra (403) · người thường vẫn 403 · **chủ rời thì đồng
  chủ lên, dù người kia vào phòng trước** · lên chủ thì hàng `co_host` biến mất và `role` thành
  `host` · chủ mới phong được đồng chủ tiếp · chủ cũ quay lại chỉ là người thường.
- **Trình duyệt 13/13.** Hai Chrome thật: nút "Phong đồng chủ" chỉ hiện với chủ phòng thật · bấm
  xong hàng đó ghi *"· Đồng chủ phòng"* và nút đổi thành "Thu quyền đồng chủ" · màn hình bên kia
  mọc **đúng hai nút** "Tắt tất cả mic" / "Tắt tất cả cam" kèm băng báo, **không** có "Kết thúc cho
  tất cả", **không** có "Cài đặt", và hàng người khác **không** có nút "Cấm…" lẫn "Đuổi" · thu
  quyền thì hai nút đó biến mất kèm báo.
- **Không phá phần cũ**: chạy lại nguyên bộ kế vị ở mục 10 - vẫn 19/19.

### 10.2. Chủ phòng thật quay lại thì đòi lại quyền

Bản đầu của mục 10 có một chỗ tôi chọn sai: chủ phòng rời đi, quyền chuyển cho người khác, rồi chủ
quay lại thì **vĩnh viễn** chỉ còn là người thường. Lý do tôi đưa ra lúc đó - "giật quyền giữa chừng
thì hai người thay nhau nắm quyền mà không ai bấm gì" - không đủ nặng so với cái vô lý thấy ngay:
người mở phòng quay lại phòng của chính mình mà phải xin phép người khác.

**Luật hiện tại.** Thêm cột `meetings.creator_id` (bất biến thật sự) vì `host_id` chạy qua chạy lại
nên không dùng làm "ai mới là chủ thật" được:

| Tình huống | Kết quả |
|---|---|
| Chủ rời, có phó phòng | Phó lên **giữ hộ** quyền, vẫn giữ nguyên hàng `co_host` |
| Chủ rời, không có phó | Một người bất kỳ còn ở lại lên giữ hộ (người vào sớm nhất, ưu tiên tài khoản thật). **Đã bỏ ở mục 10.3** - giờ phòng vô chủ |
| **Chủ thật quay lại** | `host_id` trở về họ **ngay trong chính lời gọi join** |
| Người giữ hộ là phó phòng | **Tự động trở lại làm phó** - không phải phong lại, vì hàng `co_host` chưa bao giờ bị xoá |
| Người giữ hộ là người thường | Mất sạch quyền, về `participant` |

Đó cũng là lý do bản này **không** xoá hàng `co_host` khi đưa phó lên làm chủ nữa (bản trước có
xoá, để giao diện không hiện một người hai vai). Chỗ hiển thị đã ưu tiên "Chủ phòng" trước "Phó
nhóm" nên không cần xoá dữ liệu để chữa một vấn đề hiển thị.

**Phòng chờ**: chủ thật và phó phòng **không phải xếp hàng**. Họ chính là người *duyệt* phòng chờ -
bắt họ chờ chính mình thì vô lý, và nếu chủ thật đang ở ngoài thì không còn ai duyệt cho họ. Phải
sửa **hai chỗ**: `POST /meetings/join/{token}` và phần **xem trước** `GET` của nó. Chỉ sửa một chỗ
thì người dùng đọc "phải chờ duyệt" rồi lại vào thẳng - tự mâu thuẫn với chính mình.

**Không ai đuổi được chủ thật**, kể cả lúc họ đang không giữ `host_id`: nếu không, người giữ hộ chỉ
việc đuổi chủ thật ra là khoá cửa luôn phòng của chính họ.

**Đo được:** API **19/19** cho luật mới (hai kịch bản: có phó / không phó), cộng chạy lại hai bộ cũ
đã cập nhật theo luật mới - kế vị **20/20**, phó phòng **22/22**. Trình duyệt **8/8**: chủ bấm "Rời
khỏi" → phó mọc nút "Kết thúc cho tất cả" kèm báo *"bạn là chủ phòng mới"*; chủ thật vào lại →
nút đó biến mất, báo đúng lý do *"… đã quay lại và nhận lại quyền chủ phòng"*, và **hai nút tắt
mic/cam của phó vẫn còn** - đúng nghĩa "trở lại làm phó" chứ không phải mất sạch.

Một lần trượt là **lỗi bài kiểm chứ không phải lỗi sản phẩm**: vòng lặp chờ có `moPopup` bật/tắt
popup mỗi nhịp, đọc trúng lúc nó đang đóng nên ra mảng rỗng, nhìn như phó bị mất quyền. Sửa cách
đọc (mở sẵn rồi mới đọc) thì 8/8.

**Tên gọi và dải nút.** Trên giao diện vai trò này gọi là **"Phó nhóm"**, nút phong/thu là *Phó
nhóm* / *Truất quyền*. Trong CSDL và API vẫn là `co_host` - đổi tên hiển thị thì không phải đụng
vào lược đồ.

Năm nút quản trị ở từng hàng (*Phó nhóm · Cấm mic · Cấm camera · Cấm chia sẻ · Mời ra*) giờ **chỉ
có biểu tượng**, màu trắng ngà (`--calli-surface-2`) trên nền teal. Khuôn nút giữ y như hồi còn
chữ - cùng chiều cao, cùng padding, vẫn là viên thuốc bo tròn: đây là "thay chữ bằng hình", không
phải vẽ lại nút. (Bản đầu bóp thành nút tròn 34px, đã sửa lại.) Chữ không mất: nó chuyển vào `title` + `aria-label`, nên rê
chuột vẫn đọc được và trình đọc màn hình vẫn dùng đúng. Nút ở **phòng chờ** (*Đuổi* / *Cho phép*)
giữ nguyên chữ - đó là một cặp quyết định, đọc chữ nhanh hơn đoán hình.

Một chi tiết chỉ lộ ra khi **chụp phóng to**: gạch chéo "cấm" và thân hình cùng là màu trắng, nên
chỗ nào gạch đè lên thân hình thì hai cái tan vào nhau - ở nút *Cấm chia sẻ* gạch gần như biến mất,
nút *Cấm camera* nhìn ra một cái đuôi thừa chứ không ra dấu cấm. Chữa bằng cách vẽ thêm một viền
màu nền quanh gạch (`--nen-nut` do chính nút đặt, `paint-order: stroke`). Số đo không bắt được lỗi
này: nút vẫn "có svg, màu trắng, đúng kích thước" - phải nhìn mới thấy.

**Một vòng sửa lại giữa chừng.** Bản đầu cho đồng chủ *mọi* quyền của chủ phòng (kể cả kết thúc
cuộc họp và cấm mic từng người) - đã chạy được 17/17 rồi mới siết lại theo yêu cầu. Ranh giới hiện
tại gọn hơn và cũng dễ giải thích hơn: **tắt** là việc của người điều phối, **cấm** là việc của chủ
phòng.

### 10.3. Bỏ kế vị ngẫu nhiên - phòng được phép vô chủ

Luật cũ có hai bậc: phó phòng trước, không có phó thì **người vào sớm nhất** còn ở lại lên giữ hộ.
Bậc thứ hai đã bỏ. Chủ rời mà không có phó phòng nào ở lại thì **phòng vô chủ, và đó là trạng thái
hợp lệ** chứ không phải sự cố.

Lý do bỏ, gọn trong một câu: **chọn ai làm chủ là quyết định thay mặt người khác, mà máy không có
căn cứ nào để chọn đúng.** "Người vào sớm nhất" chỉ là một con số trong bảng, nó không nói lên rằng
người đó đang được tin tưởng - hoàn toàn có thể là người bấm link sớm nhất rồi đi pha cà phê. Mà thứ
trao cho họ thì không nhỏ: đuổi người, duyệt phòng chờ, kết thúc cuộc họp cho tất cả. **Trao nhầm
thì không rút lại được**, còn không trao thì cùng lắm là mọi người phải chờ. Giữa một lỗi không sửa
được và một bất tiện sửa được, chọn cái sửa được.

Ai muốn phòng không bao giờ vô chủ thì đã có sẵn đường: **phong phó trước khi rời**. Đó đúng là mục
đích của nút Phó nhóm, và giờ nó là đường duy nhất - nên nó cũng dễ giải thích hơn hẳn.

**Cái giá phải trả, ghi thẳng ra chứ không giấu:**

| Mất gì khi phòng vô chủ | Nặng tới đâu |
|---|---|
| Không ai duyệt được phòng chờ | Nặng nhất. Người vào bằng **link** luôn phải chờ duyệt nên họ kẹt lại cho tới khi chủ thật (hoặc một phó) quay lại |
| Không ai đuổi được người, không ai tắt được mic/cam cả phòng | Bất tiện, không chặn cuộc họp |
| Không ai kết thúc được cuộc họp cho tất cả | Phòng vẫn **tự đóng khi hết người** (`trg_close_meeting_if_empty`), nên không có phòng nào sống mãi |

Chỗ duy nhất phải làm thêm là **nói cho người ta biết**. Trước đây chủ đổi thì cả phòng nhận một
dòng thông báo; giờ nếu không ai lên thay thì im lặng tuyệt đối - người trong phòng chờ không được
duyệt, ai bấm nút quản lý cũng ăn 403 mà không hiểu vì sao. Nên `MeetingRoomPage.tsx` phát hiện
trạng thái vô chủ (`host_id` không nằm trong danh sách người còn ở phòng) và báo thẳng ra màn hình,
kể cả khi vừa bước vào một phòng đang vô chủ - khác với thông báo đổi chủ, thông báo này lúc nào
cũng đáng biết.

**Đo trên hệ thống thật:** 32/32 qua API (hai kịch bản - không có phó thì phòng vô chủ và người
còn lại ăn 403 ở cả năm đường quản trị; có phó thì phó lên chủ, chủ thật về thì phó trở lại làm
phó), 10/10 trên hai Chrome thật. Bảng `meetings` sau bài kiểm cho `host_id = creator_id` ở cả hai
phòng - chủ thật đã đòi lại được quyền trong cả hai đường.

**Một lỗi thật chỉ bài kiểm trình duyệt mới bắt được.** Chủ thật quay lại một phòng đang vô chủ thì
`host_id` **không đổi** - nó vẫn trỏ về họ suốt thời gian vắng mặt. Nhánh "chủ phòng đổi giữa
chừng" vì thế im lặng, và cả phòng không biết là phòng đã có chủ trở lại: thông báo lúc mất chủ thì
có, lúc được chủ lại thì không. Đây là loại lỗi mà kiểm API không thấy được, vì API trả về hoàn toàn
đúng. Chữa bằng cách gom ba trạng thái vào **một** chỗ rẽ ba nhánh (`đổi chủ` / `vừa thành vô chủ` /
`vừa hết vô chủ`) thay vì hai khối `if` độc lập đè lên nhau.

**Dọn theo được một chỗ.** Bậc thứ hai là lý do duy nhất khiến `HostSuccession` cần `IdentityClient`
(để hỏi ai là khách, ai là tài khoản thật). Bỏ nó đi thì tham số đó thừa, kéo theo `ReconcileAsync`
cũng không cần nữa - cùng với đoạn chú thích dài giải thích vì sao một lớp singleton lại phải nhận
`IdentityClient` qua tham số thay vì constructor. Hai `endpoint` `/leave` và `kick` cũng bớt một thứ
phải tiêm vào.

---

## 11. Khách không tạo được nhóm

Đọc lại đặc tả gốc ([Drawing2.pdf](../Tainguyen/Drawing2.pdf), [usecase-workspace-service.docx](../Tainguyen/usecase-workspace-service.docx))
để trả lời câu hỏi "phân quyền trong nhóm nhắn tin thế nào" thì lộ ra một **điểm mở chưa ai chốt**:
UC-17 tự đặt câu hỏi *"Trưởng nhóm là Guest, bị xoá tự động sau 6 tháng thì nhóm ra sao?"* và bỏ ngỏ.
Code lúc đó đang chạy theo nhánh chấp nhận rủi ro - chỉ là không ai quyết định điều đó.

Rủi ro không nhỏ: Trưởng nhóm rời nhóm = **giải tán cả nhóm** (trigger
`cascade_delete_workspace_on_leader_leave`), nên một lần cron dọn tài khoản khách sẽ kéo theo cả
nhóm và toàn bộ lịch sử chat của những người khác - họ không làm gì sai và cũng không được báo trước.

**Đã chốt: khách không tạo được nhóm.** `POST /workspaces` trả 403 `guest_not_allowed`, đọc thẳng
claim `user_type` trong JWT chứ không gọi sang Identity - một câu hỏi mạng ở đường tạo nhóm chỉ để
biết một thứ đã nằm sẵn trong token. Khách **vẫn được thêm vào** nhóm làm Nhóm viên; chỉ chặn đúng
việc đứng ra mở nhóm.

Giao diện chặn ở cả ba đường: nút ở trang "Nhóm của tôi", nút ở danh sách hội thoại, và **chính
trang `/workspaces/new`** khi gõ thẳng địa chỉ - kèm lý do, chứ không để người dùng điền xong form
rồi mới ăn 403.

**Đo được:** API **7/7** (khách 403 đúng mã lỗi · tài khoản thật vẫn tạo được · khách vẫn được thêm
vào nhóm với vai trò `member` · khách đang ở trong nhóm cũng không mở được nhóm riêng). Trình duyệt
**6/6**: khách không thấy nút nào, gõ thẳng địa chỉ thì không có ô nhập và có giải thích; tài khoản
thật thì mọi thứ như cũ.

---

## 12. Xác thực email khi đăng ký

Đăng ký bằng email/mật khẩu giờ đi **hai bước**, và bước một **không ghi gì vào Postgres**: cả lần
đăng ký (email, nickname, **mật khẩu đã hash**, mã 6 số) nằm trong Redis 10 phút; `POST
/auth/register/verify` nhập đúng mã thì tài khoản mới thực sự sinh ra và trả token như cũ.

Chọn cách này thay vì "tạo trước rồi gắn cờ chưa xác thực" vì hai lẽ: bảng `users` không bao giờ
chứa tài khoản treo do người lạ gõ bừa địa chỉ mail của người khác, và email/nickname không bị giữ
chỗ bởi bản ghi không ai dùng. Đổi lại, mất mã giữa chừng thì phải đăng ký lại từ đầu.

Dùng lại đúng hạ tầng SMTP đang chạy cho "quên mật khẩu" (Gmail app password trong k8s secret), chỉ
tách tiêu đề/nội dung email riêng — hai email đến vào hai lúc khác hẳn nhau, dùng chung một dòng
tiêu đề thì người dùng không biết cái nào là cái mình vừa yêu cầu.

Ba lần chặn đi kèm: sai quá **5 lần** thì huỷ luôn lần đăng ký đó (mã 6 số chỉ có một triệu khả
năng); "Gửi lại mã" sớm nhất **60 giây** một lần và gửi **đúng mã cũ**; SMTP lỗi thì trả **502** và
xoá lần đăng ký đang chờ — trả 202 im lặng là để người dùng ngồi chờ một email không bao giờ tới.
Thêm kiểm địa chỉ mail bằng `MailAddress` — trước đây gõ bừa một chuỗi vẫn ra tài khoản thật.

**Đo được:** API **22/22** — mã đọc thẳng từ Redis qua SSH nên bài kiểm chạy tự động được, nhưng vẫn
là mã thật do chính service sinh ra và gửi đi. Bao gồm: chưa nhập mã thì CSDL **không** có tài khoản
nào · nhập sai vẫn không có · gửi lại quá sớm 429, chờ hết 60 giây thì 202 và **đúng mã cũ** · nhập
đúng thì 201 kèm token dùng được ngay và đăng nhập được bằng mật khẩu đã nhập ở bước 1 · sai 5 lần
thì huỷ, mã đúng cũ cũng thành vô dụng. Trình duyệt **9/10** (mục trượt là kỳ vọng của bài kiểm đã
cũ so với câu thông báo vừa sửa, lỗi vẫn hiện đúng).

**Một lỗi thật, và chỉ ảnh chụp mới bắt được.** Bài kiểm báo "nhập đúng mã mà vẫn ở /register";
nhìn ảnh thì thấy giao diện đã **quay ngược về form đăng ký** ngay từ lần gõ nhầm đầu tiên, và mã
vừa gõ nằm trong ô email. Nguyên nhân: tôi dò **chữ trong câu thông báo** để biết lần đăng ký còn
sống không, mà câu của lỗi nhập sai — *"Mã xác thực sai hoặc đã hết hạn"* — cũng chứa chữ "hết hạn".
Đã đổi sang đọc **mã lỗi** (`registration_expired` / `too_many_attempts` / …) và sửa luôn câu thông
báo thành *"Mã xác thực không đúng"*. Bài học cũ lặp lại: **đừng phân nhánh theo câu chữ dành cho
người đọc**.

---

## 13. Vá lỗ hổng Microsoft.OpenApi

Mỗi lần build service nào cũng thấy `NU1903: Microsoft.OpenApi 2.0.0 has a known high severity
vulnerability` ([GHSA-v5pm-xwqc-g5wc](https://github.com/advisories/GHSA-v5pm-xwqc-g5wc)) — sáu
service đều dính, vì gói này là **phụ thuộc gián tiếp** của `Microsoft.AspNetCore.OpenApi`.

Chỗ hay: không phải ghim tay gói con. Bản `10.0.10` ghim cứng `Microsoft.OpenApi` ở đúng `2.0.0`,
còn `10.0.11` đã nới thành `[2.7.5, 3.0.0)` — Microsoft đã tự vá bằng cách nâng ràng buộc. Nên chỉ
cần **nâng gói cha một nấc** ở sáu tệp `.csproj`, gói con tự lên `2.7.5`. Sau đó
`dotnet list package --vulnerable` báo sạch ở cả sáu service, và build không còn cảnh báo nào.

**Vì sao vẫn phải thử chạy dù chỉ là đổi số phiên bản.** `MapOpenApi()` bị chặn theo môi trường
(`if (app.Environment.IsDevelopment())`), nhưng `builder.Services.AddOpenApi()` thì **chạy ở mọi môi
trường** — kể cả production. Nên đã chạy thật WorkspaceService ở chế độ Development rồi gọi
`/openapi/v1.json` để ép nó dựng hẳn tài liệu: ra OpenAPI 3.1.1, 9 đường dẫn, 4 schema, đúng như
trước. Bằng chứng cuối cùng lấy từ chính container đang chạy:

```bash
k3s kubectl -n chat-app exec deploy/media --   sh -c 'grep -o "Microsoft.OpenApi/[0-9.]*" /app/*.deps.json | head -1'
# Microsoft.OpenApi/2.7.5
```

Cả sáu service đều trả `2.7.5`. Lần này grep được vì `.deps.json` là **tệp văn bản** — khác với bẫy
"đừng grep DLL" ở mục 15.

---

## 14. Nhóm: lối vào quản trị thành viên

Câu hỏi rất ngắn: *"phong nhóm phó như thế nào nhỉ?"* — và hoá ra câu trả lời đúng là **không làm
được từ chỗ bạn đang đứng**.

Bảng nhóm bên phải màn chat chỉ dựng đúng hai nút *Cấm chat* / *Xóa*, không hiện vai trò của ai,
và không có đường nào sang trang quản trị. Nút phong/truất Phó nhóm nằm ở
[WorkspaceMembersPage](../Frontend/src/pages/workspace/WorkspaceMembersPage.tsx) tại
`/workspaces/:id` — mà lối vào duy nhất tới đó là **Hồ sơ → "Quản lý nhóm"**, một đường mà chính mã
nguồn đã tự nhận là tạm ([settings.css](../Frontend/src/pages/settings.css)): *"KHÔNG có trong bản
thiết kế… để tạm ở đây làm đường phụ, xoá đi khi màn danh sách nhóm xong."*

Kết quả là có **hai màn danh sách nhóm song song**: cái trong chat mở thẳng cuộc trò chuyện, cái ở
`/workspaces` mới là chỗ quản trị — và người dùng đứng ở nơi hợp lý nhất để phong phó lại là nơi duy
nhất không làm được.

**Đã làm.** Nút *Thêm* trơ trọi thành nút ***Tùy chỉnh*** thả xuống hai mục: *Thêm thành viên* và
*Quản lý thành viên* (dẫn thẳng sang trang có nút phong/truất). Menu đóng khi bấm ra ngoài — nghe ở
**giai đoạn capture** để menu đóng *trước* khi cú bấm rơi vào thứ phía sau nó — hoặc khi bấm Esc.

**Một lỗi phân quyền lộ ra khi làm.** Nút *Thêm* cũ hiện theo `isLeader`, nhưng thêm thành viên là
quyền của **cả Phó nhóm** (UC-20), và server cũng cho — `WorkspaceEndpoints` chỉ chặn `role='member'`.
Tức là giao diện chặt hơn cả đặc tả lẫn API: Phó nhóm không thêm được ai dù được phép. Giờ đi theo
`canEditGroup` (Trưởng hoặc Phó), khớp với ba nơi.

| Vai | Thấy gì trong menu |
|---|---|
| Trưởng nhóm | Thêm thành viên · Quản lý thành viên |
| Phó nhóm | Thêm thành viên · Quản lý thành viên |
| Nhóm viên | Quản lý thành viên |

**Đo trên hệ thống thật:** 18/18 với ba trình duyệt thật (ba vai, ba kỳ vọng khác nhau), cộng 7/7
cho cả đường đi từ đầu đến cuối — từ màn chat bấm *Tùy chỉnh* → *Quản lý thành viên* → *Phong Phó
nhóm*, rồi **đối chiếu lại bằng API** chứ không tin một mình giao diện.

**Số đo bắt được thứ mắt bỏ qua.** Ảnh chụp nhìn "cũng được", nhưng đo ra chữ trong menu chỉ
**10,4px** và màu teal trên nền trắng chỉ cho **~3:1** — dưới chuẩn AA (4.5:1) cho chữ thường. Lý do
là tôi lấy `13px` từ `.cw-pill`: cỡ đó vừa cho một cái *chip*, không vừa cho chữ để **đọc**. Sửa
thành `15px` và dùng màu chữ của panel (`--calli-navy`).

### 14.1. Dọn đường phụ trong Cài đặt

Có lối vào đúng chỗ rồi thì đường phụ hết nhiệm vụ: đã **bỏ mục "Quản lý nhóm"** khỏi trang Cài đặt,
cùng CSS `.st-extra` đi kèm. Đúng việc mà chú thích trong `settings.css` dặn từ đầu — *"xoá đi khi
màn danh sách nhóm xong"*.

Bỏ một lối vào thì phải chắc **không cắt mất đường nào**, nên kiểm cả hai vế chứ không chỉ vế "đã
biến mất": trang Cài đặt không còn chữ ấy, không còn thẻ `<a>` nào trỏ `/workspaces`, khối
`.st-extra` biến khỏi DOM — **và** đường thay thế vẫn thông trọn vẹn: từ màn chat bấm *Tùy chỉnh* →
*Quản lý thành viên* → `/workspaces/95`, rồi bấm *← Về danh sách nhóm* → `/workspaces` hiện đúng
nhóm. 8/8 trên Chrome thật.

Người chưa có nhóm nào cũng không kẹt: nút *Tạo nhóm mới* trong danh sách chat trỏ thẳng
`/workspaces/new`, không đi qua `/workspaces`.

---

## 15. Bẫy đã vấp

Ghi lại để lần sau không mất công dò:

- **Hạn mức bộ nhớ của namespace vừa đủ chật để chặn việc cuộn phiên bản.**
  `quota-app` giới hạn `limits.memory` ở **2Gi**, mỗi pod xin 256Mi, mà cuộn
  kiểu mặc định (`maxSurge=1`) là **dựng pod mới trước rồi mới bỏ pod cũ** — nên
  lúc cao điểm cần 8 pod cùng lúc = 2048Mi, đúng bằng trần. Đợt nâng gói phải
  cuộn cả sáu service một lượt, năm cái đầu lọt, `admin` đi cuối thì kẹt:
  `Error creating: pods ... is forbidden: exceeded quota`. Triệu chứng dễ đọc
  nhầm — pod cũ vẫn `1/1 Running`, `RESTARTS 0`, dịch vụ vẫn trả 200, chỉ có
  `rollout status` báo `ProgressDeadlineExceeded`. Tức là **service chạy bình
  thường nhưng đang chạy mã cũ**. Nơi có câu trả lời thật là
  `describe rs <replicaset-moi>` chứ không phải `describe deploy` hay log pod.
  Gỡ tạm bằng cách xoá pod cũ để nhường 256Mi. Máy thật có 15Gi và chỉ dùng 29%,
  nên trần 2Gi là tự đặt chứ không phải giới hạn phần cứng — xem mục 16.2.

- **`cert.pem` của cloudflared gắn theo ZONE, không phải theo tài khoản.** Chạy
  `tunnel route dns <tunnel> identity.callimeet.com` bằng cert của
  cachephoarong lại tạo ra bản ghi
  `identity.callimeet.com.cachephoarong.click`. Muốn tạo DNS cho zone khác thì
  cần cert của zone đó, hoặc dùng API token.
- **`kubectl apply -f all.yaml` chết ở PVC.** `minio-data` là bất biến sau khi
  tạo, nên `kubectl diff/apply` dừng ở đó và không tới được các Deployment.
  Đổi env thì dùng `kubectl set env deploy/<tên>` cho gọn và không đụng PVC.
- **Ingress frontend không lọc host**, nên tên miền mới phục vụ được **ngay**
  mà không phải sửa ingress. Đổi lại, các API không đi qua ingress theo host —
  cloudflared map thẳng hostname → cổng localhost.
- **Endpoint ký URL bám `PUBLIC_DOMAIN`.** Đổi domain là URL presign đổi sang
  `files.<domain mới>` — phải có DNS + route cho host đó **trước**, không thì
  mọi link tải file gãy.
- **Restart cloudflared làm rớt SSH giữa chừng**, vì SSH đi qua chính tunnel
  đó. Phải dựng đường SSH trên tên miền mới **trước** khi gỡ tên miền cũ.
- **CSS của `FileMessageContent` phải để file riêng.** Các lớp `.fm-*` nằm
  trong `workspace.css`, mà trang thảo luận **không nạp** file đó — component
  dùng chung cho cả hai chỗ nên style phải đi kèm chính nó.
- **Tiếng giả của Chrome không đủ cho LiveKit.** `--use-fake-device-for-media-stream`
  cho ra beep ngắt quãng, không vượt ngưỡng phát hiện người nói → bài kiểm bập
  bênh (một lần trúng, hai lần trượt). Cách chữa: ghi đè `getUserMedia` trên
  trang, trả về stream từ `AudioContext` phát **tông sawtooth 200Hz liên tục**
  → kết quả tất định.
- **Cloudflare chặn `Python-urllib`** — bài kiểm viết bằng `urllib` ăn
  **403 "error code: 1010"** ở ngay bước đăng ký, dễ tưởng nhầm là API hỏng.
  Không phải app: Cloudflare loại User-Agent mặc định của urllib. Đặt một
  User-Agent trình duyệt là qua. Node `fetch` thì không dính.
- **Đừng kết luận "code sai" khi pod chưa kịp đổi image.** Lần chạy đầu của
  bài kiểm chuyển quyền chủ phòng trượt 8/19, nhưng chạy lại vài phút sau thì
  19/19 — frontend đã deploy xong trong khi pod `media` còn đang cuốn. Mốc
  chắc chắn là chờ *hành vi mới của chính service đó*, đừng lấy hash bundle
  frontend làm mốc cho một thay đổi ở backend.
- **Image mới ≠ pod mới đã nhận traffic.** Vấp lại đúng cái bẫy đã ghi ở trên, ở dạng tinh vi hơn:
  digest của `items[0]` đã là bản mới nên tôi tưởng xong, chạy kiểm thì vẫn ra hành vi cũ - vì pod
  mới chưa Ready, LB còn trỏ vào pod cũ. Cách chẩn đoán dứt điểm: `curl` **thẳng vào pod IP** từ
  trên máy chủ. Pod trả đúng 403 trong khi đường công khai trả 201 - lúc đó mới biết là chuyện triển
  khai chứ không phải chuyện code, khỏi phải đi sửa nhầm.
- **Đừng dùng `grep` chuỗi trên file `.dll` để đoán xem code mới đã vào image chưa.** Chuỗi trong
  .NET nằm ở dạng UTF-16 trong metadata, `grep` ASCII không khớp - tôi thử với một chuỗi CHẮC CHẮN
  có trong bản cũ cũng ra 0, nên đây là phép thử vô giá trị, suýt kết luận sai.
- **Đừng phân nhánh theo câu chữ dành cho người đọc.** Trang đăng ký dò chữ trong câu thông báo để
  biết lần đăng ký còn sống hay không; câu của lỗi *nhập sai mã* lại là "Mã xác thực sai hoặc **đã
  hết hạn**", nên gõ nhầm một lần là bị đá ngược về form. Câu chữ đổi lúc nào cũng được, **mã lỗi**
  thì không — phân nhánh theo `error` code. Cũng nên tránh viết một câu ôm hai tình huống như vậy.
- **Trang `/register` là LỚP PHỦ trên landing page.** Trong DOM còn nguyên ô "Tên người dùng" và
  form vào-bằng-khách của landing, nên `document.querySelector('form')` trong bài kiểm bắt nhầm
  form đó: bài kiểm điền email vào ô tên khách rồi submit, tạo ra vài tài khoản khách rác mang tên
  là địa chỉ email. Bài kiểm trên trang có overlay phải **nhắm đúng khuôn** (`.auth-form`), đừng lấy
  phần tử đầu tiên.
- **CHECK constraint là thứ dễ quên nhất khi thêm giá trị enum.** `permission_type` có
  `CHECK (... IN (...))`; thêm `co_host` trong C# mà không nới ràng buộc thì nút "Phong đồng chủ"
  trả 500 (`23514 check_violation`) chứ không phải lỗi rõ ràng nào. Nới **trước** khi ảnh mới lên;
  ảnh cũ chạy với ràng buộc rộng hơn vẫn bình thường vì CHECK chỉ chặn lúc ghi. Lệnh nằm ở
  `Tainguyen/infra/HUONG-DAN-DEPLOY.md`.

---

## 16. Việc còn phải làm

### 16.1. Việc của chủ dự án (mình không có quyền)

| Việc | Vì sao gấp |
|---|---|
| **OAuth cho callimeet.com** | Thêm origin/redirect ở Google Cloud Console + Facebook Developers. Chưa làm thì nút đăng nhập Google/Facebook **hỏng** trên tên miền mới (đăng nhập email/mật khẩu vẫn chạy). |
| **Thu hồi Cloudflare API token** | Token đã dán trong khung chat khi chuyển tên miền. Việc đã xong, nên thu hồi ở *My Profile → API Tokens*. |
| **Thu hồi hai token Figma** | Treo từ đợt trước, cùng lý do. |
| **Autostart cloudflared trên Windows** | Nếu có tác vụ tự khởi động client trỏ `ssh/rdp.cachephoarong.click` thì phải sửa sang `callimeet.com` — bản ghi cũ đã xoá. |
| **Đổi mật khẩu SSH của máy Ubuntu** | Mật khẩu đã dán trong khung chat để mình chạy `ALTER TABLE` và đọc log. Việc đã xong, không cần nữa. |
| **Dọn 8 email thử trong hộp thư** | Bài kiểm xác thực email gửi thật tới `khoabeoloidom+calli…@gmail.com` và `+ui…@gmail.com` — lọc theo dấu `+` là xoá gọn. |

### 16.2. Nên làm

- **Trạng thái chưa đọc chỉ sống trong phiên.** Server chưa có mô hình *đã đọc
  theo từng người*, nên tải lại trang là mất hết chấm đỏ. Muốn giữ được thì cần
  thêm bảng/endpoint đánh dấu đã đọc.
- **Dòng xem trước không đổi theo tin real-time.** Có tin mới thì hội thoại lên
  đầu và có chấm đỏ ngay, nhưng dòng chữ xem trước vẫn là nội dung cũ tới khi
  tải lại — `useLastMessages` lấy riêng, không nghe sự kiện.
- **Sắp thứ tự ở server.** `GET /conversations/{id}/files` vẫn không có
  `OrderBy`; hiện đang sắp ở client. Nên thêm `ORDER BY uploaded_at DESC` cho
  đúng chỗ.
- **Zone `cachephoarong.click` vẫn còn** trên Cloudflare (đã rỗng bản ghi trỏ
  tunnel). Xoá hẳn zone nếu không dùng nữa.
- **Biến `PUBLIC_DOMAIN` trên GitHub** chưa đặt được (máy không có `gh`). Hiện
  dựa vào fallback đã sửa thành `callimeet.com` trong `release.yml`. Nếu sau
  này thấy bản build ra domain cũ thì vào *Settings → Variables* đặt tay.
- **21 tài khoản thử cũ** (`@example.invalid`, ngày 01–02/09) vẫn còn trong
  Identity DB — của các phiên trước, mình không tự xoá. Dữ liệu thử của đợt này
  đã dọn sạch.
- **Còn một tài khoản khách tên `sds`** (id 339) — không phải mình tạo nên để
  nguyên. Nếu là tài khoản thử của bạn thì xoá được.
- **Nới `quota-app` lên 3Gi** (hoặc đặt `maxSurge: 0` cho các Deployment). Hiện
  trần 2Gi vừa khít số pod đang chạy, nên **mọi lần cuộn cả cụm đều sẽ kẹt ở
  service cuối cùng** — đợt này là `admin`, lần sau có thể là service khác. Máy
  có 15Gi, đang dùng 29%, nên nới trần là an toàn; đó cũng là lựa chọn tốt hơn
  `maxSurge: 0` vì `maxSurge: 0` bắt phải tắt pod cũ trước, tức là mỗi lần triển
  khai có một quãng đứt dịch vụ thật.
- **Hai màn danh sách nhóm vẫn song song tồn tại** (mục 14): cái trong chat và
  `/workspaces`. Bản thiết kế định gộp làm một (node 100:22) nhưng màn đó chưa
  dựng. Nút *Tùy chỉnh* đã nối được hai bên và đường phụ trong Cài đặt đã dọn
  (mục 14.1), nên không còn ai bị kẹt — nhưng gộp hai màn thì vẫn chưa làm.
- **Bốn bài kiểm cũ trong scratchpad đã hỏng** vì còn gọi đăng ký một bước
  (`/auth/register` giờ trả 202 chứ không phải 201 kèm token):
  `test_chuphong.py`, `test_dongchu.py`, `test_chuthat.py`,
  `test_khach_taonhom.py`. Bài mới `test_vochu.py` và `vvochu.mjs` dùng tài
  khoản **khách** nên không vướng — sửa mấy bài cũ theo hướng đó là chạy lại
  được.

### 16.3. Carried over từ đợt trước

Vẫn còn nguyên: đo `.flv` **luồng trực tiếp** thật, và phần thiết kế còn dở
(chat cá nhân, Mini App, cuộc họp).

**Định dạng `.geo` trong IPTV — đang tạm hoãn, chưa có link mẫu.** Tra cả tiếng
Việt lẫn tiếng Anh đều không ra định dạng `.geo` chuẩn nào (không phải playlist,
không phải luồng), nên chưa làm để khỏi đoán bừa. Hướng đã chốt sẵn cho lúc có
link thật: **dò theo nội dung** chứ không tin vào đuôi tệp — tải vài KB đầu rồi
nhận chữ ký (`#EXTM3U` → HLS, `<MPD` → DASH, `FLV\x01` → FLV, byte `0x47` lặp
mỗi 188 → MPEG-TS, `ID3`/`OggS`/`fLaC` → âm thanh, `ftyp`/EBML → phát thẳng), và
**chỉ dò khi đuôi không nói lên gì** để kênh `.m3u8`/`.mpd`/`.flv` hiện tại
không phải chịu thêm một request nào. Phải sửa hai chỗ:
[IptvPlayer.tsx](../Frontend/src/pages/meeting/IptvPlayer.tsx) (lúc phát) và
[IptvChannelPicker.tsx](../Frontend/src/pages/meeting/IptvChannelPicker.tsx)
(lúc "Quét thông tin" — hiện đuôi lạ rơi vào `quetHls` rồi báo lỗi).

---

## 17. Ghi chú vận hành

**Tên miền.** Hệ thống chạy ở `callimeet.com`, mỗi service một subdomain,
frontend ở domain gốc. Tunnel vẫn là `e1f67fd0-…` (locally-managed), định tuyến
ở `/etc/cloudflared/config.yml` trên máy Ubuntu. Bản sao lưu config trước mỗi
lần sửa nằm cùng thư mục (`config.yml.bak-*`).

**SSH.** Qua `ssh.callimeet.com` → cổng local 2222. Phải dùng `127.0.0.1:2222`,
**không** dùng `localhost` (phân giải ra `::1` trong khi cloudflared chỉ nghe
IPv4).

**Chuỗi triển khai** không đổi: đẩy lên `main` → GitHub Actions → GHCR →
CronJob `image-watcher` mỗi 2 phút. Đợt này đo được **1–3 phút** từ lúc đẩy tới
lúc bản mới lên (nhanh hơn ghi chú cũ vì không thêm thư viện npm nào).

**Mốc chờ bản mới trong script.** Với thay đổi **chỉ CSS** thì hash của bundle
JS **không đổi** — phải theo dõi hash file `.css`. Ngược lại, đổi `.tsx` thì
theo hash `.js`.

**Vào thẳng CSDL** (Postgres chỉ mở trong cụm). Các DB nằm ở namespace
**`chat-data`**, không phải `chat-app`; mỗi service một pod và một cặp
user/db theo cùng khuôn `<tên>_admin` / `<tên>`:

```bash
k3s kubectl -n chat-data exec deploy/media-db -- psql -U media_admin -d media -c "..."
```

Tương tự `identity-db`/`identity_admin`, `chat-db`/`chat_admin`,
`workspace-db`/`workspace_admin`. Dùng user `postgres` sẽ báo *role does not
exist*. Redis có mật khẩu — `redis-cli -a <mật khẩu> --no-auth-warning`, mật
khẩu nằm trong `ConnectionStrings__Redis` của deployment identity.

**Ba lần đổi lược đồ trong đợt này**, lệnh đầy đủ nằm ở
[HUONG-DAN-DEPLOY.md](../Tainguyen/infra/HUONG-DAN-DEPLOY.md): thêm
`meetings.creator_id`, nới CHECK của `meeting_permissions` để nhận `co_host`.
Cả hai đã chạy trên CSDL thật **trước** khi đẩy ảnh mới — thứ tự này bắt buộc,
ngược lại là service mới truy vấn một thứ chưa tồn tại. Riêng phần xác thực
email **không** cần đổi lược đồ nào (dữ liệu chờ nằm trong Redis).

**Dọn dữ liệu thử.** Vẫn phải dọn sau mỗi đợt. Lưu ý app **không có API tự xoá
tài khoản** (`DELETE /users/me` → 405) và **không xoá được hội thoại p2p**
(→ 405), nên tài khoản `@example.invalid` và hội thoại 1-1 mồ côi tích lại,
phải quét bằng SQL. Nhóm và cuộc họp thì xoá được qua API (kéo theo cả tệp
trong MinIO).
