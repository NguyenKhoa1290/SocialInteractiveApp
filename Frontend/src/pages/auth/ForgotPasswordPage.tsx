import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText } from "./AuthLayout";

type Step = "email" | "otp" | "reset" | "done";

// UC-05: email -> OTP -> dat mat khau moi. Cung dung duoc cho "dat mat khau
// lan dau" (tai khoan chi tung dang nhap OAuth) - server tra
// isFirstTimePassword de doi thong diep UI (xem buoc "reset").
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [isFirstTimePassword, setIsFirstTimePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setStep("otp");
    } catch (err) {
      setError(extractApiError(err, "Không gửi được OTP"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.verifyOtp(email, otp);
      setResetToken(data.resetToken);
      setIsFirstTimePassword(data.isFirstTimePassword);
      setStep("reset");
    } catch (err) {
      setError(extractApiError(err, "OTP sai hoặc đã hết hạn"));
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword(resetToken, newPassword);
      setStep("done");
    } catch (err) {
      setError(extractApiError(err, "Đặt mật khẩu mới thất bại"));
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <AuthLayout title="Hoàn tất">
        <p>Mật khẩu đã được cập nhật. Bạn có thể đăng nhập lại.</p>
        <button className="auth-btn-primary" onClick={() => navigate("/login")}>
          Về trang đăng nhập
        </button>
      </AuthLayout>
    );
  }

  if (step === "reset") {
    return (
      <AuthLayout title={isFirstTimePassword ? "Đặt mật khẩu lần đầu" : "Đặt lại mật khẩu"}>
        <form onSubmit={handleResetPassword}>
          <input
            type="password"
            placeholder="Mật khẩu mới (tối thiểu 8 ký tự)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="auth-input"
          />
          <ErrorText message={error} />
          <button type="submit" disabled={loading} className="auth-btn-primary">
            {loading ? "Đang lưu..." : "Lưu mật khẩu mới"}
          </button>
        </form>
      </AuthLayout>
    );
  }

  if (step === "otp") {
    return (
      <AuthLayout title="Nhập mã OTP">
        <p className="auth-divider">Mã OTP đã gửi tới {email}</p>
        <form onSubmit={handleVerifyOtp}>
          <input placeholder="Mã OTP 6 số" value={otp} onChange={(e) => setOtp(e.target.value)} required className="auth-input" />
          <ErrorText message={error} />
          <button type="submit" disabled={loading} className="auth-btn-primary">
            {loading ? "Đang xác thực..." : "Xác thực"}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Quên mật khẩu">
      <form onSubmit={handleSendOtp}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="auth-input" />
        <ErrorText message={error} />
        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang gửi..." : "Gửi mã OTP"}
        </button>
      </form>
      <p className="auth-footer">
        <Link to="/login">Quay lại đăng nhập</Link>
      </p>
    </AuthLayout>
  );
}
