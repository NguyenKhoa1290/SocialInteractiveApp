import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText } from "./AuthLayout";

// Dung sau dang ky/dang nhap OAuth lan dau (UC-07/08) - server tra
// requiresNickname=true vi OAuth KHONG tu lay ten tu provider lam nickname
// chinh thuc (xem AuthEndpoints.cs /auth/oauth/{provider}).
export function NicknamePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    setError(null);
    setLoading(true);
    try {
      await authApi.updateNickname(nickname);
      setAuth(accessToken, { ...user, nickname });
      navigate("/app");
    } catch (err) {
      setError(extractApiError(err, "Không đổi được nickname"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Chọn nickname">
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
          maxLength={50}
          className="auth-input"
        />
        <ErrorText message={error} />
        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang lưu..." : "Tiếp tục"}
        </button>
      </form>
    </AuthLayout>
  );
}
