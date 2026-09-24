# NHẬT KÝ: MINI APP IPTV VÀ GIAO DIỆN PHÒNG HỌP

**Đợt làm ngày 01/09/2026** — Frontend (React) và Media Service

Tài liệu này ghi lại những gì đã đổi, **vì sao** đổi, và số đo thu được trên
hệ thống thật (`cachephoarong.click`). Phần cuối là việc còn phải làm.

> **Lưu ý khi đọc lại (04/09/2026):** hệ thống đã **chuyển sang
> `callimeet.com`**, tên miền `cachephoarong.click` trong tài liệu này chỉ còn
> giá trị lịch sử. Xem [nhật ký đổi tên miền và cải tiến chat / phòng
> họp](nhat-ky-doi-ten-mien-va-cai-tien-chat-hop.md).

Quy ước đọc: mọi số đo đều lấy từ phòng họp thật qua Chrome headless, không
phải ước lượng từ ảnh chụp. Thiết kế gốc vẽ ở 1920×1080; giao diện chạy ở tỉ
lệ `--s = 0.8`, nên số trong Figma nhân 0,8 mới ra số đo được.

---

## Mục lục

1. [Danh sách kênh tự làm mới](#1-danh-sách-kênh-tự-làm-mới)
2. [Khung chiếu IPTV và popup Mini App](#2-khung-chiếu-iptv-và-popup-mini-app)
3. [Focus mode bằng ghim](#3-focus-mode-bằng-ghim)
4. [Chặn điện thoại và nhắc mở rộng cửa sổ](#4-chặn-điện-thoại-và-nhắc-mở-rộng-cửa-sổ)
5. [Khung soạn tin đúng kích thước thiết kế](#5-khung-soạn-tin-đúng-kích-thước-thiết-kế)
6. [Phát thêm .flv và .mpd](#6-phát-thêm-flv-và-mpd)
7. [Phần không làm](#7-phần-không-làm)
8. [Việc còn phải làm](#8-việc-còn-phải-làm)
9. [Ghi chú vận hành](#9-ghi-chú-vận-hành)

---

## 1. Danh sách kênh tự làm mới

**Vấn đề.** Nguồn IPTV không đứng yên: token trong đường dẫn luồng hết hạn,
CDN đổi máy chủ, nhà đài thêm bớt kênh. Một playlist nhập một lần rồi để đó
thì vài ngày sau là một nửa số kênh không phát được, mà người dùng không có
cách nào biết ngoài việc bấm vào từng kênh.

**Đã làm.**

- `PlaylistRefreshService` — cứ 10 phút nhập lại mọi playlist **có
  `source_url`**. Playlist gõ tay không có link nguồn nên không bao giờ bị
  chạm tới.
- `PlaylistImporter` — dùng chung cho cả endpoint "Thêm link" lẫn bộ làm mới.
  Tách riêng vì có **hai** người gọi; để hai bản sao thì một ngày nào đó chúng
  sẽ lệch nhau.
- Đối chiếu theo **(nhóm, tên kênh)** chứ không theo URL. Đây là mấu chốt:
  nguồn đổi đường dẫn luồng luôn, đối chiếu theo URL thì mỗi lần làm mới là
  một loạt "kênh mới" trùng tên và danh sách phình ra mãi.
- Cờ `from_import` trên `iptv_channels` và `iptv_channel_groups` — đánh dấu
  kênh do nhập tự động sinh ra. Kênh biến mất khỏi nguồn thì gỡ, **nhưng chỉ
  kênh mang cờ này**; kênh người dùng tự thêm tay không bao giờ bị đụng tới.
- Chặn một trường hợp nguy hiểm: nguồn trả về playlist **rỗng** (máy chủ lỗi,
  trả về tệp cụt). Lúc đó "không còn thấy kênh nào" không có nghĩa là nhà đài
  bỏ hết kênh — xoá sạch là mất trắng danh sách vì một lỗi nhất thời bên kia.
  Rỗng thì không xoá gì.

**Đo được trên dữ liệu thật.** Playlist "Bóng đá" (id 87) của tài khoản chính:

```
Playlist 87: them 15 kenh, doi link 4, go 29 kenh da bien mat, 0 nhom moi
```

403 kênh, trong đó **402 mang cờ `from_import`** và đúng **1 kênh tên "Live"
do người dùng tự thêm** — kênh đó sống sót qua vòng làm mới đã gỡ 29 kênh
khác. Đây là bằng chứng trực tiếp cho ý đồ thiết kế ở trên.

**Lưu ý về lần làm mới đầu tiên.** Toàn bộ kênh có trước khi cột `from_import`
ra đời đều mặc định `false`, nên **lần làm mới đầu tiên sau khi triển khai
không gỡ kênh nào** — nó chỉ đánh dấu lại những kênh còn thấy trong nguồn. Từ
lần thứ hai trở đi mới gỡ được. Cố ý như vậy.

---

## 2. Khung chiếu IPTV và popup Mini App

**Đã làm.**

Khung chiếu giờ **chỉ còn thẻ `<video>`**. Bỏ dòng tiêu đề, nút "Đổi kênh",
thanh âm lượng, ô chọn tiếng và nút "Tải lại luồng" — tất cả chuyển vào popup.

**Một nút Mini App mở hai popup khác nhau:**

| Trạng thái | Bấm biểu tượng app |
|---|---|
| Chưa có app nào chạy | "Danh sách app" → chọn IPTV → playlist → kênh → tuỳ chỉnh |
| Đang phát IPTV | Vào **thẳng** trang điều khiển (Figma `149:1321`) |

Chỗ rẽ nằm ở `moPanel("app")` trong `MeetingRoomPage.tsx`.

**Người xem cũng mở được popup này.** Độ phân giải, luồng tiếng và âm lượng
đều là lựa chọn **cục bộ của từng máy** — mỗi người tự tải luồng riêng, không
đẩy qua LiveKit. Chỉ "Dừng phát" và "Chuyển kênh" mới đòi hỏi đang trình bày
hoặc là chủ phòng (`dieuKhienDuoc`).

**Thanh âm lượng** là mục mới, đặt dưới khối tuỳ chỉnh. Kéo về 30% thì
`video.volume` = 0.3.

**Hai lỗi sửa kèm.**

- "Quét thông tin" trước đây bấm không lên gì khi popup mở thẳng vào trang
  điều khiển — lúc đó chưa đi qua bước chọn kênh nên `kenhChon` rỗng. Giờ nó
  lấy luôn link mà trình phát đang chạy (`useIptvSlot().streamUrl`).
- Lựa chọn luồng tiếng vẫn **nhớ theo TÊN** sau khi bỏ ô `<select>` trong
  khung chiếu. Con số chỉ dùng đúng lúc người dùng chọn; từ đó về sau bám theo
  tên, vì qua một lần nạp lại chỉ số cũ có thể trỏ sang track khác hẳn.

**Đo được.** 13/13 mục đạt. Con trực tiếp của khung chỉ còn `iptv-player-slot`;
video 1445×929 nằm trọn trong khung 1445×929.

**Còn giữ lại:** thanh điều khiển sẵn có của trình duyệt trên thẻ video (tạm
dừng, toàn màn hình, loa). Bỏ nó đi thì mất luôn nút toàn màn hình.

---

## 3. Focus mode bằng ghim

**Vấn đề.** Tính năng ghim (bấm vào một ô để đưa người đó lên khung lớn) từng
bị tắt bằng cách chú thích dòng `onClick={onGhim}`. Chỗ hỏng: ghim **đứng
trên** lượt trình bày, nên đang chia sẻ màn hình hay đang phát IPTV mà bấm vào
một ô là khung trình bày biến mất — thẻ `<video>` bị gỡ khỏi bố cục và luồng
đứt.

**Đã sửa theo ba lớp.**

1. Đảo thứ tự ưu tiên — lượt trình bày đứng trên ghim.
2. Trong lúc có người trình bày, `onGhim` bỏ trống nên ô **không còn là nút**:
   không đổi con trỏ, không sáng viền khi rê chuột, không có tooltip.
3. Bắt đầu một lượt trình bày mới thì **xoá con số ghim cũ** — nếu không, hết
   trình bày là khung lớn nhảy sang một người mà người dùng không còn nhớ là
   mình đã ghim.

**Đo được.** 19/19 mục đạt, gồm cả nhánh chia sẻ màn hình và nhánh IPTV. Lúc
đang phát: số ô ghim được = 0, con trỏ `auto`, không có `title`; bấm vào ô thì
khung IPTV nguyên vẹn và `video.paused === false`.

**Cách bỏ ghim.** Ô đã ghim rời khỏi dải ô nhỏ (nó đang ở khung lớn) nên không
bấm lại nó được. Đường bỏ ghim là nút **"Bỏ ghim"** ở băng báo trên cùng. Giữ
vậy vì bấm vào video lớn để bỏ ghim dễ nhầm với thao tác điều khiển video.

---

## 4. Chặn điện thoại và nhắc mở rộng cửa sổ

**Chỗ khó** là "chế độ máy tính" của Chrome trên Android: nó thay chuỗi UA
thành UA máy bàn và nới khung nhìn ra 980px, nên mọi cách nhận dạng dựa trên
UA đều trả lời sai.

`DeviceGate.tsx` đi từ trong ra ngoài — bốn dấu hiệu, chỉ cần một cái đúng:

1. `navigator.userAgentData.mobile` — chỉ tin khi nó nói "đúng"
2. Chuỗi UA — bắt được chế độ bình thường
3. `Macintosh` + nhiều điểm chạm = iPad (iPadOS khai là Macintosh)
4. `(hover: none) and (pointer: coarse)` — **phần cứng thì không giả được**

Dấu hiệu 4 là cái sống sót qua chế độ máy tính. Laptop màn cảm ứng không dính
vào đây vì còn bàn di chuột nên trình duyệt vẫn báo `hover: hover`,
`pointer: fine`.

**Hai ca xử lý khác nhau, có ý.**

| | Điện thoại | Cửa sổ hẹp |
|---|---|---|
| Ứng dụng | **Không mount** — `DeviceGate` bọc ngoài `<App>` | **Vẫn chạy** bên dưới, chỉ phủ một lớp báo |
| Vì sao | Không dùng được và không sửa được | Ai đang họp mà lỡ kéo nhỏ cửa sổ thì không được ngắt khỏi phòng |

**Ngưỡng `RONG_TOI_THIEU = 900px`** là mức **thoải mái**, không phải mức vỡ.
Đo trước khi chọn: không trang nào tràn ngang cho tới tận 640px, phòng họp còn
tự chuyển thanh dọc xuống đáy. Chọn 900 vì popup trong phòng họp rộng 661px
nên dưới ~700 là chạm hai mép, còn cửa sổ chiếm nửa màn hình 1920 (960px) thì
vẫn yên.

**Đo được.** 12/12 mục đạt, gồm cả ca "laptop màn cảm ứng → KHÔNG chặn".

**Một hệ quả cần biết:** cổng chặn áp cho *mọi* đường dẫn, nên trang giới thiệu
ở `/` cũng không xem được bằng điện thoại. Muốn giữ trang giới thiệu mở cho di
động và chỉ chặn từ `/app` với `/meetings` trở đi thì chuyển cổng vào trong
router.

---

## 5. Khung soạn tin đúng kích thước thiết kế

**Nguyên nhân.** Ô nhập đặt `flex: 1`. Popup chat đã được nới rộng hơn bản
thiết kế (847 → 1000 × `--s`), nên `flex: 1` cho ô nhập nuốt sạch phần dư.

| | Trước | Sau | Đặc tả × 0,8 |
|---|---|---|---|
| khung soạn | 760 × 66 | **650 × 66** | 650,4 × 66,4 *(813 × 83)* |
| ô nhập | **499** × 39 | **289** × 39 | 288,8 × 39,2 *(361 × 49)* |
| khoảng cách icon | 11,2 | **26,4** | 26,4 *(33)* |
| chữ ô nhập | 16 | **19,2** | 19,2 *(24)* |
| trống hai bên | 16 | **29** | 27,6 *(34,5)* |

Khung soạn giờ khoá ở đúng 813 × `--s` và **căn giữa** thay vì giãn theo popup
— đúng như Frame 38 trong Figma là auto-layout căn giữa.

**Một chỗ dễ sai lâu dài:** nói thẳng `box-sizing: border-box` trên
`.disc-compose` thay vì trông chờ thẻ cha. Trong phòng họp có luật `.mroom *`
đặt border-box, còn trang thảo luận độc lập thì không — để mặc định thì cùng
một khối ra **650×66** ở chỗ này và **654×83** ở chỗ kia.

---

## 6. Phát thêm .flv và .mpd

**Trước đây** mọi luồng đều đi qua hls.js, nên link `.flv` hoặc `.mpd` chỉ
chạy hết 8 lượt tự chữa rồi báo "nguồn có thể đã tắt" — báo sai nguyên nhân.

`doanLoaiLuong()` nhìn đuôi tệp **sau khi cắt query** (link IPTV hay có dạng
`.../live.flv?token=<rất dài>`) rồi chọn bộ giải mã:

| Đuôi | Thư viện | |
|---|---|---|
| `.m3u8` | hls.js | đính kèm sẵn |
| `.mpd` | dashjs | **nạp động** |
| `.flv` | mpegts.js | **nạp động** |

Không đoán ra thì vẫn coi là HLS — định dạng phổ biến nhất, và là hành vi cũ.

**Vì sao nạp động.** Hai thư viện mới cộng lại gần 1,1MB. Để tính vào gói
chính thì ai cũng phải tải về một thứ chín phần mười không dùng tới. Vite tách
thành chunk riêng: gói chính chỉ tăng **4KB**.

**Hai lỗi FLV tìm ra khi đo** (tệp `.flv` 20 giây nhảy thẳng tới cuối rồi lặp
vô tận):

1. `liveBufferLatencyChasing` đuổi theo "mép sóng", mà với tệp hữu hạn thì mép
   sóng chính là cuối tệp. **Bỏ đi.** Luồng FLV thật không cần nó: máy chủ chỉ
   gửi từ thời điểm này trở đi nên trình phát đã ở mép sẵn, còn độ trễ tích luỹ
   sau mỗi lần nghẽn thì watchdog nạp lại là về đúng.
2. Sự kiện `ended` trước nay **luôn** nạp lại (với luồng trực tiếp thì "hết"
   nghĩa là nguồn vừa ngắt). Với tệp hữu hạn thì hết đúng là hết. Giờ chỉ nạp
   lại khi `duration` không hữu hạn — dùng dấu hiệu sẵn có: HLS trực tiếp chạy
   với `liveDurationInfinity` nên `duration` là `Infinity`.

**Đo được sau khi sửa.** 5/5 mục đạt:

| | |
|---|---|
| DASH (.mpd) | 3840×2160, `readyState 4`, đồng hồ tiến 4s |
| Quét thông tin đọc bản DASH | 11 mức độ phân giải |
| FLV (.flv) | 640×360, `readyState 4`, đồng hồ tiến 4s |
| dashjs chỉ tải khi gặp `.mpd` | ✓ |
| mpegts.js chỉ tải khi gặp `.flv` | ✓ |

Chuỗi thời gian FLV: đồng hồ tiến đều 1,00 giây mỗi giây từ đầu đến cuối, hết
tệp thì **dừng** chứ không phát lại vòng.

**Ràng buộc cần nhớ:** nguồn phải cho phép CORS. Trình duyệt tải manifest và
từng đoạn bằng `fetch`, nên máy chủ không gửi `Access-Control-Allow-Origin` thì
kênh không chạy — giống hệt ràng buộc đã có với HLS, không phải chuyện mới.

**Ô khoá ClearKey** (`kid:key`, hai chuỗi hex 32 ký tự, không gạch nối) giờ áp
cho **cả DASH** qua `setProtectionData`, không chỉ HLS. Ô nhập trong thiết kế
ghi ".hpd (nếu có)" — tức nó vốn dành cho chính định dạng này.

---

## 7. Phần không làm

Trong đợt này có yêu cầu thêm phần **tự lấy khoá giải mã từ một endpoint** để
mở luồng DASH-DRM của nhà đài (SCTV15HD trên CDN của VTV Prime, và luồng 4K
của FPT Play). Mình không làm phần đó.

Lý do ghi lại ở đây để người đọc sau không mất công tìm:

- Manifest của luồng đó khai **Widevine** kèm `cenc:pssh` do nhà cung cấp ký,
  không có `org.w3.clearkey` và không có `Laurl`. Máy khách hợp lệ dùng CDM
  Widevine bắt tay với máy chủ cấp phép của họ.
- Khoá được đưa là **khoá nội dung thô** khớp KID trong manifest — chỉ dùng
  được bằng cách bỏ qua hẳn Widevine.
- Thư mục `thamkhao/` (đã vào `.gitignore`, 42MB) chứa một pipeline làm đúng
  việc đó: tải đoạn đã mã hoá, xin khoá từ endpoint bên thứ ba, chạy
  `mp4decrypt`, đóng lại thành HLS.

**Ranh giới:** ô nhập link máy chủ cấp phép ClearKey là **tính năng chuẩn**
(dashjs, Shaka, ExoPlayer đều có) và sẽ được làm khi máy chủ đó phục vụ luồng
do chính dự án mã hoá — nội dung của mình, khoá do mình sinh ra. Xem mục 8.

---

## 8. Việc còn phải làm

### 8.1. Ưu tiên cao

| Việc | Ghi chú |
|---|---|
| **Đo `.flv` luồng trực tiếp thật** | Bản sửa mới chỉ đo trên tệp `.flv` 20 giây tự sinh. Luồng trực tiếp đi nhánh `duration` không hữu hạn — nhánh chưa được đo lần nào. |
| **Thu hồi hai token Figma** | Cả hai từng dán trong khung chat nên nằm trong lịch sử hội thoại. Việc thiết kế gần xong. Thu hồi ở `figma.com/settings`. |
| **Kiểm nhánh ClearKey** | Treo từ đầu. Cần một nguồn mã hoá **của dự án**: đóng gói video của mình bằng `mp4encrypt`/Shaka Packager với `kid`/`key` tự sinh, rồi dán `kid:key` vào ô có sẵn. Hai nguồn thử công khai đã dò đều không dùng được — Axinom hết hạn chứng chỉ TLS, Shaka để khoá trong cấu hình ứng dụng demo. |

### 8.2. Nên làm

- **Cảnh báo khi `kid:key` sai định dạng.** Hiện chuỗi không khớp
  `^[0-9a-f]{32}:[0-9a-f]{32}$` thì bị **bỏ qua lặng lẽ** và kênh phát ở chế độ
  không mã hoá. Triệu chứng là màn hình đen chứ không phải thông báo lỗi — sai
  một ký tự là mất cả buổi dò.
- **Ô nhập link máy chủ cấp phép**, cho luồng do dự án tự mã hoá. Nối vào
  `setProtectionData` của dashjs và `drmSystems` của hls.js. Khoảng một buổi
  làm, và làm xong thì đóng luôn mục 8.1 ở trên.
- **Chỉ báo dung lượng đã dùng** ở đầu popup chat (biểu tượng thứ hai trong
  thiết kế). Cần một endpoint mới đọc số byte đã dùng của phòng tạm.
- **Thu hẹp phạm vi `DeviceGate`** nếu muốn giữ trang giới thiệu mở cho di
  động — chuyển cổng vào trong router thay vì bọc ngoài `<App>`.

### 8.3. Phần thiết kế còn dở

Theo ghi chú của đợt áp thiết kế Calli: **chat cá nhân**, **Mini App** và
**cuộc họp** vẫn còn phần chưa áp xong theo Figma.

---

## 9. Ghi chú vận hành

**Thứ tự triển khai.** `ALTER TABLE` trên CSDL đang chạy **trước** khi đẩy ảnh
mới, không thì service mới truy vấn một cột chưa tồn tại.

**Chuỗi triển khai.** Đẩy lên `main` → GitHub Actions → GHCR → CronJob
`image-watcher` mỗi 2 phút. Từ lúc đẩy tới lúc lên khoảng 6–8 phút; thêm thư
viện npm mới thì lâu hơn.

**Mốc nhận biết bản mới trong script chờ** phải là **ASCII** — chuỗi tiếng Việt
bị bộ rút gọn đổi thành `\uXXXX`. Với CSS thì phải dùng dạng **đã rút gọn**
(`meet-tile-ghim-duoc{cursor:pointer}`, không phải dạng có khoảng trắng).

**Dọn dữ liệu thử.** Sau mỗi đợt kiểm phải dọn: tài khoản `@example.invalid`,
nhóm, hội thoại, cuộc họp, playlist, và **object trong MinIO**. Hai chỗ dễ sót:

- **playlist mồ côi** của tài khoản đã xoá — cần quét riêng
  (`DELETE FROM iptv_channel_lists WHERE user_id NOT IN (...)`)
- **hội thoại `type='meeting'`** — có `workspace_id` rỗng nên lọt qua điều kiện
  lọc theo nhóm

Mức nền đúng của hệ thống hiện tại: 4 nhóm thật (21, 23, 24, 35), 5 hội thoại
thật, 2 tệp thật trong MinIO, 0 mồ côi.

---

## 10. Focus mode trên điện thoại: thu gọn Mini App, mở rộng dải người họp

**Mục tiêu.** Trong Focus mode trên điện thoại, Mini App/phần trình bày nằm
trên dải người xem 2 × 2. Khung Mini App ban đầu chiếm quá nhiều chiều cao;
nếu chỉ thu nhỏ phần `<video>` thì nền xám bao quanh vẫn cao và hai hàng người
họp bên dưới vẫn chật. Yêu cầu cuối là thu ngắn **toàn bộ khung xám** 5%, giữ
nguyên chiều rộng, rồi dùng phần chiều cao trả lại cho dải người họp.

**Cách làm.** Ở breakpoint tối đa 900px, `.meet-stage-app` được đặt chiều cao
bằng 95% phần chiều cao mà stage nhận trước đây (sau khi trừ dải người họp và
khoảng cách). Công thức cũng tính tới `min-height` của dải người họp để không
vỡ ở màn hình thấp. Phần tử kề sau `.meet-stage-app + .mroom-dai` đổi sang
`flex: 1 1 auto`, nhờ vậy nhận đúng khoảng không vừa giải phóng.

`.meet-app-stage` trở lại `flex: 1; height: auto`, nên phần phát lấp đầy khung
xám mới theo chiều dọc và giữ nguyên chiều rộng. Video vẫn dùng
`object-fit: contain`, vì vậy không bị kéo méo hoặc cắt nội dung.

**Đo trên bản public, 384 × 854.**

| Thành phần | Trước | Sau |
|---|---:|---:|
| Khung xám Mini App | 319,02 × 541,20 | **319,02 × 514,13** |
| Dải người họp | 319,02 × 224,00 | **319,02 × 251,08** |
| Mỗi ô người họp | 155,50 × 92,38 | **155,50 × 105,91** |
| Pager | đáy 842,81 | **vẫn đáy 842,81** |

Chiều rộng của khung xám được giữ nguyên; phần cao giảm 27,07px được cộng cho
hai hàng người họp. Kiểm tra runtime xác nhận `stageFlex = 0 0 auto` và
`audienceFlex = 1 1 auto`, nên quy tắc này không ảnh hưởng Focus mode desktop
hoặc các chế độ họp không có Mini App.

**Phát hành.** Commit `f8373d7` — `Resize mobile mini app wrapper`. Lint,
TypeScript (`tsc --noEmit`), production build, CI và pipeline build/deploy đều
thành công; CSS public là `index-BsS9Eb8V.css`.

---

## 11. IPTV: nhập playlist `livesport`, User-Agent player và tự điền ClearKey

**Ngày ghi:** 21/09/2026.

### 11.1. Lỗi import playlist `https://livesport.io.vn/easport`

Triệu chứng trên frontend là request import trả `422` với thông báo:
“Nội dung tải về không phải playlist M3U”. Ban đầu nhìn giống lỗi định dạng
playlist, nhưng kiểm tra bằng `curl`/`wget` từ cả máy local và pod `media` cho
thấy URL này có trả M3U hợp lệ, khoảng 55KB và 151 dòng `#EXTINF`.

Nguyên nhân thật là `PlaylistFetcher` dùng User-Agent kiểu Chrome. Với UA đó,
nguồn `livesport.io.vn` chuyển hướng tiếp sang `https://livesport.io.vn/spo.mp4`
và trả `Content-Type: video/mp4`, nên backend đọc được nội dung MP4 rồi phân
loại `Unknown`. Với UA kiểu IPTV player/VLC, nguồn trả đúng
`/ok/m3u.php` và `Content-Type: application/x-mpegURL`.

**Thay đổi đã làm.**

- Đổi User-Agent của `PlaylistFetcher` sang `VLC/3.0.20 LibVLC/3.0.20`.
- Thêm header `Accept` ưu tiên M3U/HLS/text.
- Build `MediaService.Api` thành công.
- Push commit `9a0d82a` — `Sửa tải playlist IPTV theo UA player`.
- GitHub Actions `CI` và `Build & Push images` đều thành công.
- Restart deployment `media`; pod mới ready.
- Test lại trong pod `media`: nguồn trả `application/x-mpegURL`, 55.219 bytes,
  151 mục `#EXTINF`.

### 11.2. Tự điền `KID:KEY` khi chọn kênh IPTV

Backend trước đó đã có endpoint
`GET /meetings/{meetingId}/mini-app/iptv/stream-url` trả metadata kênh, gồm
`manifestType`, `licenseType`, `licenseKey` và `clearKey`. Tuy nhiên popup chọn
kênh chưa tự dùng dữ liệu này để đổ vào ô `KID:KEY`.

**Thay đổi đã làm.**

- Khi bấm chọn một kênh trong `IptvChannelPicker`, frontend gọi
  `iptvApi.getStreamUrl(meetingId, channelId)` ngay ở bước tuỳ chỉnh.
- Nếu response có `clearKey` hoặc `licenseKey` dạng
  `32-hex-kid:32-hex-key`, ô `KID:KEY` được tự điền.
- Nếu kênh không có key, ô `KID:KEY` được xoá để tránh dính key cũ sang kênh
  mới.
- Có guard để khi người dùng bấm nhanh nhiều kênh, response của kênh cũ không
  ghi đè kênh mới.
- Nút “Bắt đầu phát” bị disable trong lúc frontend đang lấy metadata/key.
- Build frontend production thành công.
- Push commit `e2a84a5` — `Tự điền ClearKey khi chọn kênh IPTV`.
- GitHub Actions thành công; đã restart deployment `frontend`, pod mới ready.

### 11.3. Kết luận riêng với các kênh SkySport trong playlist này

Kiểm tra các dòng liên quan trong playlist:

- `SKYSPORT EPL` trỏ tới `https://livesport.io.vn/ok/apo.php?id=skyepl`.
- `SKY SPORTS EPL` trỏ tới `https://livesport.io.vn/ok/iptv.php?id=skyepl`.

Kết quả thử nguồn:

- Bản `apo.php?id=skyepl` trả HLS media playlist, nhưng các segment bên trong
  là `http://apolonbox.online:80/...ts`.
- Bản `iptv.php?id=skyepl` redirect sang luồng MPEG-TS HTTP trực tiếp
  (`video/mp2t`), không thấy metadata ClearKey/DASH.

Vì vậy VLC phát được không chứng minh web thiếu key. Nguyên nhân web không phát
được là do trình duyệt bị ràng buộc bởi **CORS** và có thể thêm **mixed
content** khi trang `https://callimeet.com` tải segment `http://...`.

Log trình duyệt xác nhận lỗi chính:

- `No 'Access-Control-Allow-Origin' header is present on the requested resource`
  với các URL `livesport.io.vn/ok/iptv.php?...` và `apo.php?...`.
- Các log `static.cloudflareinsights.com ... ERR_BLOCKED_BY_CLIENT` là do
  adblock/privacy extension chặn Cloudflare beacon, không ảnh hưởng IPTV.
- LiveKit đã kết nối thành công; log `disconnected -> connecting -> connected`
  không phải nguyên nhân lỗi kênh.

**Hướng xử lý còn lại nếu muốn phát các nguồn kiểu này trong web:** thêm proxy
IPTV qua `MediaService`. Frontend gọi URL HTTPS của dự án, backend tải nguồn
HTTP/không CORS ở phía server rồi stream lại qua HTTPS với CORS hợp lệ. Không
thể “fake CORS” ở frontend vì CORS là luật do trình duyệt thực thi.

---

## 12. Lưu ý chưa triển khai: upscale video và LiveKit tại nhà

**Ngày ghi:** 24/09/2026. Đây là phương án đã trao đổi, **chưa viết code và
chưa thay đổi hạ tầng production**.

### 12.1. Upscale video bằng AI trên máy người xem

Mục tiêu là tăng độ nét video/IPTV bằng GPU của client để không phát sinh chi
phí GPU server. Pipeline dự kiến:

1. Giải mã từng `VideoFrame` bằng WebCodecs.
2. Chạy mô hình ONNX nhẹ bằng WebGPU, ưu tiên upscale 2×.
3. Render khung đã xử lý ra canvas; âm thanh vẫn đi từ luồng gốc.
4. Benchmark thiết bị trước khi bật. Không giữ được tối thiểu khoảng 24 FPS
   thì tự lùi về bộ lọc làm nét thường hoặc tắt.

Chỉ nên coi đây là tính năng thử nghiệm trên desktop. Điện thoại có nguy cơ
nóng, hao pin và rớt khung hình. Nguồn IPTV khác origin phải cấp CORS hoặc đi
qua proxy hợp lệ của Calli; canvas chứa video không có CORS sẽ bị đánh dấu
`tainted` và không đọc được pixel. Luồng DRM cũng không được coi là đầu vào
có thể xử lý tùy ý.

Tài liệu tham khảo:

- WebCodecs: <https://www.w3.org/TR/webcodecs/>
- ONNX Runtime WebGPU: <https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html>
- Quy tắc canvas/CORS: <https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image>

### 12.2. LiveKit phụ tại nhà sau CGNAT

Ý tưởng là chạy thêm một LiveKit tại nhà, cho người tạo phòng chọn giữa máy
chủ VPS ổn định và máy chủ nhà, rồi ngừng dùng máy chủ nhà khoảng 17:00 vì
băng thông buổi tối bị nhà mạng bóp.

**Cloudflare Tunnel dùng QUIC không tự giải quyết được bài toán này.** Cờ
`cloudflared --protocol quic` chỉ chọn giao thức cho kết nối đi ra từ
`cloudflared` tới Cloudflare Edge. Nó không biến cổng UDP của LiveKit thành
một endpoint WebRTC công khai. Public hostname của Tunnel có thể chuyển phần
HTTPS/WebSocket báo hiệu, nhưng media LiveKit vẫn cần ICE/UDP, ICE/TCP hoặc
TURN có thể truy cập từ Internet.

Theo tài liệu LiveKit, một bản tự host thường cần các đường sau:

- API/WebSocket sau HTTPS reverse proxy.
- ICE/TCP `7881`.
- ICE/UDP mux `7882` hoặc dải UDP `50000-60000`.
- Nếu bật TURN: UDP `3478` và/hoặc TURN/TLS `5349`/`443`.

Cloudflare Tunnel public thông thường không cung cấp UDP công khai cho trình
duyệt tùy ý. Đường private TCP/UDP yêu cầu thiết bị người dùng tham gia
Cloudflare One/WARP; không phù hợp với người dùng công cộng của Calli. Đường
public TCP/UDP qua Cloudflare Spectrum là sản phẩm trả phí và custom TCP/UDP
có giới hạn gói, nên không chọn cho phương án tiết kiệm chi phí.

Các cách khả thi, theo thứ tự nên cân nhắc:

1. Xin IP public/port forwarding từ ISP, hoặc dùng IPv6 public nếu kiểm tra
   được mọi client cần hỗ trợ đều kết nối ổn định.
2. Dùng một VPS public làm điểm chuyển tiếp L4 qua WireGuard tới máy nhà.
   Cách này vượt CGNAT nhưng toàn bộ media vẫn đi qua băng thông VPS, chỉ
   chuyển phần CPU xử lý LiveKit về nhà.
3. Dùng Cloudflare Spectrum/giải pháp L4 trả phí nếu sau này có ngân sách.

Không nên chỉ tunnel `wss://.../rtc` rồi coi là hoàn tất: báo hiệu có thể kết
nối thành công nhưng ICE media vẫn thất bại hoặc toàn bộ người dùng phải rơi
về một TURN không tồn tại.

Tài liệu tham khảo:

- LiveKit ports/firewall: <https://docs.livekit.io/transport/self-hosting/ports-firewall/>
- LiveKit self-host deployment: <https://docs.livekit.io/transport/self-hosting/deployment/>
- Cloudflare Tunnel QUIC: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/>
- Giao thức public hostname của Tunnel: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/>
- Cloudflare Spectrum: <https://developers.cloudflare.com/spectrum/>

### 12.3. Thiết kế lựa chọn máy chủ và lịch 17:00

Nếu giải quyết được đường mạng công khai, hai LiveKit nên được xem là **hai
cụm riêng**, không tự ghép thành một cluster qua Internet nhà. Khi tạo cuộc
họp:

- Mặc định chọn **VPS — ổn định**.
- Cho chọn **Máy chủ nhà — thử nghiệm**, chỉ khi health check đang xanh và
  còn trong khung giờ cho phép.
- Cuộc họp được ghim vào một cụm ngay lúc tạo. Media Service ký token bằng
  API key/secret tương ứng và trả đúng `serverUrl`; không chuyển cụm giữa
  cuộc gọi vì LiveKit không di chuyển phòng đang chạy một cách liền mạch.
- Backend nhận heartbeat từ máy nhà và tự ẩn lựa chọn này khi tunnel/server
  mất kết nối, độ trễ cao hoặc upload xuống dưới ngưỡng.

Lịch đề xuất theo múi giờ `Asia/Bangkok`:

- 16:45: ngừng cấp phòng mới lên máy nhà.
- 16:55: cảnh báo các phòng còn hoạt động.
- 17:00: ngừng node nhà và đưa toàn bộ phòng mới về VPS.

Tắt cứng lúc 17:00 sẽ ngắt những phòng đang nằm trên máy nhà. Nếu muốn không
ngắt người dùng thì phải cho phòng hiện tại chạy đến khi kết thúc, nhưng khi
đó không bảo đảm mục tiêu tránh băng thông buổi tối. Trước khi triển khai cần
chốt rõ một trong hai chính sách; mặc định an toàn cho UX là **drain phòng cũ,
không nhận phòng mới**, kèm thời lượng tối đa để node không chạy vô hạn.
