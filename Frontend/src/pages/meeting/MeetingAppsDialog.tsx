import { MeetingPopup } from "./MeetingPopup";
import { MiniAppIcon } from "../miniapp/MiniAppIcon";

// Popup "Bat dau khoi tao ung dung" - Figma 140:218.
//
// Ban thiet ke ve hai dong: IPTV va mot "Ten MiniApp / Mo ta....." de trong.
// Dong thu hai la CHO CHO app sau, khong phai mot app that - nen o day chi
// liet ke nhung app thuc su co, kem mot dong noi ro con lai se them sau.
export function MeetingAppsDialog({
  moDuoc,
  onOpenIptv,
  onClose,
}: {
  // Chu phong luon mo duoc; nguoi thuong chi khi "Cai dat phong" bat muc cho
  // phep thanh vien khoi tao ung dung.
  moDuoc: boolean;
  onOpenIptv: () => void;
  onClose: () => void;
}) {
  return (
    <MeetingPopup title="Bắt đầu khởi tạo ứng dụng" onClose={onClose} width={826}>
      <h3 className="mpop-nhan">Danh sách app</h3>

      <button type="button" className="mpop-app" onClick={onOpenIptv} disabled={!moDuoc}>
        <MiniAppIcon size={68} />
        <span className="mpop-app-chu">
          <b>IPTV</b>
          <em>Cần vào cuộc họp: Phát trực tiếp dịch vụ streamming</em>
        </span>
      </button>

      {!moDuoc && (
        <p className="mpop-ghi-chu">
          Chủ phòng chưa cho phép thành viên khởi tạo ứng dụng — bật ở Quản lý thành viên → Cài đặt.
        </p>
      )}
    </MeetingPopup>
  );
}
