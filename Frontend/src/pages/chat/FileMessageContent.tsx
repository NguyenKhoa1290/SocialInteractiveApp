import { useEffect, useRef, useState } from "react";
import { chatApi } from "../../api/chatApi";
import type { MessageType } from "../../types/chat";
import { ImageViewer } from "../../components/ImageViewer";
import "./file-message.css";

// Trinh phat file am thanh theo "Mau file am thanh dang phat" (Figma 154:2):
// nut tron teal play/pause + ten file, thay cho <audio controls> mac dinh cua
// trinh duyet. The <audio> that van o trong DOM (an, khong controls) de phat.
function AudioMessage({ url, name }: { url: string; name: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [dangTamDung, setDangTamDung] = useState(true);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  return (
    <div className="fm-audio">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setDangTamDung(false)}
        onPause={() => setDangTamDung(true)}
        onEnded={() => setDangTamDung(true)}
      />
      <button
        type="button"
        className="fm-audio-btn"
        onClick={toggle}
        title={dangTamDung ? "Phát" : "Tạm dừng"}
        aria-label={dangTamDung ? "Phát" : "Tạm dừng"}
      >
        {dangTamDung ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="7" y="5" width="3.4" height="14" rx="1.1" fill="currentColor" />
            <rect x="13.6" y="5" width="3.4" height="14" rx="1.1" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="fm-audio-name" title={name}>
        {name}
      </span>
    </div>
  );
}

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
  const [xemAnh, setXemAnh] = useState(false);

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
      <>
        {/* Van la mot <a> tro toi URL that: bam thuong mo popup xem, con
            Ctrl/giua chuot van mo tab moi nhu cu - khong chan thoi quen do. */}
        <a
          className="fm-media"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          title={ten}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            setXemAnh(true);
          }}
        >
          <img src={url} alt={ten} loading="lazy" />
          <span className="fm-media-name">{ten}</span>
        </a>
        {xemAnh && <ImageViewer src={url} name={ten} kind="image" onClose={() => setXemAnh(false)} />}
      </>
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
    return <AudioMessage url={url} name={ten} />;
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
