// Icon cua thanh doc trong phong hop (Figma frame 116:773, "Frame 60" ben
// phai): tam nut tron 66px, vien #85AEB0 2px, hinh ben trong cung mau.
//
// Ve thang bang SVG nhu cac bo icon khac trong du an - xem ghi chu o dau
// components/RailIcons.tsx. Dung `currentColor` de trang thai bat/tat chi
// phai doi mot bien CSS.
//
// Mic va camera co them ban "tat": mot gach cheo di qua hinh. Thiet ke chi ve
// MOT trang thai cho moi nut, nhung mot cai mic dang tat ma trong y het mic
// dang bat thi nut do noi doi - phai co gi phan biet.

type P = { size?: number };

// Nut do: ket thuc cuoc hop cho tat ca. Trong Figma o nay moi la mot hinh
// chu nhat bo tron lam cho ("Call Disconnected"), chua co net ben trong.
export function IconCallEnd({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {/* Ong nghe dien thoai XOAY 135 do - hinh "gac may" quen thuoc. Ve mot
          hinh roi xoay chu khong ve san hinh nghieng: sua do nghieng thi chi
          sua mot con so. */}
      <g transform="rotate(135 12 12)">
        <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .7-.2 1l-2.2 2.2Z" />
      </g>
    </svg>
  );
}

export function IconCamera({ size = 32, off = false }: P & { off?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.2 5.6h10.4c1 0 1.8.8 1.8 1.8v9.2c0 1-.8 1.8-1.8 1.8H3.2c-1 0-1.8-.8-1.8-1.8V7.4c0-1 .8-1.8 1.8-1.8Z" />
      <path d="M17.2 10.2 22.4 6v12l-5.2-4.2v-3.6Z" />
      {off && <path d="M3 3.6 21.6 20.4l-1.5 1.6L1.5 5.2 3 3.6Z" />}
    </svg>
  );
}

export function IconMicrophone({ size = 30, off = false }: P & { off?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="8.8" y="1.8" width="6.4" height="12.2" rx="3.2" />
      <path d="M5 10.6v1.4a7 7 0 0 0 14 0v-1.4h-2.1v1.4a4.9 4.9 0 0 1-9.8 0v-1.4H5Z" />
      <path d="M10.9 19.6h2.2v2.6h-2.2z" />
      {off && <path d="M3 3.6 21.6 20.4l-1.5 1.6L1.5 5.2 3 3.6Z" />}
    </svg>
  );
}

export function IconChatBubble({ size = 32 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.6 2.6h16.8c1.1 0 2 .9 2 2v10.6c0 1.1-.9 2-2 2H9.2L4 21.6v-4.4h-.4c-1.1 0-2-.9-2-2V4.6c0-1.1.9-2 2-2Z" />
    </svg>
  );
}

export function IconPeople({ size = 32 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="7.6" r="3.8" />
      <circle cx="17.4" cy="8.6" r="2.9" />
      <path d="M1.6 19.2c0-3.5 3.3-5.7 7.4-5.6 4.1 0 7.4 2.1 7.4 5.6v1.2H1.6v-1.2Z" />
      <path d="M17.4 13c3.1 0 5 1.8 5 4.4v1.5h-4.2v-1.1c0-1.8-.6-3.3-1.8-4.5.3-.2.6-.3 1-.3Z" />
    </svg>
  );
}

export function IconScreenShare({ size = 34 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.4 3.4h19.2c.8 0 1.4.6 1.4 1.4v11c0 .8-.6 1.4-1.4 1.4H2.4c-.8 0-1.4-.6-1.4-1.4v-11c0-.8.6-1.4 1.4-1.4Zm9.6 2.2-4.6 4.6h3v4.2h3.2v-4.2h3L12 5.6Z" />
      <path d="M7 19h10v1.8H7z" />
    </svg>
  );
}

// "Perm media" trong thiet ke - o day la Mini App IPTV: thu ca phong cung xem.
export function IconMedia({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.4 3.4h15.2c.8 0 1.4.6 1.4 1.4v11.4c0 .8-.6 1.4-1.4 1.4H6.4c-.8 0-1.4-.6-1.4-1.4V4.8c0-.8.6-1.4 1.4-1.4Zm.8 12.4h13.6l-4.3-5.8-3.3 4.3-2.3-2.8-3.7 4.3Z" />
      <path d="M2.6 6.6v13.2c0 .8.6 1.4 1.4 1.4h15v-1.8H4.4V6.6H2.6Z" />
    </svg>
  );
}

// Mui ten lat trang, ve huong TRAI. Nut "sang phai" xoay 180 do bang CSS.
export function IconPagerArrow({ size = 18 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15.4 4.6 8 12l7.4 7.4"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
