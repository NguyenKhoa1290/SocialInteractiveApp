# Bố trí ổ cứng trên máy chủ

## Hiện trạng

| Ổ | Loại | Định dạng | Gắn ở | Dùng cho |
|---|---|---|---|---|
| `sda` 223 GB | **SSD** | ext4 | `/` | Hệ điều hành, k3s, **toàn bộ CSDL** |
| `sdb1` 451 GB | **HDD** (ổ quay) | **NTFS** | `/mnt/hdd500` | **Dữ liệu MinIO** (file người dùng tải lên) |
| `sdb2` 15 GB | HDD | swap | *(swap)* | Swap dự phòng, ưu tiên thấp |

## Vì sao chia như vậy

**CSDL ở lại SSD.** Postgres sống bằng truy cập ngẫu nhiên — đúng điểm yếu nhất của ổ quay. Toàn bộ
dữ liệu CSDL hiện chỉ ~300 MB trong khi SSD còn trống 182 GB, nên chuyển sang HDD chỉ đổi lấy sự chậm
mà không được gì.

**MinIO sang HDD.** Nó giữ file người dùng tải lên — thứ *duy nhất* trong hệ thống phình to không giới
hạn, và nó đọc/ghi tuần tự nên ổ quay hoàn toàn đủ. Đo thực tế trên ổ này: **86,5 MB/s** ghi tuần tự.

**Giữ NTFS chứ không định dạng lại ext4**, vì ổ này có thể được rút ra cắm sang máy Windows. Đã kiểm
chứng MinIO chạy tốt trên `ntfs3`: format pool thành công, ghi/đọc 20 MB qua service khớp checksum,
ghi đè và xoá đều bình thường. MinIO chạy bằng `root` nên không vướng chuyện quyền.

## Ổ này có thể bị rút ra — và hệ thống đã tính đến

Hai lớp bảo vệ, cả hai đều đã đo:

**1. `nofail` trong `/etc/fstab`** — rút ổ ra thì máy vẫn khởi động bình thường, không treo ở màn hình
boot chờ thiết bị.

```
UUID=539C3B9A5FD23C8B /mnt/hdd500 ntfs3 defaults,nofail,uid=0,gid=0,umask=0022,windows_names,x-systemd.device-timeout=10 0 0
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

> **Lưu ý:** chủ dự án đã quyết định **không rút ổ ra nữa**, và swap 15 GB ở dưới nằm trên chính ổ
> này. Nếu sau này đổi ý muốn rút, phải `sudo swapoff /dev/sdb2` trước — rút swap đang hoạt động ra
> khỏi kernel thì tiến trình nào có trang bị đẩy xuống đó sẽ chết.

### Muốn rút ổ ra thì làm gì

```bash
sudo k3s kubectl -n chat-data scale deploy minio --replicas=0   # dừng MinIO trước
sudo umount /mnt/hdd500
# ... rút ổ, cắm lại ...
sudo mount /mnt/hdd500
sudo k3s kubectl -n chat-data scale deploy minio --replicas=1
```

Rút ổ khi MinIO đang chạy sẽ làm nó gặp lỗi I/O. Trong lúc ổ vắng mặt, **mọi file đính kèm trong chat
không tải về được** — tin nhắn text vẫn bình thường vì chúng nằm trong Postgres trên SSD.

## Swap

Tổng **16 GB swap**, chia hai mức ưu tiên:

| Vùng | Nằm ở | Kích thước | `pri` | Vai trò |
|---|---|---|---|---|
| `/swapfile` | **SSD** | 2 GB | **10** | Dùng trước — nhanh hơn nhiều |
| `/dev/sdb2` | **HDD** | 15 GB | **5** | Chỉ dùng khi swapfile đầy |

Số `pri` cao hơn được kernel dùng trước. Đây là điểm dễ sai: khi mới bật, phân vùng HDD nhận `pri=5`
còn `/swapfile` để mặc định là `-2`, nghĩa là **ổ quay được dùng trước SSD** — ngược hẳn ý muốn. Đã
đặt `pri` tường minh cho cả hai.

```
/swapfile                                 none  swap  sw,pri=10        0  0
UUID=e21bb9c9-f511-4666-b8fe-f437bbe5a704 none  swap  sw,pri=5,nofail  0  0
```

**`vm.swappiness` hạ từ 60 xuống 10** (`/etc/sysctl.d/99-swappiness.conf`). Mặc định 60 khá mạnh tay:
kernel sẵn sàng đẩy trang ra đĩa dù RAM còn trống. Máy này chạy CSDL và một phần swap nằm trên ổ quay,
nên để kernel bỏ bớt page cache trước, chỉ swap khi thật sự cần.

Đã kiểm chứng cả hai vùng lên đúng qua **đường systemd dùng lúc khởi động** (`systemctl start
dev-disk-by-uuid-....swap`), không phải chỉ `swapon` bằng tay.

## Bản dữ liệu MinIO cũ

Trước khi chuyển, PV cũ đã được đổi `persistentVolumeReclaimPolicy` sang `Retain`, nên dữ liệu gốc vẫn
còn nguyên tại:

```
/var/lib/rancher/k3s/storage/pvc-c93998b0-4ae4-4a87-9823-86819e993ef8_chat-data_minio-data
```

Giữ lại làm bản lùi. Chạy ổn định một thời gian thì xoá được — nó chiếm 34 MB trên SSD.
