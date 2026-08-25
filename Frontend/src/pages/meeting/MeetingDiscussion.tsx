import { useEffect, useRef, useState } from "react";
import { chatApi } from "../../api/chatApi";
import { joinMeetingDiscussion, leaveMeetingDiscussion, onMeetingMessageReceived } from "../../lib/chatHub";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { FileMessageContent } from "../chat/FileMessageContent";
import type { Message, MessageType } from "../../types/chat";
import { UploadProgressBar, type UploadState } from "../../components/UploadProgressBar";
import "./discussion.css";

const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VOICE_MAX_BYTES = 25 * 1024 * 1024;

// Luong thao luan cua 1 cuoc hop. Dung chung cho ca 2 cho: trang thao luan
// rieng (mo tu phong chat) va panel ben trong phong hop.
//
// KHAC han chat nhom: KHONG ma hoa - noi dung gui/nhan thang, khong can
// E2eeGate, khong can nhap PIN. Ly do: khach vang lai vao hop bang link
// khong co cap khoa nao. Xem MeetingDiscussionEndpoints.cs.
export function MeetingDiscussion({
  conversationId,
  meetingId,
  compact = false,
}: {
  conversationId: number;
  meetingId: number;
  compact?: boolean;
}) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<MessageType | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    async function setup() {
      try {
        const res = await chatApi.getMeetingMessages(conversationId, meetingId);
        if (cancelled) return;
        setMessages([...res.data].reverse());

        await joinMeetingDiscussion(conversationId, meetingId);
        unsub = await onMeetingMessageReceived((msg) => {
          // Tin cua chinh minh da duoc them ngay luc gui (phan hoi cua POST)
          // - bo qua ban echo de khong hien 2 lan.
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        });
      } catch (err) {
        if (!cancelled) setError(extractApiError(err, "Không tải được thảo luận"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setup();
    return () => {
      cancelled = true;
      unsub?.();
      leaveMeetingDiscussion(meetingId).catch(() => {});
    };
  }, [conversationId, meetingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await chatApi.sendMeetingText(conversationId, meetingId, text.trim());
      setMessages((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
      setText("");
    } catch (err) {
      setError(extractApiError(err, "Không gửi được tin nhắn"));
    } finally {
      setSending(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video" | "voice" | "file") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (type === "video" && file.size > VIDEO_MAX_BYTES) {
      setError("Video vượt quá 50MB");
      return;
    }
    if (type === "voice" && file.size > VOICE_MAX_BYTES) {
      setError("File ghi âm vượt quá 25MB");
      return;
    }

    setUploading(type as MessageType);
    setUpload({ name: file.name, loaded: 0, total: file.size });
    setError(null);
    try {
      // Truyen meetingId de server kiem tra quyen theo nhanh "dang o trong
      // cuoc hop" (khach vang lai khong thuoc nhom). File VAN tinh vao han
      // muc 2GB cua nhom.
      const { data: urlRes } = await chatApi.requestUploadUrl(conversationId, type, file.size, meetingId, file.name);
      await chatApi.uploadFile(urlRes, file, (loaded, total) =>
        setUpload({ name: file.name, loaded, total }),
      );
      if (urlRes.uploadId) await chatApi.completeUpload(urlRes.fileId, urlRes.uploadId);
      const res = await chatApi.sendMeetingFile(conversationId, meetingId, type, urlRes.fileId);
      setMessages((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
    } catch (err) {
      setError(extractApiError(err, "Không gửi được tệp"));
    } finally {
      setUploading(null);
      setUpload(null);
    }
  }

  return (
    <div className={`disc${compact ? " disc-compact" : ""}`}>
      <div className="disc-messages">
        {loading && <p className="disc-empty">Đang tải…</p>}
        {!loading && messages.length === 0 && <p className="disc-empty">Chưa có nội dung nào trong thảo luận.</p>}

        {messages.map((m) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id} className={`disc-row${mine ? " mine" : ""}`}>
              <div className="disc-bubble">
                {!mine && <div className="disc-sender">{m.senderDisplayName ?? `Người dùng ${m.senderId}`}</div>}
                {m.isDeleted ? (
                  <em className="disc-deleted">(đã xoá)</em>
                ) : m.type === "text" ? (
                  m.content
                ) : m.fileId != null ? (
                  <FileMessageContent fileId={m.fileId} type={m.type} />
                ) : (
                  <em className="disc-deleted">(tệp không còn)</em>
                )}
                <div className="disc-time">{new Date(m.createdAt).toLocaleTimeString("vi-VN")}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <p className="disc-error">{error}</p>}

      <form className="disc-compose" onSubmit={handleSend}>
        <input
          placeholder="Nhắn trong thảo luận…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !text.trim()}>
          Gửi
        </button>
      </form>

      <div className="disc-attach">
        <label>
          🖼 Ảnh
          <input type="file" accept="image/*" hidden onChange={(e) => handleUpload(e, "image")} />
        </label>
        <label>
          🎬 Video
          <input type="file" accept="video/*" hidden onChange={(e) => handleUpload(e, "video")} />
        </label>
        <label>
          🎤 Ghi âm
          <input type="file" accept="audio/*" hidden onChange={(e) => handleUpload(e, "voice")} />
        </label>
        <label>
          📎 Tệp
          <input type="file" hidden onChange={(e) => handleUpload(e, "file")} />
        </label>
        {upload ? (
          <UploadProgressBar state={upload} />
        ) : (
          uploading && <span className="disc-empty">Đang tải lên…</span>
        )}
      </div>
      <p className="disc-note">
        Thảo luận không mã hoá đầu cuối (để khách mời tham gia được). Tệp đính kèm tính vào dung lượng của nhóm.
      </p>
    </div>
  );
}
