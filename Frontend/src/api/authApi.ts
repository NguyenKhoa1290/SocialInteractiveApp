import { identityHttp } from "./httpClient";
import type { AuthSuccessResponse, AuthUser, OAuthSuccessResponse, RegisterPending } from "../types/auth";

export const authApi = {
  login: (email: string, password: string) =>
    identityHttp.post<AuthSuccessResponse>("/auth/login", { email, password }),

  // Buoc 1: CHUA tao tai khoan, chi gui ma xac thuc qua mail (202).
  register: (email: string, password: string, nickname: string) =>
    identityHttp.post<RegisterPending>("/auth/register", { email, password, nickname }),

  // Buoc 2: nhap dung ma thi tai khoan moi thuc su duoc tao (201 + token).
  verifyRegistration: (email: string, otp: string) =>
    identityHttp.post<AuthSuccessResponse>("/auth/register/verify", { email, otp }),

  resendRegistration: (email: string) =>
    identityHttp.post<RegisterPending>("/auth/register/resend", { email }),

  guest: (nickname: string) =>
    identityHttp.post<AuthSuccessResponse>("/auth/guest", { nickname }),

  oauth: (provider: "google" | "facebook", oauthToken: string) =>
    identityHttp.post<OAuthSuccessResponse>(`/auth/oauth/${provider}`, { oauthToken }),

  forgotPassword: (email: string) => identityHttp.post<void>("/auth/forgot-password", { email }),

  verifyOtp: (email: string, otp: string) =>
    identityHttp.post<{ resetToken: string; isFirstTimePassword: boolean }>("/auth/verify-otp", {
      email,
      otp,
    }),

  resetPassword: (resetToken: string, newPassword: string) =>
    identityHttp.post<void>("/auth/reset-password", { resetToken, newPassword }),

  refresh: () => identityHttp.post<AuthSuccessResponse>("/auth/refresh"),

  logout: () => identityHttp.post<void>("/auth/logout"),

  // Gui THANG byte anh, khong boc multipart: sau khi cat anh o trinh duyet ta
  // da co san mot Blob, gui thang la xong. Server doc than request va tu nhan
  // dang kieu anh bang chu ky byte.
  uploadAvatar: (blob: Blob) =>
    identityHttp.put<AuthUser>("/users/me/avatar", blob, {
      headers: { "Content-Type": blob.type || "application/octet-stream" },
    }),

  deleteAvatar: () => identityHttp.delete<AuthUser>("/users/me/avatar"),

  updateNickname: (nickname: string) =>
    identityHttp.patch<void>("/users/me/nickname", { nickname }),
};
