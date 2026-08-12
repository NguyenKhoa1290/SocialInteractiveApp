import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { isAxiosError } from "axios";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import { getGoogleAccessToken, isGoogleConfigured } from "../../lib/googleAuth";
import { getFacebookAccessToken, isFacebookConfigured } from "../../lib/facebookAuth";
import { AuthLayout, ErrorText } from "./AuthLayout";
import type { OAuthSuccessResponse } from "../../types/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function afterOAuthSuccess(data: OAuthSuccessResponse) {
    setAuth(data.accessToken, data.user);
    scheduleTokenRefresh(data.accessToken);
    navigate(data.requiresNickname ? "/nickname" : "/app");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.login(email, password);
      setAuth(data.accessToken, data.user);
      scheduleTokenRefresh(data.accessToken);
      navigate("/app");
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403 && err.response.data?.error === "account_locked") {
        navigate("/account-locked");
        return;
      }
      setError(extractApiError(err, "Sai email hoặc mật khẩu"));
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: "google" | "facebook") {
    setError(null);
    setLoading(true);
    try {
      const oauthToken = provider === "google" ? await getGoogleAccessToken() : await getFacebookAccessToken();
      const { data } = await authApi.oauth(provider, oauthToken);
      afterOAuthSuccess(data);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403 && err.response.data?.error === "account_locked") {
        navigate("/account-locked");
        return;
      }
      if (isAxiosError(err) && err.response?.status === 409) {
        setError("Email này đã được đăng ký bằng phương thức khác (email/mật khẩu hoặc provider khác)");
        return;
      }
      setError(err instanceof Error ? err.message : `Đăng nhập ${provider} thất bại`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Đăng nhập">
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="auth-input"
        />
        <input
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="auth-input"
        />
        <ErrorText message={error} />
        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>

      <div className="auth-divider">hoặc</div>

      <button
        type="button"
        onClick={() => handleOAuth("google")}
        disabled={loading}
        title={isGoogleConfigured() ? undefined : "Chưa cấu hình VITE_GOOGLE_CLIENT_ID trong .env"}
        className="auth-btn-secondary"
      >
        Đăng nhập với Google
      </button>
      <button
        type="button"
        onClick={() => handleOAuth("facebook")}
        disabled={loading}
        title={isFacebookConfigured() ? undefined : "Chưa cấu hình VITE_FACEBOOK_APP_ID trong .env"}
        className="auth-btn-secondary"
      >
        Đăng nhập với Facebook
      </button>
      <button type="button" onClick={() => navigate("/guest")} disabled={loading} className="auth-btn-secondary">
        Vào với tư cách Guest
      </button>

      <p className="auth-footer">
        Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
      </p>
      <p className="auth-footer">
        <Link to="/forgot-password">Quên mật khẩu?</Link>
      </p>
    </AuthLayout>
  );
}
