export type UserType = "guest" | "registered";
export type UserStatus = "active" | "locked";

export interface AuthUser {
  id: number;
  userType: UserType;
  nickname: string;
  email: string | null;
  status: UserStatus;
  createdAt: string;
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
