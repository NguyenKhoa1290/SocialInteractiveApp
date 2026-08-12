import { computeSharedSecret } from "./x25519";
import { deriveAesKeyFromBytes, encryptAesGcm, decryptAesGcm, importAesKeyRaw, randomBytes } from "./aes";
import { bytesToBase64, base64ToBytes, utf8ToBytes, bytesToUtf8 } from "./encoding";
import { computeSearchTokens } from "./searchTokens";

const WRAP_NONCE_BYTES = 12;

// P2P: khong can bang phu, 2 ben tu tinh ra cung 1 shared secret qua ECDH
// (xem x25519.ts) roi SHA-256 no lam khoa AES-256-GCM truc tiep. searchKey
// (blind-index) dan xuat tu CUNG shared secret nay - xem searchTokens.ts.
export async function encryptTextP2P(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array, plaintext: string) {
  const sharedSecret = computeSharedSecret(myPrivateKey, theirPublicKey);
  const aesKey = await deriveAesKeyFromBytes(sharedSecret);
  const { ciphertext, nonce } = await encryptAesGcm(aesKey, utf8ToBytes(plaintext));
  const searchTokens = await computeSearchTokens(sharedSecret, plaintext);
  return { content: bytesToBase64(ciphertext), contentNonce: bytesToBase64(nonce), searchTokens };
}

// Dung ca cho "sua tin nhan" P2P - shared secret tu tinh lai duoc y het lan
// dau (deterministic tu ECDH), khong can luu gi them.
export const editTextP2P = encryptTextP2P;

export async function decryptTextP2P(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  contentB64: string,
  nonceB64: string,
): Promise<string> {
  const sharedSecret = computeSharedSecret(myPrivateKey, theirPublicKey);
  const aesKey = await deriveAesKeyFromBytes(sharedSecret);
  const plainBytes = await decryptAesGcm(aesKey, base64ToBytes(contentB64), base64ToBytes(nonceB64));
  return bytesToUtf8(plainBytes);
}

// Group (fan-out, dung pattern Signal/WhatsApp): 1 tin nhan = 1 session key
// ngau nhien dung 1 lan, ma hoa noi dung bang session key do; session key
// lai duoc "goi" RIENG cho tung thanh vien bang khoa wrap = SHA-256(ECDH
// giua nguoi gui va thanh vien do). Nguoi gui phai tu goi CHO CHINH MINH
// nua (de sau nay GET lai lich su van giai ma duoc, va de sua tin sau nay -
// xem recoverGroupSessionKey).
export interface GroupRecipient {
  userId: number;
  publicKey: Uint8Array;
}

function packWrapped(nonce: Uint8Array, ciphertext: Uint8Array): string {
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return bytesToBase64(blob);
}

function unpackWrapped(blobB64: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const blob = base64ToBytes(blobB64);
  return { nonce: blob.slice(0, WRAP_NONCE_BYTES), ciphertext: blob.slice(WRAP_NONCE_BYTES) };
}

// LUU Y quan trong (tu phat hien khi noi UI search): searchKey KHONG THE
// dan xuat tu sessionKey ngau nhien cua TUNG tin nhan - moi tin co
// sessionKey khac nhau, nen token cua tin A va tin B se khong bao gio
// khop nhau du cung 1 tu, khien search vo dung. Phai dung 1 khoa ON DINH
// xuyen suot ca hoi thoai: shared secret ECDH giua NGUOI GUI va TUNG
// NGUOI NHAN (giong wrapKey da co san) - ai cung tu tinh lai duoc bang
// chinh minh, khong doi theo tung tin. Vi moi cap (nguoi gui, nguoi nhan)
// ra 1 khoa khac nhau, phai tinh RIENG 1 bo token cho tung nguoi nhan roi
// gop chung vao 1 danh sach gui len server - luc search, moi nguoi chi tu
// nhien khop dung voi bo token danh cho rieng minh.
export async function encryptTextGroup(myPrivateKey: Uint8Array, recipients: GroupRecipient[], plaintext: string) {
  const sessionKey = randomBytes(32);
  const sessionAesKey = await importAesKeyRaw(sessionKey);
  const { ciphertext, nonce } = await encryptAesGcm(sessionAesKey, utf8ToBytes(plaintext));

  const perRecipient = await Promise.all(
    recipients.map(async (r) => {
      const sharedSecret = computeSharedSecret(myPrivateKey, r.publicKey);
      const wrapKey = await deriveAesKeyFromBytes(sharedSecret);
      const wrapped = await encryptAesGcm(wrapKey, sessionKey);
      const tokens = await computeSearchTokens(sharedSecret, plaintext);
      return { userId: r.userId, encryptedKey: packWrapped(wrapped.nonce, wrapped.ciphertext), tokens };
    }),
  );

  const recipientKeys = perRecipient.map(({ userId, encryptedKey }) => ({ userId, encryptedKey }));
  const searchTokens = [...new Set(perRecipient.flatMap((r) => r.tokens))];

  return { content: bytesToBase64(ciphertext), contentNonce: bytesToBase64(nonce), recipientKeys, searchTokens };
}

