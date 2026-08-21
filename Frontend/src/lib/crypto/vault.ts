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

  // Dang ky public key TRUOC, luu vault SAU. Thu tu nay quan trong vi hai
  // loi goi khong nguyen tu: neu buoc sau hong thi trang thai con lai phai
  // la trang thai TU SUA DUOC.
  //   - Thu tu nay: co public key, khong co vault -> hasVault() = false ->
  //     lan sau vao lai hien man thiet lap, sinh cap khoa moi, ghi de. On.
  //   - Thu tu nguoc lai (ban cu): co vault, khong co public key ->
  //     hasVault() = true -> hien man NHAP PIN, mo khoa thanh cong, nhung
  //     public key khong bao gio duoc dang ky. Nguoi dung thay moi thu binh
  //     thuong ma KHONG AI gui duoc tin ma hoa cho ho, va khong tu lanh.
  await keysApi.registerPublicKey(publicKeyToBase64(publicKey));
  await keysApi.saveVault(bytesToBase64(salt), bytesToBase64(nonce), bytesToBase64(ciphertext));

  useKeyStore.getState().setKeys(privateKey, publicKey);
  persistIfSessionKnown(privateKey, publicKey);
}

// Luoi thu hai cho dung van de tren: moi lan mo khoa deu doi chieu public
// key tren server voi khoa that su suy ra tu private key. Thieu hoac lech
// thi dang ky lai.
//
// Lech co the xay ra khi: dang ky that bai luc thiet lap, hoac tai khoan
// tung dat lai PIN o thiet bi khac. Ca hai truong hop deu dan toi "khong ai
// gui duoc tin ma hoa cho nguoi nay" ma khong co dau hieu gi.
//
// Nuot loi co chu y: viec mo khoa da thanh cong roi, khong duoc phep hong
// vi mot buoc va loi. Hong thi lan mo khoa sau thu lai.
async function ensurePublicKeyRegistered(publicKey: Uint8Array): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  const mine = publicKeyToBase64(publicKey);
  try {
    const { data } = await keysApi.getPublicKey(userId);
    if (data.publicKey === mine) return;
  } catch {
    // 404 = chua tung dang ky - roi vao dung nhanh can sua ben duoi
  }

  try {
    await keysApi.registerPublicKey(mine);
  } catch {
    // thu lai o lan mo khoa sau
  }
}

// Dat lai PIN khi nguoi dung quen. Sinh cap khoa HOAN TOAN MOI va ghi de ca
// vault lan public key - khong co cach nao khac, vi private key cu chi ton
// tai duoi dang ma hoa bang chinh cai PIN da quen.
//
// HAU QUA KHONG THE DAO NGUOC: moi tin nhan Text cu deu duoc ma hoa cho khoa
// cu, sau buoc nay se khong bao gio doc lai duoc nua. Noi goi BAT BUOC phai
// canh bao ro va bat xac nhan truoc khi goi.
export async function resetVault(newPin: string): Promise<void> {
  await setupVault(newPin);
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
  await ensurePublicKeyRegistered(publicKey);
}

export async function hasVault(): Promise<boolean> {
  try {
    await keysApi.getVault();
    return true;
  } catch {
    return false;
  }
}
