import { isAxiosError } from "axios";
import type { ApiErrorBody } from "../types/auth";

export function extractApiError(err: unknown, fallback: string): string {
  if (isAxiosError<ApiErrorBody>(err) && err.response?.data?.message) {
    return err.response.data.message;
  }
  return fallback;
}

// Ma loi may doc (vd "storage_quota_exceeded") - khac voi message la chuoi
// cho nguoi doc. Dung khi cach HIEN THI phai doi theo loai loi: co loi chi
// can mot dong chu, co loi phai chan ngang bat doc.
export function apiErrorCode(err: unknown): string | null {
  return isAxiosError<ApiErrorBody>(err) ? (err.response?.data?.error ?? null) : null;
}
