import axios from "axios";
import { IDENTITY_API_URL, WORKSPACE_API_URL, CHAT_API_URL, MEDIA_API_URL } from "../config";
import { useAuthStore } from "../store/authStore";

// Dung chung cho moi service backend (Identity, WorkSpace, Chat...) - tu
// gan JWT, tu don session khi token het han that su (401). Moi service co
// baseURL rieng nhung cung 1 nguon token (authStore) vi JWT phat hanh boi
// Identity Service, cac service khac chi validate.
function createAuthedHttp(baseURL: string) {
  const instance = axios.create({ baseURL });

  instance.interceptors.request.use((cfg) => {
    const token = useAuthStore.getState().accessToken;
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        useAuthStore.getState().clearAuth();
      }
      return Promise.reject(err);
    },
  );

  return instance;
}

export const identityHttp = createAuthedHttp(IDENTITY_API_URL);
export const workspaceHttp = createAuthedHttp(WORKSPACE_API_URL);
export const chatHttp = createAuthedHttp(CHAT_API_URL);
export const mediaHttp = createAuthedHttp(MEDIA_API_URL);
