import { IDENTITY_API_URL } from "../config";

// Dia chi anh dai dien cua mot nguoi dung.
//
// `?v=<avatarUpdatedAt>` la ma chong cache: mot dia chi cu the KHONG BAO GIO
// doi noi dung, nen server cho phep trinh duyet giu lai ca tuan (xem header
// Cache-Control o UsersEndpoints.cs). Doi anh la doi luon dia chi, trinh duyet
// lay ban moi ngay - vua khong phai tai lai anh sau moi lan mo trang, vua
// khong bao gio hien nham anh cu.
//
// Tra ve null khi nguoi do chua dat anh: noi goi tu quyet dinh hien gi thay
// the (thuong la chu cai dau).
export function avatarUrl(userId: number, avatarUpdatedAt: string | null | undefined): string | null {
  if (!avatarUpdatedAt) return null;
  return `${IDENTITY_API_URL}/users/${userId}/avatar?v=${encodeURIComponent(avatarUpdatedAt)}`;
}
