import { identityHttp } from "./httpClient";
import type { AuthSuccessResponse, OAuthSuccessResponse } from "../types/auth";

export const authApi = {
  login: (email: string, password: string) =>
    identityHttp.post<AuthSuccessResponse>("/auth/login", { email, password }),

  register: (email: string, password: string, nickname: string) =>
    identityHttp.post<AuthSuccessResponse>("/auth/register", { email, password, nickname }),

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

  updateNickname: (nickname: string) =>
    identityHttp.patch<void>("/users/me/nickname", { nickname }),
};
