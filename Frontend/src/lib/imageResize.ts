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
export type AvatarCrop = { x: number; y: number; size: number };

async function encodeAvatar(bitmap: ImageBitmap, crop: AvatarCrop): Promise<ResizedImage> {
  // Khong tin toa do tu giao dien: kep no lai trong anh goc de canvas khong
  // bao gio ve ra vung trong neu nguoi dung keo sat canh.
  const size = Math.max(1, Math.min(crop.size, bitmap.width, bitmap.height));
  const sx = Math.max(0, Math.min(crop.x, bitmap.width - size));
  const sy = Math.max(0, Math.min(crop.y, bitmap.height - size));
  const outputSize = Math.min(Math.round(size), MAX_SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không dựng được ảnh");

  // Anh dai dien thuong bi thu nho rat nhieu lan, de rang cua neu khong bat
  // noi suy chat luong cao.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, outputSize, outputSize);

  // WebP nen tot hon JPEG kha nhieu o cung do net. Trinh duyet nao khong
  // xuat duoc WebP thi toBlob tra ve PNG - van dung, chi nang hon.
  for (const kieu of ["image/webp", "image/jpeg"] as const) {
    for (const q of QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, kieu, q));
      if (blob && blob.type === kieu && blob.size <= MAX_BYTES) {
        return { blob, width: outputSize, height: outputSize };
      }
    }
  }

  throw new Error("Ảnh quá phức tạp để nén nhỏ, hãy thử ảnh khác");
}

// Cat theo vung nguoi dung chon trong popup chung. Toa do tinh theo pixel cua
// anh goc, nen phan xem truoc o man hinh nho hay lon deu cho ket qua nhu nhau.
export async function cropAvatar(file: File, crop: AvatarCrop): Promise<ResizedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Tệp này không phải ảnh");
  }

  const bitmap = await toBitmap(file);
  try {
    return await encodeAvatar(bitmap, crop);
  } finally {
    bitmap.close();
  }
}

export async function resizeAvatar(file: File): Promise<ResizedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Tệp này không phải ảnh");
  }

  const bitmap = await toBitmap(file);
  try {
    // Ban du phong cho noi goi cu: cat vuong o giua neu chua co popup chon
    // vung anh. Cac luong avatar trong giao dien dung `cropAvatar` ben tren.
    const canh = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - canh) / 2;
    const sy = (bitmap.height - canh) / 2;
    return await encodeAvatar(bitmap, { x: sx, y: sy, size: canh });
  } finally {
    // Giai phong bo nho anh da giai ma - anh 8MP chiem hang chuc MB.
    bitmap.close();
  }
}
