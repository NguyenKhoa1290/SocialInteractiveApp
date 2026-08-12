// Facebook JS SDK - FB.login() tra ve authResponse.accessToken, dung dung
// hinh dang backend can (OAuthVerifier.cs goi
// https://graph.facebook.com/me?fields=id,email&access_token=...).
declare global {
  interface Window {
    FB?: {
      init: (config: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        cb: (resp: { authResponse?: { accessToken: string } | null; status: string }) => void,
        opts: { scope: string },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined;

let scriptLoaded: Promise<void> | null = null;

function loadFacebookSdk(): Promise<void> {
  if (scriptLoaded) return scriptLoaded;
  scriptLoaded = new Promise((resolve, reject) => {
    if (window.FB) {
      resolve();
      return;
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: FACEBOOK_APP_ID!, cookie: true, xfbml: false, version: "v21.0" });
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.onerror = () => reject(new Error("Không tải được Facebook SDK"));
    document.head.appendChild(script);
  });
  return scriptLoaded;
}

export function isFacebookConfigured() {
  return Boolean(FACEBOOK_APP_ID);
}

export async function getFacebookAccessToken(): Promise<string> {
  if (!FACEBOOK_APP_ID) {
    throw new Error("Chưa cấu hình VITE_FACEBOOK_APP_ID trong .env");
  }
  await loadFacebookSdk();

  return new Promise((resolve, reject) => {
    window.FB!.login(
      (resp) => {
        if (resp.authResponse?.accessToken) resolve(resp.authResponse.accessToken);
        else reject(new Error("Đăng nhập Facebook thất bại hoặc bị huỷ"));
      },
      { scope: "email" },
    );
  });
}
