import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { isAxiosError } from "axios";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import { getGoogleAccessToken, isGoogleConfigured } from "../../lib/googleAuth";
import { getFacebookAccessToken, isFacebookConfigured } from "../../lib/facebookAuth";
import { AuthLayout, ErrorText, FieldGroupLabel } from "./AuthLayout";
import { IconEye, IconFacebook, IconGoogle } from "./AuthIcons";
import type { OAuthSuccessResponse } from "../../types/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      setError(extractApiError(err, "Địa chỉ email hoặc Mật khẩu không đúng"));
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
    <AuthLayout title="Đăng nhập vào Calli">
      <form onSubmit={handleSubmit} className="auth-form">
        <div>
          <FieldGroupLabel>Đăng nhập bằng email</FieldGroupLabel>
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
            placeholder="Mật khẩu"
            aria-label="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
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

        <Link to="/forgot-password" className="auth-forgot">
          Quên mật khẩu ?
        </Link>

        <div>
          <FieldGroupLabel>Đăng nhập tài khoản mạng xã hội</FieldGroupLabel>
          <div className="auth-social-row">
            <button
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={loading}
              className="auth-social-btn"
              aria-label="Đăng nhập với Google"
              title={isGoogleConfigured() ? "Đăng nhập với Google" : "Chưa cấu hình VITE_GOOGLE_CLIENT_ID trong .env"}
            >
              <IconGoogle />
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("facebook")}
              disabled={loading}
              className="auth-social-btn"
              aria-label="Đăng nhập với Facebook"
              title={isFacebookConfigured() ? "Đăng nhập với Facebook" : "Chưa cấu hình VITE_FACEBOOK_APP_ID trong .env"}
            >
              <IconFacebook />
            </button>
          </div>
        </div>

        <ErrorText message={error} />

        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>

      <p className="auth-footer">
        Chưa có tài khoản ? <Link to="/register">Đăng ký ngay</Link>
      </p>
      <p className="auth-guest">
        <Link to="/guest" className="auth-link">
          Vào nhanh với tư cách khách
        </Link>
      </p>
    </AuthLayout>
  );
}
