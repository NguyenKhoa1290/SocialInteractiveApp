// Cat va nen anh dai dien NGAY TRONG TRINH DUYET truoc khi gui len.
//
// Vi sao lam o day chu khong o server: anh may dien thoai bay gio thuong 3-8MB.
// Gui nguyen len roi de server nen thi vua ton bang thong cua nguoi dung, vua
// bat server phai keo them mot thu vien xu ly anh, vua co nguy co dut giua
// chung dung nhu chuyen tai file lon da gap. Cat truoc thi cai bay len chi con
// vai chuc KB - mot request nho, gan nhu khong the hong.
//
// Server VAN kiem lai kich thuoc va chu ky byte: khong bao gio tin client.

// Anh dai dien luon hien trong khung tron, nen cat VUONG o giua roi thu nho.
const MAX_SIZE = 512;

// Phai khop voi AvatarMaxBytes ben UsersEndpoints.cs.
const MAX_BYTES = 256 * 1024;

// Ha chat luong dan cho toi khi lot nguong. Bat dau tu 0.85 - do net mat
// thuong khong phan biet duoc voi ban goc o co 512px.
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

async function toBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap giai ma anh o luong nen, khong lam khung hinh giat nhu
  // cach cu (tao <img> roi doi onload tren luong chinh).
  return await createImageBitmap(file);
}

export type ResizedImage = { blob: Blob; width: number; height: number };

export async function resizeAvatar(file: File): Promise<ResizedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Tệp này không phải ảnh");
  }

  const bitmap = await toBitmap(file);
  try {
    // Cat vuong o giua: lay canh ngan lam chuan roi bo deu hai ben canh dai.
    const canh = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - canh) / 2;
    const sy = (bitmap.height - canh) / 2;
    const size = Math.min(canh, MAX_SIZE);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không dựng được ảnh");

    // Anh dai dien thuong bi thu nho rat nhieu lan, de rang cua neu khong bat
    // noi suy chat luong cao.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, canh, canh, 0, 0, size, size);

    // WebP nen tot hon JPEG kha nhieu o cung do net. Trinh duyet nao khong
    // xuat duoc WebP thi toBlob tra ve PNG - van dung, chi nang hon.
    for (const kieu of ["image/webp", "image/jpeg"] as const) {
      for (const q of QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, kieu, q));
        if (blob && blob.type === kieu && blob.size <= MAX_BYTES) {
          return { blob, width: size, height: size };
        }
      }
    }

    throw new Error("Ảnh quá phức tạp để nén nhỏ, hãy thử ảnh khác");
  } finally {
    // Giai phong bo nho anh da giai ma - anh 8MP chiem hang chuc MB.
    bitmap.close();
  }
}
