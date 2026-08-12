import { isAxiosError } from "axios";
import type { ApiErrorBody } from "../types/auth";

export function extractApiError(err: unknown, fallback: string): string {
  if (isAxiosError<ApiErrorBody>(err) && err.response?.data?.message) {
    return err.response.data.message;
  }
  return fallback;
}
