import { Link } from "react-router-dom";

// Tin nhan he thong trong luong chat chinh.
//
// Truoc day nhanh render cuoi cung la `[{m.type}]`, nen tin he thong hien ra
// dung chu "[system]" va noi dung KHONG BAO GIO duoc hien - du no nam san
// trong m.content (tin he thong khong ma hoa E2EE).
//
// Rieng su kien "mo cuoc hop" thi Media Service gui JSON co cau truc kem
// meetingId, nen dung duoc mot the co nut bam thay vi mot dong chu chet.
interface MeetingStartedPayload {
  kind: "meeting_started";
  meetingId: number;
  host?: string;
  text?: string;
}

function parsePayload(content: string | null): MeetingStartedPayload | null {
  if (!content) return null;
  // Tin he thong cu (va moi noi dung khong phai JSON) van chay qua day binh
  // thuong - khong duoc de mot ban ghi cu lam vo ca khung chat.
  if (!content.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(content) as MeetingStartedPayload;
    return parsed?.kind === "meeting_started" && typeof parsed.meetingId === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function SystemMessage({
  content,
  conversationId,
  activeMeetingId,
  onJoin,
}: {
  content: string | null;
  conversationId: number;
  // Cuoc hop dang mo cua hoi thoai nay (null = khong con ai hop). Dung de
  // quyet dinh co hien nut "Vao hop" hay khong.
  activeMeetingId: number | null;
  onJoin: () => void;
}) {
  const payload = parsePayload(content);

  if (!payload) return <span className="chat-system-text">{content ?? ""}</span>;

  const stillOpen = activeMeetingId === payload.meetingId;

  return (
    <div className="chat-system-card">
      <div className="chat-system-card-head">
        <span>📹 {payload.host ? `${payload.host} đã mở cuộc họp` : "Cuộc họp"}</span>
        <span className={stillOpen ? "chat-system-badge open" : "chat-system-badge"}>
          {stillOpen ? "Đang diễn ra" : "Đã kết thúc"}
        </span>
      </div>

      <div className="chat-system-card-actions">
        {stillOpen && <button onClick={onJoin}>Vào họp</button>}
        {/* Thao luan van vao duoc SAU KHI hop ket thuc, va van nhan tiep
            duoc - ke ca khi trong hop khong ai nhan gi (trang se trong).
            Thanh vien nhom luon co quyen, xem MeetingDiscussionEndpoints. */}
        <Link to={`/app/chat/${conversationId}/meetings/${payload.meetingId}`}>Thảo luận</Link>
      </div>
    </div>
  );
}
