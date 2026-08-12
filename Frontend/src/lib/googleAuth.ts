// Google Identity Services - dung "Token Client" (OAuth 2.0 implicit token
// flow) de lay ACCESS TOKEN thang tren trinh duyet, vi backend
// (OAuthVerifier.cs) goi https://www.googleapis.com/oauth2/v3/userinfo?
// access_token=... - can access_token, KHONG phai ID token (JWT credential)
// ma nut "Sign In With Google" moi mac dinh tra ve.
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

let scriptLoaded: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (scriptLoaded) return scriptLoaded;
  scriptLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Không tải được Google Identity Services"));
    document.head.appendChild(script);
  });
  return scriptLoaded;
}

export function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID);
}

export async function getGoogleAccessToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Chưa cấu hình VITE_GOOGLE_CLIENT_ID trong .env");
  }
  await loadGoogleScript();

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp.error ?? "Đăng nhập Google thất bại"));
      },
    });
    client.requestAccessToken();
  });
}
