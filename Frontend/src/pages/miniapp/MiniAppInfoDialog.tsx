import { Modal } from "../../components/Modal";
import { MiniAppIcon } from "./MiniAppIcon";

// Popup "Thông tin Mini App" - Figma node 111:307.
export function MiniAppInfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="" ariaLabel="Thông tin Mini App" onClose={onClose} width={589}>
      <div className="ma-dialog">
        <div className="ma-dialog-head">
          <MiniAppIcon />
        </div>

        <p className="ma-info-line">Nhà phát triển: Calli</p>
        <p className="ma-info-line">Tên ứng dụng: Calli IPTV</p>
        <p className="ma-info-desc">
          Mô tả: Tự thêm các đề mục .m3u8 và .mpd cho các cuộc họp xem chung. Quản trị viên đặt sẵn
          một số playlist dùng chung; bạn cũng có thể tự thêm playlist riêng của mình.
        </p>
        <p className="ma-note">
          Cần vào cuộc họp mới phát được: kênh đang xem sẽ chiếu cho cả phòng, nên phải có phòng đã.
        </p>
      </div>
    </Modal>
  );
}
