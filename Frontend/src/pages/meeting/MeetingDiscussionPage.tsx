import { Link, useParams } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { MeetingDiscussion } from "./MeetingDiscussion";

// Trang thao luan mo tu phong chat (nut "Xem thao luan" tren the cuoc hop).
// Van boc AppShell vi day la man hinh doc noi dung binh thuong, khong phai
// dang trong cuoc goi.
export function MeetingDiscussionPage() {
  const { id, meetingId } = useParams();
  const conversationId = Number(id);
  const mid = Number(meetingId);

  return (
    <AppShell>
      <Link to={`/app/chat/${conversationId}`} className="chat-back-link">
        ← Về phòng chat
      </Link>
      <h2>Thảo luận · Cuộc họp #{mid}</h2>
      <MeetingDiscussion conversationId={conversationId} meetingId={mid} />
    </AppShell>
  );
}
