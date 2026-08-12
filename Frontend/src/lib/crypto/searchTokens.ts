import { deriveSearchKeyBytes, hmacSha256 } from "./aes";

// Chuan hoa tieng Viet truoc khi tach tu: chu thuong, bo dau (NFD khong tu
// decompose "d/D" co gach ngang nen xu ly rieng), dung theo thiet ke o
// roadmap.md muc 6.5.
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function tokenizeWords(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// Blind-index searchable encryption (dung Facebook that su lam) - searchKey
// KHONG BAO GIO gui len server, chi client tu tinh de bam tu khoa TRUOC khi
// ma hoa noi dung goc. Xem giai thich day du + ly do khong dung thang
// private key ca nhan lam searchKey o roadmap.md muc 6.5.
export async function computeSearchTokens(keyMaterial: Uint8Array, plaintext: string): Promise<string[]> {
  const searchKey = await deriveSearchKeyBytes(keyMaterial);
  const words = tokenizeWords(plaintext);
  const tokens = await Promise.all(words.map((w) => hmacSha256(searchKey, w)));
  return [...new Set(tokens)];
}

export async function computeQueryTokens(keyMaterial: Uint8Array, query: string): Promise<string[]> {
  return computeSearchTokens(keyMaterial, query);
}
