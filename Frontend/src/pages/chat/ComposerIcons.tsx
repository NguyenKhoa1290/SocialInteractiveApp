// Icon cua khung soan tin (Figma node 111:391, "Frame 38").
// Bon icon dinh kem 43px + nut gui. Ve tay, dung currentColor.

type P = { size?: number };

export function IconMic({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="9" y="2.2" width="6" height="11.6" rx="3" />
      <path d="M5.4 11.2v1.2a6.6 6.6 0 0 0 13.2 0v-1.2h-2v1.2a4.6 4.6 0 0 1-9.2 0v-1.2h-2Z" />
      <path d="M11 19h2v2.8h-2z" />
    </svg>
  );
}

export function IconImage({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.4 3.4h17.2c.9 0 1.6.7 1.6 1.6v14c0 .9-.7 1.6-1.6 1.6H3.4c-.9 0-1.6-.7-1.6-1.6V5c0-.9.7-1.6 1.6-1.6Zm1 14.8h14.4l-4.6-6.1-3.5 4.5-2.4-2.9-3.9 4.5ZM8 9.8a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" />
    </svg>
  );
}

export function IconVideo({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.4 4.6h13.2c.9 0 1.6.7 1.6 1.6v11.6c0 .9-.7 1.6-1.6 1.6H3.4c-.9 0-1.6-.7-1.6-1.6V6.2c0-.9.7-1.6 1.6-1.6Zm6.2 3.2v8.4l6-4.2-6-4.2Z" />
      <path d="M19.8 9.2 22.6 7v10l-2.8-2.2V9.2Z" />
    </svg>
  );
}

export function IconAttach({ size = 30 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.6 6.4v9.2a4.6 4.6 0 1 1-9.2 0V5.8a3 3 0 1 1 6 0v9.4a1.4 1.4 0 1 1-2.8 0V6.4H8.8v8.8a3.2 3.2 0 0 0 6.4 0V5.8a4.8 4.8 0 0 0-9.6 0v9.8a6.4 6.4 0 0 0 12.8 0V6.4h-1.8Z" />
    </svg>
  );
}

// Nut gui: mui ten giay, 45x39 nen #56959E trong thiet ke.
export function IconSend({ size = 34 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.2 21.4 22.6 12 2.2 2.6l.02 7.32L16.6 12 2.22 14.08 2.2 21.4Z" />
    </svg>
  );
}

// Nut xem thong tin o dau khung chat (36px, #233040).
export function IconAccount({ size = 28 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.4 2.4h17.2c.6 0 1 .4 1 1v17.2c0 .6-.4 1-1 1H3.4c-.6 0-1-.4-1-1V3.4c0-.6.4-1 1-1Zm8.6 4a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm-6 11.8c.6-2.6 3.1-4.2 6-4.2s5.4 1.6 6 4.2H6Z" />
    </svg>
  );
}

// Bieu tuong kho luu tru o dau khung chat nhom (Figma 122:1248, 33x29).
export function IconStorage({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse cx="12" cy="5.4" rx="8.6" ry="3.2" />
      <path d="M3.4 8.4v3.2c0 1.8 3.9 3.2 8.6 3.2s8.6-1.4 8.6-3.2V8.4c-1.7 1.3-5 2-8.6 2s-6.9-.7-8.6-2Z" />
      <path d="M3.4 14.4v3.2c0 1.8 3.9 3.2 8.6 3.2s8.6-1.4 8.6-3.2v-3.2c-1.7 1.3-5 2-8.6 2s-6.9-.7-8.6-2Z" />
    </svg>
  );
}
