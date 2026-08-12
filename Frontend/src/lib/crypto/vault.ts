import { generateKeyPair, publicKeyToBase64, getPublicKeyFromPrivate } from "./x25519";
import { deriveKeyFromPin, encryptAesGcm, decryptAesGcm, randomBytes } from "./aes";
import { bytesToBase64, base64ToBytes } from "./encoding";
import { keysApi } from "../../api/keysApi";
import { useKeyStore } from "../../store/keyStore";
import { useAuthStore } from "../../store/authStore";
import { persistKey } from "./keyPersistence";
import { decodeJwtExpMs } from "../jwt";

const SALT_BYTES = 16;

// Cache private key da giai ma o localStorage, song den khi JWT het han -
// theo yeu cau nguoi dung du an (khong bat nhap lai PIN moi lan reload,
// giong Facebook). Xem canh bao danh doi bao mat o keyPersistence.ts.
function persistIfSessionKnown(privateKey: Uint8Array, publicKey: Uint8Array) {
  const { accessToken, user } = useAuthStore.getState();
  if (!accessToken || !user) return;
  const expMs = decodeJwtExpMs(accessToken);
  if (expMs === null) return;
  persistKey(user.id, privateKey, publicKey, expMs);
}

// Thiet lap E2EE lan dau: sinh cap khoa X25519 that, ma hoa private key
// bang khoa dan xuat tu PIN (PBKDF2 + salt ngau nhien), day ca vault
// (ciphertext) va public key len server. Server chi thay ciphertext +
// public key, KHONG BAO GIO thay PIN hay private key goc.
export async function setupVault(pin: string): Promise<void> {
  const { privateKey, publicKey } = generateKeyPair();
  const salt = randomBytes(SALT_BYTES);
  const pinKey = await deriveKeyFromPin(pin, salt);
  const { ciphertext, nonce } = await encryptAesGcm(pinKey, privateKey);

  await keysApi.saveVault(bytesToBase64(salt), bytesToBase64(nonce), bytesToBase64(ciphertext));
  await keysApi.registerPublicKey(publicKeyToBase64(publicKey));

  useKeyStore.getState().setKeys(privateKey, publicKey);
  persistIfSessionKnown(privateKey, publicKey);
}

// Khoi phuc tren thiet bi bat ky (hoac sau khi reload trang, vi private key
// khong persist) - tai vault tu server, giai ma bang PIN. PIN sai se lam
// AES-GCM decrypt that bai (auth tag khong khop) - nem loi ro rang, KHONG
// tra ve du lieu rac.
export async function unlockVault(pin: string): Promise<void> {
  const { data: vault } = await keysApi.getVault();
  const salt = base64ToBytes(vault.salt);
  const nonce = base64ToBytes(vault.nonce);
  const ciphertext = base64ToBytes(vault.ciphertext);

  const pinKey = await deriveKeyFromPin(pin, salt);
  let privateKey: Uint8Array;
  try {
    privateKey = await decryptAesGcm(pinKey, ciphertext, nonce);
  } catch {
    throw new Error("Mã PIN không đúng");
  }

  const publicKey = getPublicKeyFromPrivate(privateKey);
  useKeyStore.getState().setKeys(privateKey, publicKey);
  persistIfSessionKnown(privateKey, publicKey);
}

export async function hasVault(): Promise<boolean> {
  try {
    await keysApi.getVault();
    return true;
  } catch {
    return false;
  }
}
