# NHẬT KÝ: ĐỔI TÊN MIỀN VÀ CẢI TIẾN CHAT / PHÒNG HỌP

**Đợt làm 02–04/09/2026** — Frontend (React), hạ tầng Cloudflare + k3s

Tiếp nối [nhật ký Mini App IPTV và giao diện phòng họp](nhat-ky-iptv-va-giao-dien-phong-hop.md).
Tài liệu này ghi lại những gì đã đổi, **vì sao** đổi, và số đo thu được trên hệ
thống thật. Từ đợt này hệ thống chạy ở **`callimeet.com`** (trước là
`cachephoarong.click`).

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
10. [Phòng vô chủ: đồng chủ phòng và chuyển quyền](#10-phòng-vô-chủ-đồng-chủ-phòng-và-chuyển-quyền)
11. [Bẫy đã vấp](#11-bẫy-đã-vấp)
12. [Việc còn phải làm](#12-việc-còn-phải-làm)
13. [Ghi chú vận hành](#13-ghi-chú-vận-hành)

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
xem mục 11.

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

## 10. Phòng vô chủ: đồng chủ phòng và chuyển quyền

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
người thì **người vào sớm nhất còn ở lại** lên làm chủ.

| Điểm | Vì sao |
|---|---|
| Ưu tiên tài khoản đã đăng ký; khách chỉ lên khi phòng không còn ai khác | người vào bằng link không nên bỗng nhiên nắm quyền đuổi người / kết thúc trong khi thành viên thật vẫn đang ngồi đó |
| Identity không trả lời được thì lấy luôn người vào sớm nhất | fail-open: một sự cố của Identity không được phép để phòng nằm lại trạng thái vô chủ - đó mới là cái đắt hơn |
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


### 10.1. Đồng chủ phòng - nói trước ai sẽ thay mình

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

**Kế vị**: đồng chủ đứng **trước** luật "người vào sớm nhất". Nhiều đồng chủ thì lấy người vào sớm
nhất trong số họ - kể cả khách vào bằng link, vì chính chủ phòng đã chọn đích danh, không việc gì
để tiêu chí máy móc phủ quyết. Lên làm chủ thật thì hàng `co_host` bị xoá, để giao diện không hiện
một người vừa là chủ vừa là đồng chủ.

**Chỗ lưu: `meeting_permissions`, không phải `meeting_participants.role`.** Hàng participant sinh
mới mỗi lần vào phòng, nên để ở `role` thì đồng chủ rớt mạng vào lại là mất chức. Hàng permission
sống theo cả cuộc họp. Giá phải trả là một lần đổi lược đồ - xem mục 11.

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

**Một vòng sửa lại giữa chừng.** Bản đầu cho đồng chủ *mọi* quyền của chủ phòng (kể cả kết thúc
cuộc họp và cấm mic từng người) - đã chạy được 17/17 rồi mới siết lại theo yêu cầu. Ranh giới hiện
tại gọn hơn và cũng dễ giải thích hơn: **tắt** là việc của người điều phối, **cấm** là việc của chủ
phòng.

---

## 11. Bẫy đã vấp

Ghi lại để lần sau không mất công dò:

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
- **CHECK constraint là thứ dễ quên nhất khi thêm giá trị enum.** `permission_type` có
  `CHECK (... IN (...))`; thêm `co_host` trong C# mà không nới ràng buộc thì nút "Phong đồng chủ"
  trả 500 (`23514 check_violation`) chứ không phải lỗi rõ ràng nào. Nới **trước** khi ảnh mới lên;
  ảnh cũ chạy với ràng buộc rộng hơn vẫn bình thường vì CHECK chỉ chặn lúc ghi. Lệnh nằm ở
  `Tainguyen/infra/HUONG-DAN-DEPLOY.md`.

---

## 12. Việc còn phải làm

### 12.1. Việc của chủ dự án (mình không có quyền)

| Việc | Vì sao gấp |
|---|---|
| **OAuth cho callimeet.com** | Thêm origin/redirect ở Google Cloud Console + Facebook Developers. Chưa làm thì nút đăng nhập Google/Facebook **hỏng** trên tên miền mới (đăng nhập email/mật khẩu vẫn chạy). |
| **Thu hồi Cloudflare API token** | Token đã dán trong khung chat khi chuyển tên miền. Việc đã xong, nên thu hồi ở *My Profile → API Tokens*. |
| **Thu hồi hai token Figma** | Treo từ đợt trước, cùng lý do. |
| **Autostart cloudflared trên Windows** | Nếu có tác vụ tự khởi động client trỏ `ssh/rdp.cachephoarong.click` thì phải sửa sang `callimeet.com` — bản ghi cũ đã xoá. |

### 12.2. Nên làm

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

### 12.3. Carried over từ đợt trước

Vẫn còn nguyên: đo `.flv` **luồng trực tiếp** thật, và phần thiết kế còn dở
(chat cá nhân, Mini App, cuộc họp).

---

## 13. Ghi chú vận hành

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

**Dọn dữ liệu thử.** Vẫn phải dọn sau mỗi đợt. Lưu ý app **không có API tự xoá
tài khoản** (`DELETE /users/me` → 405) và **không xoá được hội thoại p2p**
(→ 405), nên tài khoản `@example.invalid` và hội thoại 1-1 mồ côi tích lại,
phải quét bằng SQL. Nhóm và cuộc họp thì xoá được qua API (kéo theo cả tệp
trong MinIO).
