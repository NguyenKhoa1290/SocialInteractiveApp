import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { decodeJwtIsAdmin } from "../lib/jwt";

// Doc claim role tu chinh access token, KHONG tu authStore.user: AuthUser
// khong co truong isAdmin (xem types/auth.ts), va token moi la thu that su
// duoc gui kem moi request nen no luon dong bo voi cai backend nhin thay.
//
// Day chi la lop AN GIAO DIEN. AdminService tu xac thuc chu ky va tra 403
// cho moi endpoint /admin/*, nen nguoi tu sua token trong localStorage cung
// chi mo duoc khung man hinh rong, khong lay duoc du lieu.
export function AdminRoute({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  if (!decodeJwtIsAdmin(accessToken)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
