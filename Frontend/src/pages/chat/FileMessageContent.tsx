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

// Bieu tuong tai ve trong vong tron 68px nen #85AEB0 - Figma node 111:539.
function IconDownload() {
  return (
    <svg width="26" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 2.4h2.4v10.2l3.5-3.5 1.7 1.7-6.4 6.4-6.4-6.4 1.7-1.7 3.5 3.5V2.4Z" />
      <path d="M3.4 18.2h17.2v3.4H3.4z" />
    </svg>
  );
}

// URL tai (presign GET) het han sau mot khoang - lay lai MOI LAN component
// mount thay vi luu tinh, tranh hien <img> voi link da het han sau vai phut
// ngoi xem lai lich su chat.
//
// Endpoint do tra ve luon TEN GOC va KICH THUOC nen khong ton them vong goi
// nao de hien hai thu do.
export function FileMessageContent({ fileId, type }: { fileId: number; type: MessageType }) {
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [size, setSize] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let huy = false;
    chatApi
      .getDownloadUrl(fileId)
      .then((res) => {
        if (huy) return;
        setUrl(res.data.uploadUrl);
        setName(res.data.fileName ?? null);
        setSize(res.data.sizeBytes ?? 0);
      })
      .catch(() => {
        if (!huy) setError(true);
      });
    return () => {
      huy = true;
    };
  }, [fileId]);

  if (error) return <span className="fm-note">Không tải được tệp</span>;
  if (!url) return <span className="fm-note">Đang tải…</span>;

  // Tep gui TRUOC khi co cot file_name thi khong co ten - lui ve chu chung
  // thay vi hien mot dong trong.
  const ten = name ?? "Tệp đính kèm";
  const dungLuong = humanSize(size);

  // Anh/video/tieng: khung 388 rong nhu thiet ke, nhung CO GIAN THEO TY LE
  // that cua anh chu khong cat cung 388x226 - anh doc va anh chup man hinh se
  // bi cat mat dau duoi neu ep khung.
  if (type === "image") {
    return (
      <a className="fm-media" href={url} target="_blank" rel="noreferrer noopener" title={ten}>
        <img src={url} alt={ten} loading="lazy" />
        <span className="fm-media-name">{ten}</span>
      </a>
    );
  }

  if (type === "video") {
    return (
      <span className="fm-media">
        <video src={url} controls preload="metadata" />
        <span className="fm-media-name">{ten}</span>
      </span>
    );
  }

  if (type === "voice") {
    return (
      <span className="fm-media fm-voice">
        <audio src={url} controls />
        <span className="fm-media-name">{ten}</span>
      </span>
    );
  }

  // Tep thuong: khuon the giong hang danh sach (Figma node 111:539) - vong
  // tron 68px co mui ten tai ve, ten tep 20px w400, dung luong 20px w200.
  return (
    <a className="fm-file" href={url} target="_blank" rel="noreferrer noopener" title={ten}>
      <span className="fm-file-icon">
        <IconDownload />
      </span>
      <span className="fm-file-body">
        <span className="fm-file-name">{ten}</span>
        <span className="fm-file-sub">{dungLuong}</span>
      </span>
    </a>
  );
}

// Tin nhan tep DANG TAI LEN - Figma node 111:533.
//
// Hien nhu mot tin nhan that trong danh sach chu khong phai mot thanh rieng o
// duoi: nguoi dung thay ngay tep cua minh dang o dau trong mach hoi thoai.
// Kem nut "Huy" de dung giua chung - bam la tra lai dung luong ngay.
export function UploadingMessage({
  name,
  loaded,
  total,
  onCancel,
}: {
  name: string;
  loaded: number;
  total: number;
  onCancel?: () => void;
}) {
  const phanTram = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div className="fm-file fm-file-uploading">
      <span className="fm-file-icon" aria-hidden="true">
        <span className="fm-spin" style={{ ["--p" as string]: `${phanTram}%` }} />
      </span>
      <span className="fm-file-body">
        <span className="fm-file-name">{name}</span>
        <span className="fm-file-sub">
          Đang tải lên ({humanSize(loaded)}/{humanSize(total)})
        </span>
      </span>
      {onCancel && (
        <button type="button" className="cw-act fm-cancel" onClick={onCancel}>
          Hủy
        </button>
      )}
    </div>
  );
}
