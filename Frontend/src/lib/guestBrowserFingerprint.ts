// Day khong phai dinh danh phan cung va khong duoc dung de xac thuc nguoi
// dung. Day la tin hieu chong lam dung nhe cho luc tao Guest: cung may/mo
// trinh duyet thuong va an danh thuong cho ra cung mot gia tri.
//
// Chi dung cac dac tinh phuc vu giao dien; khong dung canvas, audio, font hay
// bat ky ky thuat nao co do xam pham rieng tu cao. Gia tri gui len server da
// la SHA-256, server chi luu hash do trong Redis voi TTL 30 phut.

const PHIEN_BAN = "v1";

type NavigatorCoClientHints = Navigator & {
  userAgentData?: { mobile?: boolean; platform?: string };
  deviceMemory?: number;
};

function trinhDuyetChinh(userAgent: string) {
  const match = userAgent.match(/(Edg|OPR|Chrome|Firefox|Version)\/(\d+)/i);
  if (!match) return "khac";

  const ten = match[1].toLowerCase();
  const phienBan = match[2];
  return `${ten}:${phienBan}`;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Mot promise duy nhat cho ca landing page, trang Guest va form vao hop: neu
// nguoi dung bam nhanh hai nut thi gia tri van on dinh, khong tao hai ban tay
// khac nhau tu cung mot trinh duyet.
let dangTinh: Promise<string> | null = null;

export function layGuestBrowserFingerprint(): Promise<string> {
  if (dangTinh) return dangTinh;

  dangTinh = (async () => {
    const nav = navigator as NavigatorCoClientHints;
    const be = Math.min(screen.width, screen.height);
    const lon = Math.max(screen.width, screen.height);
    const muiGio = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

    // Dung phien ban chinh cua browser thay vi gui ca User-Agent. Thay doi
    // nho trong UA khong lam mat dau vet, va server khong nhan chuoi UA goc.
    const noiDung = JSON.stringify({
      v: PHIEN_BAN,
      browser: trinhDuyetChinh(nav.userAgent),
      platform: nav.userAgentData?.platform ?? nav.platform ?? "",
      mobile: nav.userAgentData?.mobile ?? /Mobi/i.test(nav.userAgent),
      languages: [...nav.languages].map((x) => x.toLowerCase()).slice(0, 4),
      timezone: muiGio,
      screen: `${be}x${lon}@${Math.round(window.devicePixelRatio * 100)}`,
      touch: Math.min(nav.maxTouchPoints ?? 0, 20),
      cores: Math.min(nav.hardwareConcurrency ?? 0, 64),
      memory: Math.min(nav.deviceMemory ?? 0, 64),
    });

    const bytes = new TextEncoder().encode(noiDung);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `${PHIEN_BAN}:${hex(digest)}`;
  })();

  return dangTinh;
}
