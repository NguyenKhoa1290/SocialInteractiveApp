# Bố trí ổ cứng trên máy chủ

## Hiện trạng

| Ổ | Loại | Định dạng | Gắn ở | Dùng cho |
|---|---|---|---|---|
| `sda` 223 GB | **SSD** | ext4 | `/` | Hệ điều hành, k3s, **toàn bộ CSDL** |
| `sdb1` 451 GB | **HDD** (ổ quay) | **NTFS** | `/mnt/hdd500` | **Dữ liệu MinIO** (file người dùng tải lên) |
| `sdb2` 15 GB | HDD | swap | *(không bật)* | — |

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

Đang dùng `/swapfile` 2 GB trên SSD. Phân vùng `sdb2` 15 GB trên ổ HDD **cố ý không bật**: nó nằm trên
chính cái ổ có thể bị rút ra, mà rút swap đang hoạt động ra khỏi kernel thì tiến trình nào có trang bị
đẩy xuống đó sẽ chết. Với 16 GB RAM và mức dùng thực tế ~3 GB thì swap thêm cũng không giải quyết gì.

Nếu về sau quyết định không rút ổ nữa thì bật bằng:

```bash
sudo swapon /dev/sdb2
echo 'UUID=e21bb9c9-f511-4666-b8fe-f437bbe5a704 none swap sw,nofail 0 0' | sudo tee -a /etc/fstab
```

## Bản dữ liệu MinIO cũ

Trước khi chuyển, PV cũ đã được đổi `persistentVolumeReclaimPolicy` sang `Retain`, nên dữ liệu gốc vẫn
còn nguyên tại:

```
/var/lib/rancher/k3s/storage/pvc-c93998b0-4ae4-4a87-9823-86819e993ef8_chat-data_minio-data
```

Giữ lại làm bản lùi. Chạy ổn định một thời gian thì xoá được — nó chiếm 34 MB trên SSD.
