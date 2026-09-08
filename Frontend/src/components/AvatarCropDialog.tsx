import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cropAvatar, type AvatarCrop } from "../lib/imageResize";
import { Modal } from "./Modal";
import "./avatar-crop.css";

type Dimensions = { width: number; height: number };
type Drag = { pointerId: number; clientX: number; clientY: number; crop: AvatarCrop };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

// Khung cat vuong dung chung cho anh dai dien ca nhan va anh nhom. Crop duoc
// luu bang pixel cua anh goc, con khung xem truoc chi la cach ve no ra man
// hinh - vi vay keo/zoom tren dien thoai va desktop cho cung mot ket qua.
export function AvatarCropDialog({
  file,
  title = "Chọn vùng ảnh",
  onClose,
  onCropped,
}: {
  file: File;
  title?: string;
  onClose: () => void;
  onCropped: (blob: Blob) => void | Promise<void>;
}) {
  const imageUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [crop, setCrop] = useState<AvatarCrop | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const minSide = dimensions ? Math.min(dimensions.width, dimensions.height) : 0;
  // Khong cho phong qua muc nay: crop nho hon 128px thuong vo hat khi dung
  // lam avatar. Anh nho hon thi van cho phep dung nguyen do phan giai cua no.
  const maxZoom = minSide > 0 ? Math.max(1, minSide / Math.min(128, minSide)) : 1;
  const zoom = crop && minSide > 0 ? minSide / crop.size : 1;

  function setZoom(nextZoom: number) {
    if (!dimensions || !crop) return;
    const size = minSide / clamp(nextZoom, 1, maxZoom);
    const centerX = crop.x + crop.size / 2;
    const centerY = crop.y + crop.size / 2;
    setCrop({
      size,
      x: clamp(centerX - size / 2, 0, dimensions.width - size),
      y: clamp(centerY - size / 2, 0, dimensions.height - size),
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!crop || processing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, crop };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !stage || !dimensions) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Keo anh sang phai nghia la vung cat di sang trai tren anh goc.
    const x = clamp(drag.crop.x - ((e.clientX - drag.clientX) * drag.crop.size) / rect.width, 0, dimensions.width - drag.crop.size);
    const y = clamp(drag.crop.y - ((e.clientY - drag.clientY) * drag.crop.size) / rect.height, 0, dimensions.height - drag.crop.size);
    setCrop({ ...drag.crop, x, y });
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  async function confirm() {
    if (!crop || processing) return;
    setError(null);
    setProcessing(true);
    try {
      const { blob } = await cropAvatar(file, crop);
      await onCropped(blob);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xử lý được ảnh này");
    } finally {
      setProcessing(false);
    }
  }

  return createPortal(
    <Modal title={title} onClose={processing ? () => {} : onClose} width={660}>
      <p className="ac-help">Kéo ảnh để chọn phần hiển thị. Dùng thanh trượt để phóng to hoặc thu nhỏ.</p>

      <div
        ref={stageRef}
        className={`ac-stage${crop ? " ac-ready" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          className="ac-image"
          src={imageUrl}
          alt="Ảnh đang chọn để cắt"
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
            if (width <= 0 || height <= 0) {
              setError("Không đọc được kích thước ảnh");
              return;
            }
            const size = Math.min(width, height);
            setDimensions({ width, height });
            setCrop({ x: (width - size) / 2, y: (height - size) / 2, size });
          }}
          onError={() => setError("Không mở được tệp ảnh này")}
          style={
            dimensions && crop
              ? {
                  width: `${(dimensions.width / crop.size) * 100}%`,
                  height: `${(dimensions.height / crop.size) * 100}%`,
                  left: `${-(crop.x / crop.size) * 100}%`,
                  top: `${-(crop.y / crop.size) * 100}%`,
                }
              : undefined
          }
        />
        <span className="ac-grid" aria-hidden="true" />
      </div>

      {dimensions && crop && (
        <label className="ac-zoom">
          <span>Thu nhỏ</span>
          <input
            type="range"
            min="1"
            max={maxZoom}
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={processing}
            aria-label="Phóng to hoặc thu nhỏ vùng ảnh"
          />
          <span>Phóng to</span>
        </label>
      )}

      {error && <p className="ac-error" role="alert">{error}</p>}

      <div className="ac-actions">
        <button type="button" className="md-btn md-btn-ghost" onClick={onClose} disabled={processing}>
          Hủy
        </button>
        <button type="button" className="md-btn" onClick={() => void confirm()} disabled={!crop || processing}>
          {processing ? "Đang xử lý…" : "Dùng ảnh này"}
        </button>
      </div>
    </Modal>,
    document.body,
  );
}
