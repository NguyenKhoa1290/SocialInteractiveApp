import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChatRoomPage } from "../chat/ChatRoomPage";
import { IconChatBubble } from "./MeetingIcons";
import { MeetingDiscussion } from "./MeetingDiscussion";

// Trang xem lai thao luan van giu phong chat o phia sau, con luong thao luan
// hien trong cung kieu popup voi luc dang o trong cuoc hop. Cach nay giu dung
// ngu canh nguoi dung vua mo tu cuoc tro chuyen nao va tren mobile popup van
// tu chuyen thanh layer toan man hinh theo luat chung cua `.mpop`.
export function MeetingDiscussionPage() {
  const { id, meetingId } = useParams();
  const navigate = useNavigate();
  const conversationId = Number(id);
  const mid = Number(meetingId);
  const [moTim, setMoTim] = useState(false);
  const [tim, setTim] = useState("");

  const dongPopup = useCallback(() => {
    navigate(`/app/chat/${conversationId}`, { replace: true });
  }, [conversationId, navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dongPopup();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dongPopup]);

  return (
    <>
      <ChatRoomPage />

      <div className="meeting-discussion-layer" role="presentation" onMouseDown={dongPopup}>
        <aside
          className="mpop mpop-chat meeting-discussion-popup"
          role="dialog"
          aria-modal="true"
          aria-labelledby="meeting-discussion-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="mpop-head mpop-head-chat">
            <span className="meeting-discussion-icon" aria-hidden="true">
              <IconChatBubble size={32} />
            </span>

            <span className="mpop-chat-ten">
              <b id="meeting-discussion-title">Thảo luận · Cuộc họp #{mid}</b>
              <em>Nội dung trao đổi sau cuộc họp</em>
            </span>

            <button
              type="button"
              className={`disc-icon${moTim ? " disc-icon-bat" : ""}`}
              onClick={() => {
                setMoTim((dangMo) => !dangMo);
                if (moTim) setTim("");
              }}
              title="Tìm trong thảo luận"
              aria-label="Tìm trong thảo luận"
              aria-expanded={moTim}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
                <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>

            <button type="button" className="mpop-close" onClick={dongPopup}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5l14 14M19 5 5 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
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
              <input value={tim} onChange={(event) => setTim(event.target.value)} placeholder="Tìm trong thảo luận" autoFocus />
            </label>
          )}

          <div className="mpop-chat-than">
            <MeetingDiscussion conversationId={conversationId} meetingId={mid} compact loc={tim} />
          </div>
          <p className="mpop-chat-nhac">Chú ý: tin nhắn thảo luận không mã hoá</p>
        </aside>
      </div>
    </>
  );
}
