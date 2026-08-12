// Doc claim "exp" tu JWT MA KHONG xac thuc chu ky - chi dung de lap lich
// refresh phia UI (khong dung ket qua nay cho bat ky quyet dinh bao mat nao,
// server luon la noi xac thuc that su moi request).
export function decodeJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
