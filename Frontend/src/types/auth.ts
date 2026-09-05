export type UserType = "guest" | "registered";

// Tra ve cua buoc 1 khi dang ky: chua co tai khoan nao, chi moi gui ma qua
// mail. `ttlGiay` de dem nguoc han cua ma, `guiLaiSauGiay` de biet khi nao mo
// lai duoc nut "Gui lai ma".
export interface RegisterPending {
  email: string;
  ttlGiay: number;
  guiLaiSauGiay: number;
}
export type UserStatus = "active" | "locked";

export interface AuthUser {
  id: number;
  userType: UserType;
  nickname: string;
  email: string | null;
  status: UserStatus;
  createdAt: string;
  // NULL = chua dat anh dai dien. Vua la co "co anh hay khong", vua la ma
  // chong cache gan vao URL anh - xem lib/avatarUrl.ts.
  avatarUpdatedAt: string | null;
}

// Nhung gi MOI NGUOI duoc biet ve mot nguoi khac: ten hien thi va moc doi
// anh. Khong co email, khong co trang thai khoa - xem GET /users?ids=...
export interface PublicUser {
  id: number;
  nickname: string;
  avatarUpdatedAt: string | null;
}

export interface AuthSuccessResponse {
  accessToken: string;
  user: AuthUser;
}

export interface OAuthSuccessResponse extends AuthSuccessResponse {
  isNewUser: boolean;
  requiresNickname: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
