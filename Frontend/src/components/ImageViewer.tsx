import { useCallback, useEffect, useState } from "react";
import { nenTaiAnhNhieuLuong, taiAnhBaLuong } from "../lib/parallelImageDownload";
import "./image-viewer.css";

// Popup xem anh/video phong to. Anh lon duoc thu tai bang ba byte range;
// neu kho luu tru tu choi Range thi tu dong quay lai cach <img src> cu.
export function ImageViewer({
  src,
  name,
  kind = "image",
  sizeBytes,
  onClose,
}: {
  src: string;
  name?: string | null;
  kind?: "image" | "video";
  sizeBytes?: number;
  onClose: () => void;
}) {
  const close = useCallback(() => onClose(), [onClose]);
  const [anhDaGhep, setAnhDaGhep] = useState<string | null>(null);
  const [dangTaiNhieuLuong, setDangTaiNhieuLuong] = useState(false);

  useEffect(() => {
    if (kind !== "image" || !nenTaiAnhNhieuLuong(sizeBytes)) {
      setAnhDaGhep(null);
      setDangTaiNhieuLuong(false);
      return;
    }

    const controller = new AbortController();
    let huy = false;
    let objectUrl: string | null = null;
    setAnhDaGhep(null);
    setDangTaiNhieuLuong(true);

    void taiAnhBaLuong(src, sizeBytes, controller.signal, name)
      .then((ketQua) => {
        if (huy) {
          if (ketQua) URL.revokeObjectURL(ketQua);
          return;
        }
        objectUrl = ketQua;
        setAnhDaGhep(ketQua);
      })
      .catch(() => {
        // Dong viewer huy fetch la binh thuong. Loi tai khac lui ve <img src>.
      })
      .finally(() => {
        if (!huy) setDangTaiNhieuLuong(false);
      });

    return () => {
      huy = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, name, sizeBytes, src]);

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
  const mediaSrc = anhDaGhep ?? src;

  return (
    <div
      className="iv-overlay"
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
        ) : dangTaiNhieuLuong ? (
          <div className="iv-loading" role="status" aria-live="polite">
            Đang tải ảnh bằng 3 luồng…
          </div>
        ) : (
          <img className="iv-media" src={mediaSrc} alt={ten} />
        )}
        <figcaption className="iv-bar">
          <span className="iv-name" title={ten}>
            {ten}
          </span>
          {dangTaiNhieuLuong ? (
            <span className="iv-dl iv-dl-disabled">Đang tải…</span>
          ) : (
            <a className="iv-dl" href={mediaSrc} download={name ?? undefined} target="_blank" rel="noreferrer noopener">
              Tải về
            </a>
          )}
        </figcaption>
      </figure>
    </div>
  );
}
