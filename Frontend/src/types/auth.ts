export type UserType = "guest" | "registered";
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
