const NONCE_BYTES = 12;
const PBKDF2_ITERATIONS = 100_000;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// SHA-256(sharedSecret) lam khoa AES-256-GCM truc tiep - dung thiet ke da
// mo ta o roadmap.md muc 6.5 (P2P: shared secret ECDH; Group: session key
// ngau nhien cua tung tin nhan).
export async function deriveAesKeyFromBytes(keyMaterial: Uint8Array): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", keyMaterial as BufferSource);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function importAesKeyRaw(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptAesGcm(key: CryptoKey, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, plaintext as BufferSource);
  return { ciphertext: new Uint8Array(ciphertextBuf), nonce };
}

export async function decryptAesGcm(key: CryptoKey, ciphertext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, ciphertext as BufferSource);
  return new Uint8Array(plainBuf);
}

// PIN 6 so -> khoa AES-256 dung de mao/giai ma vault (private key da luu).
// PBKDF2 voi so vong lap cao de lam cham brute-force offline mot chut - vi
// PIN chi co 1 trieu kha nang, day KHONG phai bien phap chong brute-force
// tuyet doi (xem canh bao o roadmap.md), chi lam ke tan cong ton nhieu thoi
// gian/tai nguyen hon.
export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const pinKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    pinKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// HKDF de dan xuat search key (blind-index) tu shared secret/session key -
// TACH BIET voi khoa ma hoa noi dung (khac "info" param), dung theo thiet
// ke o roadmap.md muc 6.5.
export async function deriveSearchKeyBytes(keyMaterial: Uint8Array, lengthBytes = 32): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", keyMaterial as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0) as BufferSource,
      info: new TextEncoder().encode("search-index") as BufferSource,
    },
    baseKey,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message.toLowerCase()) as BufferSource);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
