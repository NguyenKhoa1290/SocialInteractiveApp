// Tai anh goc bang ba byte range. Chi dung trong viewer: anh trong luong chat
// van de trinh duyet lazy-load/progressive nhu truoc.

const SO_LUONG = 3;
const KICH_THUOC_TOI_THIEU = 3 * 1024 * 1024;
const KICH_THUOC_TOI_DA = 32 * 1024 * 1024;

export function nenTaiAnhNhieuLuong(sizeBytes?: number): sizeBytes is number {
  return (
    typeof sizeBytes === "number" &&
    Number.isFinite(sizeBytes) &&
    sizeBytes >= KICH_THUOC_TOI_THIEU &&
    sizeBytes <= KICH_THUOC_TOI_DA
  );
}

type ByteRange = { batDau: number; ketThuc: number };

function chiaRange(sizeBytes: number): ByteRange[] {
  const ketQua: ByteRange[] = [];
  for (let i = 0; i < SO_LUONG; i++) {
    const batDau = Math.floor((sizeBytes * i) / SO_LUONG);
    const ketThuc = Math.floor((sizeBytes * (i + 1)) / SO_LUONG) - 1;
    if (batDau <= ketThuc) ketQua.push({ batDau, ketThuc });
  }
  return ketQua;
}

function mimeTheoTen(fileName?: string | null): string | null {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return null;
  }
}

// Tra null de caller lui ve <img src> mot luong. URL het han, kho khac
// khong ho tro Range, hoac CORS khong dung deu khong lam mat kha nang xem anh.
export async function taiAnhBaLuong(
  url: string,
  sizeBytes: number,
  signal: AbortSignal,
  fileName?: string | null,
): Promise<string | null> {
  if (!nenTaiAnhNhieuLuong(sizeBytes)) return null;

  try {
    const phan = await Promise.all(
      chiaRange(sizeBytes).map(async ({ batDau, ketThuc }) => {
        const response = await fetch(url, {
          headers: { Range: `bytes=${batDau}-${ketThuc}` },
          signal,
        });
        // 200 nghia la server bo qua Range. Khong ghep ba ban sao cua ca anh.
        if (response.status !== 206) throw new Error(`Range khong duoc ho tro (HTTP ${response.status})`);

        const blob = await response.blob();
        if (blob.size !== ketThuc - batDau + 1) throw new Error("Do dai byte range khong dung");
        return blob;
      }),
    );

    const type = phan.find((blob) => blob.type.startsWith("image/"))?.type || mimeTheoTen(fileName) || "application/octet-stream";
    return URL.createObjectURL(new Blob(phan, { type }));
  } catch (error) {
    if ((error as DOMException | undefined)?.name === "AbortError") throw error;
    return null;
  }
}
