import axios from "axios";
import { IDENTITY_API_URL, WORKSPACE_API_URL, CHAT_API_URL, MEDIA_API_URL, ADMIN_API_URL } from "../config";
import { useAuthStore } from "../store/authStore";

// Dung chung cho moi service backend (Identity, WorkSpace, Chat...) - tu gan
// JWT. KHONG dang xuat theo moi 401: mot service co the tra 401 tam thoi trong
// luc access JWT vua het han, trong khi refresh-session HttpOnly van con song.
// Token scheduler la noi duy nhat quyet dinh phien da het that su.
function createAuthedHttp(baseURL: string, withCredentials = false) {
  const instance = axios.create({ baseURL, withCredentials });

  instance.interceptors.request.use((cfg) => {
    const token = useAuthStore.getState().accessToken;
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
  });
  return instance;
}

// Identity dung cookie host-only de gioi han tao Guest. Cookie khong mang
// quyen dang nhap, nhung phai duoc gui lai khi frontend goi cross-origin toi
// identity.callimeet.com.
export const identityHttp = createAuthedHttp(IDENTITY_API_URL, true);
export const workspaceHttp = createAuthedHttp(WORKSPACE_API_URL);
export const chatHttp = createAuthedHttp(CHAT_API_URL);
export const mediaHttp = createAuthedHttp(MEDIA_API_URL);
export const adminHttp = createAuthedHttp(ADMIN_API_URL);
