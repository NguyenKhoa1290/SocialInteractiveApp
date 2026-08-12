import { create } from "zustand";

interface KeyState {
  privateKey: Uint8Array | null;
  publicKey: Uint8Array | null;
  setKeys: (privateKey: Uint8Array, publicKey: Uint8Array) => void;
  clearKeys: () => void;
}

// Private key CHI song trong bo nho (khong persist localStorage) - moi lan
// reload trang phai nhap lai PIN de giai ma vault. Day la danh doi chap
// nhan duoc: giu private key it "chay" hon la tien loi khong can nhap lai.
export const useKeyStore = create<KeyState>((set) => ({
  privateKey: null,
  publicKey: null,
  setKeys: (privateKey, publicKey) => set({ privateKey, publicKey }),
  clearKeys: () => set({ privateKey: null, publicKey: null }),
}));
