// Doc claim "exp" - chi dung de lap lich refresh phia UI.
export function decodeJwtExpMs(token: string): number | null {
  const payload = decodePayload(token);
  return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
}

// Claim "role" chi duoc Identity Service gan khi User.IsAdmin=true (xem
// JwtTokenService.cs). Dung de AN/HIEN loi vao Admin tren UI - KHONG phai
// lop bao ve: AdminService tu kiem tra chu ky va tra 403, nen sua token o
// trinh duyet cung chi mo duoc man hinh rong.
export function decodeJwtIsAdmin(token: string): boolean {
  return decodePayload(token)?.role === "admin";
}

// Doc payload JWT MA KHONG xac thuc chu ky - chi dung cho quyet dinh hien
// thi phia UI, khong bao gio dung cho quyet dinh bao mat (server luon la
// noi xac thuc that su moi request).
function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
