import { useEffect, useState } from "react";
import { chatApi } from "../../api/chatApi";
import type { MessageType } from "../../types/chat";

function humanSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// URL tai (presign GET) het han sau 300s (xem FileEndpoints.cs) - lay lai
// MOI LAN component mount thay vi luu tinh, tranh hien <img> voi link da
// het han sau vai phut ngoi xem lai lich su chat.
//
// Endpoint do gio tra ve luon TEN GOC va KICH THUOC, nen khong ton them mot
// vong goi nao de hien hai thu do. (Ten file khong nam trong DTO tin nhan:
// nhet vao do thi phai doi ca hinh dang cache Redis, ma client thi da goi
// endpoint nay moi lan hien file roi.)
export function FileMessageContent({ fileId, type }: { fileId: number; type: MessageType }) {
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [size, setSize] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    chatApi
      .getDownloadUrl(fileId)
      .then((res) => {
        setUrl(res.data.uploadUrl);
        setName(res.data.fileName ?? null);
        setSize(res.data.sizeBytes ?? 0);
      })
      .catch(() => setError(true));
  }, [fileId]);

  if (error) return <span className="chat-file-error">Không tải được file</span>;
  if (!url) return <span className="chat-file-loading">Đang tải...</span>;

  // File gui TRUOC khi co cot file_name thi khong co ten - lui ve chu chung
  // thay vi hien mot dong trong.
  const label = name ?? "Tải file";
  const sizeText = humanSize(size);

  // Anh/video/tieng: ten + dung luong nam duoi, khong che mat noi dung.
  if (type === "image" || type === "video" || type === "voice") {
    return (
      <span className="chat-file-media">
        {type === "image" && <img src={url} alt={name ?? ""} className="chat-msg-image" />}
        {type === "video" && <video src={url} controls className="chat-msg-video" />}
        {type === "voice" && <audio src={url} controls className="chat-msg-audio" />}
        <a href={url} target="_blank" rel="noreferrer" className="chat-file-meta" title={label}>
          {label}
          {sizeText && ` · ${sizeText}`}
        </a>
      </span>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="chat-file-link" title={label}>
      📎 {label}
      {sizeText && <span className="chat-file-size"> · {sizeText}</span>}
    </a>
  );
}