// Khoa "on dinh xuyen suot hoi thoai" giua minh va 1 nguoi gui cu the -
// dung de tu tinh lai token TRUY VAN luc search (xem ghi chu tren
// encryptTextGroup) - CHINH LA sharedSecret ECDH, KHONG phai sessionKey.
export function conversationSearchKeyMaterial(myPrivateKey: Uint8Array, otherPublicKey: Uint8Array): Uint8Array {
  return computeSharedSecret(myPrivateKey, otherPublicKey);
}

export async function decryptTextGroup(
  myPrivateKey: Uint8Array,
  senderPublicKey: Uint8Array,
  contentB64: string,
  nonceB64: string,
  myEncryptedKeyB64: string,
): Promise<string> {
  const sessionKey = await recoverGroupSessionKey(myPrivateKey, senderPublicKey, myEncryptedKeyB64);
  const sessionAesKey = await importAesKeyRaw(sessionKey);
  const plainBytes = await decryptAesGcm(sessionAesKey, base64ToBytes(contentB64), base64ToBytes(nonceB64));
  return bytesToUtf8(plainBytes);
}

// Lay lai dung session key GOC tu ban da "goi" cho chinh minh luc gui -
// dung khi giai ma, VA khi SUA tin nhan (backend yeu cau tai su dung dung
// session key cu, khong tao moi - xem roadmap.md muc 6.4 API PATCH).
export async function recoverGroupSessionKey(
  myPrivateKey: Uint8Array,
  senderPublicKey: Uint8Array,
  myEncryptedKeyB64: string,
): Promise<Uint8Array> {
  const sharedSecret = computeSharedSecret(myPrivateKey, senderPublicKey);
  const wrapKey = await deriveAesKeyFromBytes(sharedSecret);
  const { nonce: wrapNonce, ciphertext: wrapCiphertext } = unpackWrapped(myEncryptedKeyB64);
  return decryptAesGcm(wrapKey, wrapCiphertext, wrapNonce);
}

// Sua tin nhan Group - TAI SU DUNG session key cu (lay lai qua
// recoverGroupSessionKey) de ma hoa lai NOI DUNG, KHONG sinh session key
// moi va KHONG can goi lai RecipientKeys (dung nhu backend da thiet ke
// san). Rieng search token van phai tinh lai theo dung khoa ON DINH cua
// tung nguoi nhan (xem encryptTextGroup) - can lai danh sach nguoi nhan.
export async function editTextGroup(myPrivateKey: Uint8Array, recipients: GroupRecipient[], sessionKey: Uint8Array, plaintext: string) {
  const sessionAesKey = await importAesKeyRaw(sessionKey);
  const { ciphertext, nonce } = await encryptAesGcm(sessionAesKey, utf8ToBytes(plaintext));

  const perRecipientTokens = await Promise.all(
    recipients.map((r) => computeSearchTokens(computeSharedSecret(myPrivateKey, r.publicKey), plaintext)),
  );
  const searchTokens = [...new Set(perRecipientTokens.flat())];

  return { content: bytesToBase64(ciphertext), contentNonce: bytesToBase64(nonce), searchTokens };
}
