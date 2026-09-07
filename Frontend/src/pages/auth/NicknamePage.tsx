import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText } from "./AuthLayout";

// OAuth da duoc server cap san handle duy nhat; nguoi dung chi chon ten hien
// thi cong khai trong buoc dau tien nay.
export function NicknamePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !accessToken) return;
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.updateDisplayName(displayName);
      setAuth(accessToken, data);
      navigate("/app");
    } catch (err) {
      setError(extractApiError(err, "Không đổi được nickname"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Chọn tên hiển thị">
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
          {loading ? "Đang lưu..." : "Tiếp tục"}
        </button>
      </form>
    </AuthLayout>
  );
}
