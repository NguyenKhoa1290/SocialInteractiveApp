import "./alert-dialog.css";

// Hop thoai chan ngang, dung cho nhung chuyen nguoi dung PHAI doc.
//
// Truoc day moi loi deu do vao mot dong <p className="chat-error"> nam lot
// giua trang - nguoi dung bam gui mot tep 120MB, bi tu choi, va dong chu bao
// vi sao thi nam o cho ho khong nhin. Nhung loi co HANH DONG DI KEM ("thu hoi
// bot tep", "nho Truong nhom nap them") thi phai chan lai bat doc.
//
// Van giu dong loi cu cho cac loi vat - khong phai cai gi cung dang chan
// ngang man hinh.
export function AlertDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="alert-overlay" onClick={onClose} role="presentation">
      <div
        className="alert-box"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <p>{message}</p>
        <button autoFocus onClick={onClose}>
          Đã hiểu
        </button>
      </div>
    </div>
  );
}
