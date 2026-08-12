import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToBase64, base64ToBytes } from "./encoding";

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function getPublicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

export function generateKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

// ECDH: privA*pubB == privB*pubA - ca 2 ben tu tinh ra cung 1 shared secret
// tu khoa rieng cua minh + khoa cong khai cua doi phuong, khong can trao doi
// bi mat qua mang (xem giai thich chi tiet o roadmap.md muc 6.5).
export function computeSharedSecret(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(myPrivateKey, theirPublicKey);
}

export function publicKeyToBase64(publicKey: Uint8Array): string {
  return bytesToBase64(publicKey);
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  return base64ToBytes(b64);
}
