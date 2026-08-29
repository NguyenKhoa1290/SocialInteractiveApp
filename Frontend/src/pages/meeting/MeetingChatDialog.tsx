import { Avatar } from "../../components/Avatar";
import { MeetingDiscussion } from "./MeetingDiscussion";

// Popup "Nhan tin cuoc hop" - Figma 136:419 (cuoc hop cua nhom) va 136:460
// (phong tam). Hai frame chi khac cai dau va dong nhac cuoi:
//   - nhom  (header 136:508): anh nhom + ten nhom
//   - tam   (header 136:500): "Cuoc hop tao ra boi: <ai>" + mot dong nho noi
//     ro tin nhan trong day la TAM, khong luu lai
//
// Khong dung MeetingPopup: khung chat phai cao het popup va tu cuon ben
// trong, khac han may popup kia von la mot chong muc xep doc.
export function MeetingChatDialog({
  conversationId,
  meetingId,
  laPhongTam,
  tenNhom,
  workspaceId,
  anhNhom,
  tenChuPhong,
  chuPhongId,
  anhChuPhong,
  onClose,
}: {
  conversationId: number | null;
  meetingId: number;
  laPhongTam: boolean;
  tenNhom: string | null;
  workspaceId: number | null;
  anhNhom: string | null;
  tenChuPhong: string;
  chuPhongId: number;
  anhChuPhong: string | null;
  onClose: () => void;
}) {
  return (
    <aside className="mpop mpop-chat" style={{ width: "min(calc(847px * var(--s)), 96vw)" }}>
      <header className="mpop-head mpop-head-chat">
        {laPhongTam || workspaceId === null ? (
          <Avatar userId={chuPhongId} nickname={tenChuPhong} avatarUpdatedAt={anhChuPhong} size={68} />
        ) : (
          <Avatar workspaceId={workspaceId} nickname={tenNhom ?? "Nhóm"} avatarUpdatedAt={anhNhom} size={68} />
        )}

        <span className="mpop-chat-ten">
          {laPhongTam || workspaceId === null ? (
            <>
              <b>Cuộc họp tạo ra bởi: {tenChuPhong}</b>
              <em>Tin nhắn tạm không lưu trữ và giới hạn 2gb gửi file</em>
            </>
          ) : (
            <b>{tenNhom ?? `Cuộc họp #${meetingId}`}</b>
          )}
        </span>

        <button type="button" className="mpop-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Đóng
        </button>
      </header>

      {conversationId === null ? (
        <p className="mpop-ghi-chu mpop-chat-trong">
          Cuộc họp này chưa có luồng thảo luận (mở trước khi tính năng chat trong phòng tuỳ chỉnh có mặt).
        </p>
      ) : (
        <>
          <div className="mpop-chat-than">
            {/* tuVaoNhom={false}: trang phong giu viec vao/roi nhom SignalR de
                dem tin chua doc - xem ghi chu o MeetingRoomPage. */}
            <MeetingDiscussion conversationId={conversationId} meetingId={meetingId} compact tuVaoNhom={false} />
          </div>
          <p className="mpop-chat-nhac">
            {laPhongTam
              ? "Chú ý: tin nhắn tạm, không mã hoá và không lưu trữ"
              : "Chú ý: tin nhắn thảo luận không mã hoá"}
          </p>
        </>
      )}
    </aside>
  );
}
