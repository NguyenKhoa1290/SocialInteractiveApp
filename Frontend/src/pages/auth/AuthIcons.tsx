// Icon rieng cua popup dang nhap / dang ky.
//
// TRIET LY MAU: don sac theo mau thuong hieu, KHONG dung logo nhieu mau chinh
// thuc cua Google/Facebook. Do duoc tu chinh ban thiet ke: ca hai o icon
// (node 87:312 va 87:313) deu chi mot mau #233040 - dung mau icon cua thanh
// dieu huong. Ban dau toi lam logo nhieu mau va no lac long han giua bang mau
// xanh navy/bac ha.
//
// Dung `currentColor` de mau di theo CSS: tren the trang thi navy, tren chan
// trang nen navy thi trang - mot bo hinh dung duoc ca hai cho.

export function IconEye({ open }: { open: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
      {!open && (
        <path d="M3.6 3.6 20.4 20.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      )}
    </svg>
  );
}

// Chu "G" dac, mot mau - dung nhu trong ban thiet ke.
export function IconGoogle({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.2 10.2v3.5h5c-.2 1.3-1.6 3.9-5 3.9a5.6 5.6 0 0 1 0-11.2c1.6 0 2.7.7 3.3 1.3l2.4-2.3A9 9 0 0 0 12.2 3a9 9 0 1 0 0 18c5.2 0 8.6-3.6 8.6-8.7 0-.7-.1-1.3-.2-1.9l-8.4-.2Z" />
    </svg>
  );
}

// O vuong bo goc mot mau, chu "f" la LO KHOET chu khong phai mot hinh mau
// khac de len.
//
// Ban dau toi ve chu "f" mau trang de len o vuong `currentColor`. Tren the
// dang nhap nen trang thi trong dung, nhung o chan trang nen navy thi
// currentColor la MAU TRANG - thanh ra chu trang tren o trang, icon bien
// thanh mot O TRANG DAC. Bat duoc luc chup man hinh chan trang.
//
// Khoet lo bang fill-rule="evenodd": mot duong dan duy nhat, phan chu "f"
// trong suot nen lo ra dung mau nen dang co - navy tren the trang, trang tren
// chan trang navy. Mot hinh dung duoc ca hai cho.
export function IconFacebook({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M5.4 0H18.6A5.4 5.4 0 0 1 24 5.4V18.6A5.4 5.4 0 0 1 18.6 24H5.4A5.4 5.4 0 0 1 0 18.6V5.4A5.4 5.4 0 0 1 5.4 0ZM15.8 12.6h-2.3V20h-3.1v-7.4H8.6V9.9h1.8V8.4c0-1.9 1-3.4 3.4-3.4h2v2.7h-1.4c-.6 0-.9.3-.9.9v1.3h2.4l-.1 2.7Z"
      />
    </svg>
  );
}

// --- Icon mang xa hoi o chan trang -----------------------------------------
//
// Ban thiet ke de bon o giu cho 332x110 con TRONG (xuat ra chi 723 byte, gan
// nhu trong suot) nen khong co gi de lay. Ve theo dung triet ly o tren: mot
// mau, di theo currentColor - o chan trang nen navy thi chung se la mau trang.

export function IconInstagram({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.4" y="2.4" width="19.2" height="19.2" rx="5.4" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="17.4" cy="6.6" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function IconGitHub({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1.8a10.2 10.2 0 0 0-3.2 19.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.2 10.2 0 0 0 12 1.8Z" />
    </svg>
  );
}

export function IconZalo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2c5 0 9 3.3 9 7.4 0 4-4 7.3-9 7.3-.9 0-1.7-.1-2.5-.3l-4 2.2.9-3.4A7 7 0 0 1 3 10.6c0-4.1 4-7.4 9-7.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 8.4h3.4L8.2 13h3.6M14.4 8.4V13M17.6 10.2v2.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
