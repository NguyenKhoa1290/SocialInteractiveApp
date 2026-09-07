import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText } from "./AuthLayout";

export function GuestPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.guest(displayName);
      setAuth(data.accessToken, data.user);
      scheduleTokenRefresh(data.accessToken);
      navigate("/app");
    } catch (err) {
      setError(extractApiError(err, "Không vào được với tư cách Guest"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Vào với tư cách Guest">
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Tên hiển thị"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={50}
          className="auth-input"
        />
        <ErrorText message={error} />
        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang vào..." : "Vào"}
        </button>
      </form>
      <p className="auth-footer">
        <Link to="/login">Quay lại đăng nhập</Link>
      </p>
    </AuthLayout>
  );
}
