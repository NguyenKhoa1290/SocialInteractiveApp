import { useEffect, useState } from "react";
import { chatApi } from "../../api/chatApi";
import type { MessageType } from "../../types/chat";

// URL tai (presign GET) het han sau 300s (xem FileEndpoints.cs) - lay lai
// MOI LAN component mount thay vi luu tinh, tranh hien <img> voi link da
// het han sau vai phut ngoi xem lai lich su chat.
export function FileMessageContent({ fileId, type }: { fileId: number; type: MessageType }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    chatApi
      .getDownloadUrl(fileId)
      .then((res) => setUrl(res.data.uploadUrl))
      .catch(() => setError(true));
  }, [fileId]);

  if (error) return <span className="chat-file-error">Không tải được file</span>;
  if (!url) return <span className="chat-file-loading">Đang tải...</span>;

  if (type === "image") return <img src={url} alt="" className="chat-msg-image" />;
  if (type === "video") return <video src={url} controls className="chat-msg-video" />;
  if (type === "voice") return <audio src={url} controls className="chat-msg-audio" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="chat-file-link">
      📎 Tải file
    </a>
  );
}
