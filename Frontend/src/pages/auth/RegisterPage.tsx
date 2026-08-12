import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText } from "./AuthLayout";

export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
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
    <AuthLayout title="Đăng ký">
      <form onSubmit={handleSubmit}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="auth-input" />
        <input
          type="password"
          placeholder="Mật khẩu (tối thiểu 8 ký tự)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="auth-input"
        />
        <input placeholder="Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required className="auth-input" />
        <ErrorText message={error} />
        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang đăng ký..." : "Đăng ký"}
        </button>
      </form>
      <p className="auth-footer">
        Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
      </p>
    </AuthLayout>
  );
}
