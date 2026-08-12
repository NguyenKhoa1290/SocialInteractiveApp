import { chatHttp } from "./httpClient";

export interface PublicKeyResponse {
  userId: number;
  publicKey: string;
  algorithm: string;
}

export interface VaultResponse {
  salt: string;
  nonce: string;
  ciphertext: string;
  updatedAt: string;
}

export const keysApi = {
  registerPublicKey: (publicKey: string) => chatHttp.post<PublicKeyResponse>("/keys", { publicKey, algorithm: "x25519" }),

  getPublicKey: (userId: number) => chatHttp.get<PublicKeyResponse>(`/keys/${userId}`),

  getPublicKeysBatch: (userIds: number[]) => chatHttp.get<PublicKeyResponse[]>("/keys/batch", { params: { ids: userIds.join(",") } }),

  saveVault: (salt: string, nonce: string, ciphertext: string) =>
    chatHttp.post<void>("/keys/vault", { salt, nonce, ciphertext }),

  getVault: () => chatHttp.get<VaultResponse>("/keys/vault"),
};
