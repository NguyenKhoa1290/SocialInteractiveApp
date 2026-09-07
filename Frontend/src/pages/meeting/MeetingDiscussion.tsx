import { useEffect, useRef, useState } from "react";
import { chatApi } from "../../api/chatApi";
import type { UploadTracker } from "../../api/chatApi";
import { joinMeetingDiscussion, leaveMeetingDiscussion, onMeetingMessageEdited, onMeetingMessageReceived } from "../../lib/chatHub";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { FileMessageContent } from "../chat/FileMessageContent";
import type { Message, MessageType } from "../../types/chat";
import { UploadProgressBar, type UploadState } from "../../components/UploadProgressBar";
import { IconAttach, IconImage, IconSend } from "../chat/ComposerIcons";
import { doanLoaiMedia } from "../../lib/mediaKind";
import "./discussion.css";

const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VOICE_MAX_BYTES = 25 * 1024 * 1024;

// Luong thao luan cua 1 cuoc hop. Dung chung cho ca 2 cho: trang thao luan
// rieng (mo tu phong chat) va panel ben trong phong hop.
//
// KHAC han chat nhom: KHONG ma hoa - noi dung gui/nhan thang, khong can
// popup mat khau ma hoa, khong can nhap. Ly do: khach vang lai vao hop bang link
// khong co cap khoa nao. Xem MeetingDiscussionEndpoints.cs.
export function MeetingDiscussion({
  conversationId,
  meetingId,
  compact = false,
  tuVaoNhom = true,
  loc = "",
}: {
  conversationId: number;
  meetingId: number;
  compact?: boolean;
  // Chuoi loc tin nhan - o tim kiem nam tren dau popup (Figma 149:940), con
  // danh sach tin thi o day, nen loc truyen xuong duoi dang mot prop.
  loc?: string;
  // Co tu vao/roi nhom SignalR cua cuoc hop nay khong.
  //
  // Trang thao luan rieng thi CO - no la thu duy nhat dang mo. Panel trong
  // phong hop thi KHONG: trang phong da giu viec do de dem tin chua doc luc
  // panel dang dong, ma neu ca hai cung giu thi lan dong panel dau tien se
  // goi LeaveMeetingDiscussion, keo theo ca duong nghe cua trang.
  tuVaoNhom?: boolean;
}) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploading, setUploading] = useState<MessageType | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    let unsubEdited: (() => void) | undefined;

    async function setup() {
      try {
        const res = await chatApi.getMeetingMessages(conversationId, meetingId);
        if (cancelled) return;
        setMessages([...res.data].reverse());

        if (tuVaoNhom) await joinMeetingDiscussion(conversationId, meetingId);
        unsub = await onMeetingMessageReceived((msg) => {
          // Tin cua chinh minh da duoc them ngay luc gui (phan hoi cua POST)
          // - bo qua ban echo de khong hien 2 lan.
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        });
        unsubEdited = await onMeetingMessageEdited((msg) => {
          // Sua tin khong phai tin moi: chi thay ban ghi dang co, tranh tao
          // mot ban sao neu ket noi SignalR vao lai muon.
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
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
      unsubEdited?.();
      if (tuVaoNhom) leaveMeetingDiscussion(meetingId).catch(() => {});
    };
  }, [conversationId, meetingId, tuVaoNhom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await chatApi.sendMeetingText(conversationId, meetingId, text.trim(), replyTo?.id);
      setMessages((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
      setText("");
      setReplyTo(null);
    } catch (err) {
      setError(extractApiError(err, "Không gửi được tin nhắn"));
    } finally {
      setSending(false);
    }
  }

  function tomTat(m: Message) {
    if (m.isDeleted) return "Tin nhắn đã được thu hồi";
    if (m.type === "text") return m.content || "Tin nhắn";
    return m.type === "image" ? "Hình ảnh" : m.type === "video" ? "Video" : m.type === "voice" ? "Tin nhắn âm thanh" : "Tệp đính kèm";
  }

  function nhayToi(messageId: number) {
    const target = document.getElementById(`disc-message-${messageId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.classList.remove("disc-flash");
    requestAnimationFrame(() => target?.classList.add("disc-flash"));
  }

  function startEdit(m: Message) {
    setReplyTo(null);
    setEditingId(m.id);
    setEditText(m.content ?? "");
  }

  async function handleSaveEdit(m: Message) {
    const content = editText.trim();
    if (!content || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await chatApi.editMeetingText(conversationId, meetingId, m.id, content);
      setMessages((prev) => prev.map((x) => (x.id === res.data.id ? res.data : x)));
      setEditingId(null);
      setEditText("");
    } catch (err) {
      setError(extractApiError(err, "Khong the sua tin nhan (co the da qua 15 phut)"));
    } finally {
      setSavingEdit(false);
    }
  }

  // Nut tep chung (kep giay): loai co dinh la "file".
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video" | "voice" | "file") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void guiTep(file, type);
  }

  // Nut media gop: tu doan anh / video / am thanh tu chinh tep. accept chi la
  // goi y nen phai kiem lai va bao neu khong nhan dang duoc.
  function handleMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const loai = doanLoaiMedia(file);
    if (!loai) {
      setError("Chỉ gửi được ảnh, video hoặc âm thanh ở nút này.");
      return;
    }
    void guiTep(file, loai);
  }

  async function guiTep(file: File, type: "image" | "video" | "voice" | "file") {
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
    // Phien theo doi phu ca ba buoc - xem ghi chu o ChatRoomPage.
    let track: UploadTracker | null = null;
    try {
      // Truyen meetingId de server kiem tra quyen theo nhanh "dang o trong
      // cuoc hop" (khach vang lai khong thuoc nhom). File VAN tinh vao han
      // muc 2GB cua nhom.
      const { data: urlRes } = await chatApi.requestUploadUrl(conversationId, type, file.size, meetingId, file.name);
      track = chatApi.trackUpload(urlRes);
      await chatApi.uploadFile(
        urlRes,
        file,
        (loaded, total) => setUpload({ name: file.name, loaded, total }),
        track,
      );
      // Backend HEAD kich thuoc that cho ca upload mot lan va multipart
      // truoc khi cho phep gan tep vao thao luan.
      await chatApi.completeUpload(urlRes.fileId, urlRes.uploadId);
      const res = await chatApi.sendMeetingFile(conversationId, meetingId, type, urlRes.fileId);
      setMessages((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
    } catch (err) {
      if (track) void track.abort();
      setError(extractApiError(err, "Không gửi được tệp"));
    } finally {
      track?.stop();
      setUploading(null);
      setUpload(null);
    }
  }

  return (
    <div className={`disc${compact ? " disc-compact" : ""}`}>
      <div className="disc-messages">
        {loading && <p className="disc-empty">Đang tải…</p>}
        {!loading && messages.length === 0 && <p className="disc-empty">Chưa có nội dung nào trong thảo luận.</p>}

        {messages
          .filter((m) => {
            const q = loc.trim().toLowerCase();
            if (!q) return true;
            return (m.content ?? "").toLowerCase().includes(q) ||
              (m.senderDisplayName ?? "").toLowerCase().includes(q);
          })
          .map((m) => {
          const mine = m.senderId === currentUserId;
          const reply = m.replyToId != null ? messages.find((x) => x.id === m.replyToId) : undefined;
          const canReply = !m.isDeleted;
          const canEdit = mine && m.type === "text" && !m.isDeleted;
          return (
            <div key={m.id} id={`disc-message-${m.id}`} className={`disc-row${mine ? " mine" : ""}`}>
              {m.replyToId != null && (
                <button
                  type="button"
                  className="disc-quote"
                  onClick={() => nhayToi(m.replyToId!)}
                  title="Tới tin nhắn gốc"
                >
                  <span className="disc-quote-who">{reply?.senderDisplayName ?? (reply?.senderId === currentUserId ? "Bạn" : "Tin nhắn")}</span>
                  <span className="disc-quote-text">{reply ? tomTat(reply) : "Tin nhắn cũ"}</span>
                </button>
              )}
              <div className="disc-bubble">
                {!mine && <div className="disc-sender">{m.senderDisplayName ?? `Người dùng ${m.senderId}`}</div>}
                {m.isDeleted ? (
                  <em className="disc-deleted">(đã xoá)</em>
                ) : editingId === m.id ? (
                  <div className="disc-edit">
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveEdit(m);
                        }
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setEditText("");
                        }
                      }}
                      disabled={savingEdit}
                      aria-label="Nội dung tin nhắn"
                    />
                    <div className="disc-edit-actions">
                      <button type="button" className="disc-act" onClick={() => void handleSaveEdit(m)} disabled={savingEdit || !editText.trim()}>
                        Lưu
                      </button>
                      <button type="button" className="disc-act" onClick={() => { setEditingId(null); setEditText(""); }} disabled={savingEdit}>
                        Hủy
                      </button>
                    </div>
                  </div>
                ) : m.type === "text" ? (
                  <>
                    {m.content}
                    {m.isEdited && <span className="disc-edited"> (đã sửa)</span>}
                  </>
                ) : m.fileId != null ? (
                  <FileMessageContent fileId={m.fileId} type={m.type} />
                ) : (
                  <em className="disc-deleted">(tệp không còn)</em>
                )}
                <div className="disc-time">{new Date(m.createdAt).toLocaleTimeString("vi-VN")}</div>
              </div>
              {(canReply || canEdit) && editingId !== m.id && (
                <div className="disc-acts">
                  {canReply && <button type="button" className="disc-act" onClick={() => { setEditingId(null); setReplyTo(m); }}>Trả lời</button>}
                  {canEdit && <button type="button" className="disc-act" onClick={() => startEdit(m)}>Sửa</button>}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <p className="disc-error">{error}</p>}

      {replyTo && (
        <div className="disc-reply-bar">
          <span className="disc-reply-label">Đang trả lời</span>
          <span className="disc-reply-text">{tomTat(replyTo)}</span>
          <button type="button" className="disc-reply-x" onClick={() => setReplyTo(null)} aria-label="Bỏ trả lời">
            ×
          </button>
        </div>
      )}

      {/* MOT dai duy nhat: o nhap + bon nut dinh kem + nut gui, dung theo
          Frame 38 cua thiet ke. Ban cu la mot form rieng cong mot hang nhan
          emoji rieng ben duoi - hai tang chiem gap doi chieu cao. */}
      <form className="disc-compose" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="Nhập tin nhắn"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />

        {/* Mot nut chung cho anh / video / am thanh - tu doan loai tu tep. Nut
            kep giay (Tep) van rieng cho tai lieu thuong. */}
        <label className="disc-icon" title="Gửi ảnh, video hoặc âm thanh">
          <IconImage />
          <input type="file" accept="image/*,video/*,audio/*" hidden onChange={handleMedia} />
        </label>
        <label className="disc-icon" title="Tệp">
          <IconAttach />
          <input type="file" hidden onChange={(e) => handleUpload(e, "file")} />
        </label>

        <button type="submit" className="disc-icon disc-gui" disabled={sending || !text.trim()} title="Gửi">
          <IconSend />
        </button>
      </form>

      {(upload || uploading) && (
        <div className="disc-tien">
          {upload ? <UploadProgressBar state={upload} /> : <span className="disc-empty">Đang tải lên…</span>}
        </div>
      )}
      <p className="disc-note">
        Thảo luận không mã hoá đầu cuối (để khách mời tham gia được). Tệp đính kèm tính vào dung lượng của nhóm.
      </p>
    </div>
  );
}
