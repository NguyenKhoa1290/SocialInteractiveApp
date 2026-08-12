import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";

// UC: tai khoan bi khoa (spam) khi dang nhap -> dieu huong sang day. Khung
// khieu nai thuc su (goi /complaints/messages) thuoc F4, o day chi dieu
// huong dung route - noi dung chi tiet lam sau.
export function AccountLockedPage() {
  return (
    <AuthLayout title="Tài khoản đang bị khoá">
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Tài khoản của bạn đang bị khoá do vi phạm chính sách chống spam. Bạn vẫn có thể gửi khiếu nại
        để được xem xét lại.
      </p>
      <Link to="/complaints" className="auth-footer" style={{ display: "block", marginTop: 16 }}>
        Gửi khiếu nại (sẽ hoàn thiện ở giai đoạn F4)
      </Link>
      <Link to="/login" className="auth-footer" style={{ display: "block", marginTop: 12 }}>
        Quay lại đăng nhập
      </Link>
    </AuthLayout>
  );
}
