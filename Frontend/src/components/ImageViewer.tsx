import { useCallback, useEffect } from "react";
import "./image-viewer.css";

// Popup xem anh/video phong to - thay cho viec mo URL tai ve o tab moi. Nen
// toi, anh nam giua vua khung, dong bang nen / Esc / nut X. Van giu nut "Tai
// ve" de nguoi muon luu tep khong mat duong.
//
// Nhan ca video vi luoi media o panel thong tin tron ca hai loai; anh la mac
// dinh. Voice khong di qua day - tin nhan tieng da co san thanh phat rieng.
export function ImageViewer({
  src,
  name,
  kind = "image",
  onClose,
}: {
  src: string;
  name?: string | null;
  kind?: "image" | "video";
  onClose: () => void;
}) {
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const truoc = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = truoc;
    };
  }, [close]);

  const ten = name ?? (kind === "video" ? "Video" : "Ảnh");

  return (
    <div
      className="iv-overlay"
      // onMouseDown chu khong onClick: keo chuot tu tren anh roi tha ra ngoai
      // khong duoc tinh la mot cu bam nen dong nham.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <button type="button" className="iv-close" onClick={close} aria-label="Đóng">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </button>

      <figure className="iv-figure" role="dialog" aria-modal="true" aria-label={ten}>
        {kind === "video" ? (
          <video className="iv-media" src={src} controls autoPlay playsInline />
        ) : (
          <img className="iv-media" src={src} alt={ten} />
        )}
        <figcaption className="iv-bar">
          <span className="iv-name" title={ten}>
            {ten}
          </span>
          <a className="iv-dl" href={src} download={name ?? undefined} target="_blank" rel="noreferrer noopener">
            Tải về
          </a>
        </figcaption>
      </figure>
    </div>
  );
}
