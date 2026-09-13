import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const sessionRestoreComplete = useAuthStore((s) => s.sessionRestoreComplete);
  if (!sessionRestoreComplete) return <div role="status">Đang khôi phục phiên đăng nhập…</div>;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
