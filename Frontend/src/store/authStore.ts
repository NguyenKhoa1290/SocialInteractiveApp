import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser } from "../types/auth";

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (accessToken: string, user: AuthUser) => void;
  clearAuth: () => void;
}

// Persist vao localStorage - giu dang nhap qua lan reload trang. Token van
// het han binh thuong theo JWT exp; lop refresh (xem lib/tokenScheduler.ts)
// chi gia han duoc khi token con hop le, khong "hoi sinh" duoc token da mat.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setAuth: (accessToken, user) => set({ accessToken, user }),
      clearAuth: () => set({ accessToken: null, user: null }),
    }),
    { name: "chat-app-auth" },
  ),
);
