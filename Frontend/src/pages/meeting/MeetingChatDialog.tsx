import { useState } from "react";
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
  // O tim kiem tren dau popup (Figma 149:940 co bieu tuong kinh lup o goc
  // phai). Loc THAT tren danh sach tin da tai - khong dung nut chet.
  const [moTim, setMoTim] = useState(false);
  const [tim, setTim] = useState("");

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

        <button
          type="button"
          className={`disc-icon${moTim ? " disc-icon-bat" : ""}`}
          onClick={() => {
            setMoTim((v) => !v);
            if (moTim) setTim("");
          }}
          title="Tìm trong thảo luận"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
            <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>

        <button type="button" className="mpop-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Đóng
        </button>
      </header>

      {moTim && (
        <label className="mpop-tim mpop-tim-chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
            <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <input value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm trong thảo luận" autoFocus />
        </label>
      )}

      {conversationId === null ? (
        <p className="mpop-ghi-chu mpop-chat-trong">
          Cuộc họp này chưa có luồng thảo luận (mở trước khi tính năng chat trong phòng tuỳ chỉnh có mặt).
        </p>
      ) : (
        <>
          <div className="mpop-chat-than">
            {/* tuVaoNhom={false}: trang phong giu viec vao/roi nhom SignalR de
                dem tin chua doc - xem ghi chu o MeetingRoomPage. */}
            <MeetingDiscussion
              conversationId={conversationId}
              meetingId={meetingId}
              compact
              tuVaoNhom={false}
              loc={tim}
            />
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
