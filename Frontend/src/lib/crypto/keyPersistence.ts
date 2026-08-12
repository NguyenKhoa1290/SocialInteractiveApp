import { bytesToBase64, base64ToBytes } from "./encoding";

const STORAGE_KEY = "chat-app-e2ee-key";

interface StoredKey {
  userId: number;
  privateKey: string; // base64
  publicKey: string; // base64
  expiresAtMs: number; // khop voi exp cua JWT hien tai - xem tokenScheduler.ts
}

// Cache private key DA GIAI MA (khong phai vault ma hoa) o localStorage,
// song den khi JWT het han - tu de xuat theo yeu cau nguoi dung du an
// ("giong Facebook, khong bat nhap lai PIN moi lan reload"). Danh doi bao
// mat CO CHU Y: ai co quyen truy cap localStorage tren may nay (vd
// XSS, hoac ke khac dung chung may) doc duoc private key ma khong can PIN -
// giong dung cach cac web client E2EE thuc te (Messenger, WhatsApp Web...)
// van lam de tien loi, khong phai loi thiet ke.
export function persistKey(userId: number, privateKey: Uint8Array, publicKey: Uint8Array, expiresAtMs: number) {
  const data: StoredKey = {
    userId,
    privateKey: bytesToBase64(privateKey),
    publicKey: bytesToBase64(publicKey),
    expiresAtMs,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Goi lai moi khi token duoc gia han (sliding expiration, xem
// tokenScheduler.ts) de key cuc bo "song" cung nhip voi JWT - dung khop
// "luu den khi het han JWT" thay vi 1 moc thoi gian co dinh luc dang nhap.
export function extendKeyExpiry(newExpiresAtMs: number) {
  const stored = readRaw();
  if (!stored) return;
  stored.expiresAtMs = newExpiresAtMs;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function readRaw(): StoredKey | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredKey;
  } catch {
    return null;
  }
}

// Doc lai luc app khoi dong (F5/mo tab moi) - tra ve null neu chua tung
// luu, sai user (dang nhap tai khoan khac tren cung may), hoac JWT (gia
// dinh) da het han - KHONG tu dong "hoi sinh" qua han, giong dung nguyen
// tac da ap dung cho chinh JWT.
export function loadPersistedKey(userId: number): { privateKey: Uint8Array; publicKey: Uint8Array } | null {
  const stored = readRaw();
  if (!stored || stored.userId !== userId || Date.now() >= stored.expiresAtMs) {
    if (stored) clearPersistedKey();
    return null;
  }
  return { privateKey: base64ToBytes(stored.privateKey), publicKey: base64ToBytes(stored.publicKey) };
}

export function clearPersistedKey() {
  localStorage.removeItem(STORAGE_KEY);
}
