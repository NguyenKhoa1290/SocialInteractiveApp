import { bytesToBase64, base64ToBytes } from "./encoding";

const STORAGE_KEY = "chat-app-e2ee-key";

interface StoredKey {
  userId: number;
  privateKey: string; // base64
  publicKey: string; // base64
  expiresAtMs: number; // cua so 6 thang khong hoat dong cua persistent session
}

const KEY_IDLE_MONTHS = 6;

function keyExpiryFromNow() {
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + KEY_IDLE_MONTHS);
  return expiresAt.getTime();
}

// Cache private key DA GIAI MA (khong phai vault ma hoa) o localStorage,
// song theo cung cua so 6 thang khong hoat dong voi persistent session
// - tu de xuat theo yeu cau nguoi dung du an
// ("giong Facebook, khong bat nhap lai PIN moi lan reload"). Danh doi bao
// mat CO CHU Y: ai co quyen truy cap localStorage tren may nay (vd
// XSS, hoac ke khac dung chung may) doc duoc private key ma khong can PIN -
// giong dung cach cac web client E2EE thuc te (Messenger, WhatsApp Web...)
// van lam de tien loi, khong phai loi thiet ke.
export function persistKey(userId: number, privateKey: Uint8Array, publicKey: Uint8Array) {
  const data: StoredKey = {
    userId,
    privateKey: bytesToBase64(privateKey),
    publicKey: bytesToBase64(publicKey),
    expiresAtMs: keyExpiryFromNow(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Goi lai moi khi persistent session duoc gia han de key cuc bo khong het
// truoc phien dang nhap. Dang xuat/tai khoan bi thu hoi van xoa ngay key nay.
export function extendKeyExpiry() {
  const stored = readRaw();
  if (!stored) return;
  stored.expiresAtMs = keyExpiryFromNow();
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
// luu, sai user (dang nhap tai khoan khac tren cung may), hoac phien da khong
// hoat dong qua 6 thang. Khi do khong tu dong "hoi sinh" khoa cu.
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
