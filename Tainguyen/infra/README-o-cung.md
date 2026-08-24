# Bố trí ổ cứng trên máy chủ

## Hiện trạng

| Ổ | Loại | Định dạng | Gắn ở | Dùng cho |
|---|---|---|---|---|
| `sda` 223 GB | **SSD** | ext4 | `/` | Hệ điều hành, k3s, **toàn bộ CSDL** |
| `sdb1` 451 GB | **HDD** (ổ quay) | **ext4** (nhãn `hdd500`) | `/mnt/hdd500` | **Dữ liệu MinIO** (file người dùng tải lên) |
| `sdb2` 15 GB | HDD | swap | — | Swap dự phòng, ưu tiên thấp |

## Vì sao chia như vậy

**CSDL ở lại SSD.** Postgres sống bằng truy cập ngẫu nhiên — đúng điểm yếu nhất của ổ quay. Toàn bộ
dữ liệu CSDL hiện chỉ ~300 MB trong khi SSD còn trống 182 GB, nên chuyển sang HDD chỉ đổi lấy sự chậm
mà không được gì.

**MinIO sang HDD.** Nó giữ file người dùng tải lên — thứ *duy nhất* trong hệ thống phình to không giới
hạn, và nó đọc/ghi tuần tự nên ổ quay hoàn toàn đủ. Đo thực tế trên ổ này: **86,5 MB/s** ghi tuần tự.

## Vì sao đổi từ NTFS sang ext4

Ban đầu ổ này để NTFS, vì tính chuyện rút ra cắm sang máy Windows. Sau khi chốt **không rút nữa** thì
lý do đó biến mất, và NTFS chỉ còn lại phần phiền:

- **Công cụ Linux báo động giả liên tục.** GParted nhìn vào ổ và kêu `$MFTMirr does not match $MFT` /
  `NTFS is inconsistent. Run chkdsk /f on Windows`. Đó là **báo nhầm**: GParted dò bằng bộ userspace
  `ntfs-3g` trong khi nhân `ntfs3` đang mount ổ ở chế độ ghi, mà `$MFTMirr` chỉ đồng bộ với `$MFT` tại
  checkpoint và lúc tháo mount. Đã kiểm chứng — tháo mount sạch rồi chạy `ntfsfix -n` thì:

  ```
  Processing of $MFT and $MFTMirr completed successfully.
  Volume Flags: 0x0000          ← cờ dirty KHÔNG bật
  ```

  Nhưng mỗi lần muốn chứng minh nó vô hại lại phải dừng dịch vụ để tháo mount. Không đáng.
- **`fsck` lúc khởi động không kiểm được NTFS.** Với ext4 thì kernel tự kiểm và tự vá (cột `pass` = 2
  trong fstab).
- `ntfs3` là driver còn trẻ; ext4 thì đã bị dùng đến mòn.

Đổi rất rẻ vì dữ liệu chỉ 34 MB: sao lưu sang SSD → đối chiếu md5 từng file → `mkfs.ext4` → khôi phục
→ đối chiếu lại. **31/31 file khớp checksum** ở cả hai lần đối chiếu.

Dùng `mkfs.ext4 -m 1` chứ không để mặc định 5% — ổ này chỉ chứa dữ liệu, không cần dành 22 GB cho
`root`.

## Bảo vệ khi ổ vắng mặt

Vẫn giữ dù đã chốt không rút ổ — nó bảo vệ cả trường hợp ổ hỏng hoặc mount hụt vì lý do khác.

**1. `nofail` trong `/etc/fstab`** — ổ vắng/hỏng thì máy vẫn khởi động bình thường, không treo ở màn
hình boot chờ thiết bị.

```
UUID=b2a37915-5a17-4e35-83d4-e9eb9fe50619 /mnt/hdd500 ext4 defaults,nofail,x-systemd.device-timeout=10 0 2
```

**2. `hostPath` với `type: Directory`** thay vì `local-path` như các PVC khác. Đây là điểm mấu chốt:

- Nếu dùng `local-path`, khi ổ vắng mặt provisioner sẽ **tự tạo một thư mục rỗng ngay trên ổ SSD**, và
  MinIO khởi động như chưa từng có file nào — hỏng âm thầm, kiểu hỏng tệ nhất.
