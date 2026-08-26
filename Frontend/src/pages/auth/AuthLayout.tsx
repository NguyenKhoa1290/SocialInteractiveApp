import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import wordmark from "../../assets/calli/calli-wordmark.svg";
import "./auth.css";

// Khung popup dang nhap / dang ky / quen mat khau...
//
// Ban thiet ke ve chung la POPUP chong len trang chu (co san nut "X Dong"),
// khong phai trang rieng - nen o day la mot lop phu, con trang chu van duoc
// dung day du ben duoi. Dia chi /login, /register van la duong dan that: chia
// se duoc, F5 duoc, va nut Dong tra ve trang chu.
export function AuthLayout({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  // Mac dinh dong la ve trang chu. Truyen vao de doi (vi du man "tai khoan bi
  // khoa" thi dong nen quay ra dang nhap chu khong phai trang chu).
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  // Phai boc useCallback: neu khong, `close` la mot ham moi sau MOI lan
  // render, nen useEffect ben duoi go rooi gan lai bat su kien va ghi de
  // body.overflow lien tuc - vua thua vua de sai khi khoi phuc gia tri cu.
  const close = useCallback(() => {
    if (onClose) onClose();
    else navigate("/");
  }, [onClose, navigate]);

  // Esc de dong, va khoa cuon cua trang ben duoi trong luc popup mo - neu
  // khong, lan chuot se cuon trang chu phia sau thay vi noi dung popup.
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
      className="auth-overlay"
      // Bam vao nen mo thi dong, nhung CHI khi bam dung vao nen: khong dung
      // onClick thuong, vi mot cu keo chon chu trong o nhap roi tha tay ra
      // ngoai cung se tinh la click va lam bay ca form dang go do.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="auth-card" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="auth-close" onClick={close}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 5l14 14M19 5L5 19"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </svg>
          Đóng
        </button>

        <img className="auth-logo" src={wordmark} alt="Calli" />
        <h1 className="auth-title">{title}</h1>

        {children}
      </div>
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="auth-error">{message}</p>;
}

// Nhan cua mot nhom truong ("Dang nhap bang email") - 16px w700, can trai.
export function FieldGroupLabel({ children }: { children: ReactNode }) {
  return <p className="auth-group-label">{children}</p>;
}
