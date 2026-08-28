import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import "./modal.css";

// Khuon popup dung trong app (Figma node 111:307 "Thong tin Mini APP Popup"):
// nen trang, bo goc 37, "X Dong" goc tren ben phai, tieu de 36px w700.
//
// Khac popup dang nhap o cho khong co logo - popup trong app la mot hop thoai
// cua mot man dang mo, khong phai mot cua vao san pham.
export function Modal({
  title,
  onClose,
  children,
  width = 589,
  ariaLabel,
}: {
  // Chuoi rong = KHONG co dong tieu de. Hai popup Mini App (node 111:307 va
  // 112:695) mo dau bang bieu tuong app chu khong bang mot dong chu 36px -
  // de o tieu de rong van chiem cho thi popup thut xuong mot khoang trong.
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  // Bat buoc khi title rong: hop thoai nao cung phai co mot cai ten cho trinh
  // doc man hinh.
  ariaLabel?: string;
}) {
  // Boc useCallback: neu khong, `close` la ham moi sau moi lan render nen
  // useEffect ben duoi go rooi gan lai bat su kien lien tuc.
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

  return (
    <div
      className="md-overlay"
      // onMouseDown chu khong onClick: mot cu keo chon chu ben trong roi tha
      // tay ra ngoai cung tinh la click va se dong mat hop thoai.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="md-card"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        style={{ width: `calc(${width}px * var(--s))` }}
      >
        <button type="button" className="md-close" onClick={close}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          Đóng
        </button>

        {title !== "" && <h2 className="md-title">{title}</h2>}
        <div className="md-body">{children}</div>
      </div>
    </div>
  );
}