- Với `hostPath type: Directory`, ổ vắng mặt thì `/mnt/hdd500/minio` không tồn tại và **kubelet từ
  chối khởi động pod**:

  ```
  MountVolume.SetUp failed for volume "minio-data-hdd":
  hostPath type check failed: /mnt/hdd500/minio is not a directory
  ```

  Đã thử thật: gỡ mount → pod đứng ở `ContainerCreating` với đúng thông báo trên, và **không một byte
  nào bị ghi vào SSD**. Gắn ổ lại → MinIO chạy tiếp bình thường.

### Muốn rút ổ ra thì làm gì

Phải `swapoff` trước — swap 15 GB nằm trên chính ổ này, rút swap đang hoạt động ra khỏi kernel thì
tiến trình nào có trang bị đẩy xuống đó sẽ chết.

```bash
sudo k3s kubectl -n chat-data scale deploy minio --replicas=0
sudo swapoff /dev/sdb2
sudo umount /mnt/hdd500
# ... rút ổ, cắm lại ...
sudo mount /mnt/hdd500
sudo swapon /dev/sdb2
sudo k3s kubectl -n chat-data scale deploy minio --replicas=1
```

Trong lúc ổ vắng mặt, **mọi file đính kèm trong chat không tải về được** — tin nhắn text vẫn bình
thường vì chúng nằm trong Postgres trên SSD.

## Swap

Tổng **16 GB swap**, chia hai mức ưu tiên:

| Vùng | Nằm ở | Kích thước | `pri` | Vai trò |
|---|---|---|---|---|
| `/swapfile` | **SSD** | 2 GB | **10** | Dùng trước — nhanh hơn nhiều |
| `/dev/sdb2` | **HDD** | 15 GB | **5** | Chỉ dùng khi swapfile đầy |

Số `pri` cao hơn được kernel dùng trước. Đây là điểm dễ sai: khi mới bật, phân vùng HDD nhận `pri=5`
còn `/swapfile` để mặc định là `-2`, nghĩa là **ổ quay được dùng trước SSD** — ngược hẳn ý muốn. Đã
đặt `pri` tường minh cho cả hai.

**`vm.swappiness` hạ từ 60 xuống 10** (`/etc/sysctl.d/99-swappiness.conf`). Mặc định 60 khá mạnh tay:
kernel sẵn sàng đẩy trang ra đĩa dù RAM còn trống. Máy này chạy CSDL và một phần swap nằm trên ổ quay,
nên để kernel bỏ bớt page cache trước, chỉ swap khi thật sự cần.

Đã kiểm chứng cả swap lẫn mount lên đúng qua **đường systemd dùng lúc khởi động**, và sống sót qua một
lần khởi động lại thật.

## Cạm bẫy: GParted để lại mask trong systemd

Sau khi chạy GParted, phát hiện một loạt symlink `-> /dev/null` trong `/run/systemd/system/`, gồm
`mnt-hdd500.mount` và **toàn bộ mount unit của kubelet cho các PVC Postgres**. GParted cố tình mask
chúng để systemd không tự gắn ổ giữa lúc nó thao tác, nhưng lần đó không gỡ lại.

Hậu quả gặp phải: `systemctl start mnt-hdd500.mount` báo `Unit is masked`, và
`systemctl unmask` **không gỡ được** — mask nằm trong `/run` nên phải:

```bash
sudo systemctl unmask --runtime mnt-hdd500.mount
# hoac don sach tat ca:
sudo find /run/systemd/system -maxdepth 1 -type l -lname /dev/null -delete
sudo systemctl daemon-reload
```

Chúng nằm trong `/run` (tmpfs) nên tự biến mất sau khi khởi động lại. Nhưng nếu gặp lỗi mount lạ ngay
sau khi dùng GParted thì hãy nhìn vào đây trước.

## Các bản lưu dữ liệu MinIO

Hai bản, đều trên SSD, giữ làm đường lùi:

| Đường dẫn | Là gì |
|---|---|
| `/var/lib/rancher/k3s/storage/pvc-c93998b0-…_chat-data_minio-data` | Bản trước khi chuyển sang HDD (PV cũ, đã đổi `Retain`) |
| `/var/tmp/minio-backup` | Bản chụp ngay trước khi định dạng lại sang ext4 |

Mỗi bản 34 MB. Chạy ổn định một thời gian thì xoá được cả hai.
