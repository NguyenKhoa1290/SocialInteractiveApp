import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText, FieldGroupLabel } from "./AuthLayout";
import { IconEye } from "./AuthIcons";

export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.register(email, password, nickname);
      setAuth(data.accessToken, data.user);
      scheduleTokenRefresh(data.accessToken);
      navigate("/app");
    } catch (err) {
      setError(extractApiError(err, "Đăng ký thất bại"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Đăng ký vào Calli">
      <form onSubmit={handleSubmit} className="auth-form">
        <div>
          <FieldGroupLabel>Đăng ký bằng email</FieldGroupLabel>
          <label className="auth-field">
            <input
              type="email"
              placeholder="Địa chỉ email"
              aria-label="Địa chỉ email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="auth-input"
            />
          </label>
        </div>

        <label className="auth-field auth-field-has-eye">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Mật khẩu (tối thiểu 8 ký tự)"
            aria-label="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="auth-input"
          />
          <button
            type="button"
            className="auth-eye"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            <IconEye open={showPassword} />
          </button>
        </label>

        <label className="auth-field">
          <input
            placeholder="Tên tài khoản"
            aria-label="Tên tài khoản"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            className="auth-input"
          />
        </label>

        <ErrorText message={error} />

        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang đăng ký…" : "Đăng ký"}
        </button>
      </form>
      <p className="auth-footer">
        Đã có tài khoản ? <Link to="/login">Đăng nhập</Link>
      </p>
    </AuthLayout>
  );
}
