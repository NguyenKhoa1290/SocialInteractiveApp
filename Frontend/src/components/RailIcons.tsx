// Bo icon cho thanh dieu huong.
//
// Ve thang bang SVG chu khong keo mot thu vien icon: thiet ke chi dung dung
// 5 hinh, ma thu vien nao cung nang vai chuc KB va keo theo mot cach dat ten
// rieng phai hoc. `currentColor` de mau di theo CSS - doi mau o mot cho la
// ca thanh doi theo, ke ca o giao dien toi.

type P = { size?: number };

export function IconChat({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

export function IconFriends({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="8" r="3.6" />
      <circle cx="17" cy="9" r="2.8" />
      <path d="M2 19c0-3.3 3.1-5.4 7-5.4s7 2.1 7 5.4v1H2v-1Z" />
      <path d="M17 13.4c3 0 5 1.7 5 4.2v1.4h-4.3v-1c0-1.7-.6-3.2-1.7-4.3.3-.2.7-.3 1-.3Z" />
    </svg>
  );
}

// Luoi 3x3 - dung cho Mini App, giong bieu tuong trong ban thiet ke.
export function IconGrid({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[3, 10.5, 18].map((y) =>
        [3, 10.5, 18].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="0.6" />),
      )}
    </svg>
  );
}

export function IconGear({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm0 6a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4Z" />
      <path d="m20.6 13.6-.1-1.6.1-1.6 1.7-1.3a.8.8 0 0 0 .2-1l-1.8-3a.8.8 0 0 0-1-.3l-2 .8a7.7 7.7 0 0 0-2.7-1.6l-.3-2.1a.8.8 0 0 0-.8-.7h-3.6a.8.8 0 0 0-.8.7l-.3 2.1a7.7 7.7 0 0 0-2.7 1.6l-2-.8a.8.8 0 0 0-1 .3l-1.8 3a.8.8 0 0 0 .2 1l1.7 1.3-.1 1.6.1 1.6-1.7 1.3a.8.8 0 0 0-.2 1l1.8 3a.8.8 0 0 0 1 .3l2-.8a7.7 7.7 0 0 0 2.7 1.6l.3 2.1c.05.4.4.7.8.7h3.6c.4 0 .75-.3.8-.7l.3-2.1a7.7 7.7 0 0 0 2.7-1.6l2 .8a.8.8 0 0 0 1-.3l1.8-3a.8.8 0 0 0-.2-1l-1.7-1.3Z" />
    </svg>
  );
}

export function IconBell({ size = 24 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5a1.3 1.3 0 0 1 1.3 1.3v.8a6 6 0 0 1 4.7 5.9v3.3l1.6 2.6a.8.8 0 0 1-.7 1.2H5.1a.8.8 0 0 1-.7-1.2L6 13.8v-3.3a6 6 0 0 1 4.7-5.9v-.8A1.3 1.3 0 0 1 12 2.5Z" />
      <path d="M9.6 19.2h4.8a2.4 2.4 0 0 1-4.8 0Z" />
    </svg>
  );
}
