import { useEffect, useState, type ReactNode } from "react";
import wordmark from "../assets/calli/calli-wordmark.svg";
import "./device-gate.css";

// Desktop meeting windows can resize freely; mobile devices keep viewport limits.
// Gioi han cua giao dien responsive thong thuong. 22:9 la ty le doc dai
// nhat da duoc ho tro; vuot qua moc nay, cot noi dung qua hep so voi chieu
// cao. Chieu nguoc lai cung chan khung qua ngang/thap (hon 22:9), vi thanh
// soan va dieu huong se chen nhau theo chieu doc.
const RONG_APP_TOI_THIEU = 360;
const CAO_APP_TOI_THIEU = 400;
const TY_LE_DOC_HEP_NHAT = 9 / 22;
const TY_LE_NGANG_RONG_NHAT = 22 / 9;

type Khung = { rong: number; cao: number };
type LyDoPhongTo = "be" | "doc" | "ngang" | null;

function layKhung(): Khung {
  return { rong: window.innerWidth, cao: window.innerHeight };
}

function lyDoPhongTo({ rong, cao }: Khung): LyDoPhongTo {
  if (rong < RONG_APP_TOI_THIEU || cao < CAO_APP_TOI_THIEU) return "be";
  const tyLe = rong / cao;
  // Dung mot sai so nho de 360x880 (= 9:22) khong bi chan boi sai so dau
  // phay cua trinh duyet.
  if (tyLe < TY_LE_DOC_HEP_NHAT - 0.01) return "doc";
  if (tyLe > TY_LE_NGANG_RONG_NHAT + 0.01) return "ngang";
  return null;
}

function laDiDong(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };

  // 1. Trinh duyet tu khai. Chi tin khi no noi "dung" - che do may tinh dat
  //    co nay ve false, nen mot cau false khong chung minh duoc gi.
  if (nav.userAgentData?.mobile === true) return true;

  // 2. Chuoi UA - bat duoc che do binh thuong tren moi trinh duyet.
  if (/Android|iPhone|iPod|iPad|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent))
    return true;

  // 3. iPad tu iPadOS 13 khai la "Macintosh" ngay ca o che do mac dinh. May
  //    Mac that khong co man cam ung, nen Macintosh + nhieu diem cham =
  //    iPad.
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;

  // 4. Duong cuoi, va la duong duy nhat con dung khi UA da bi thay: PHAN CUNG
  //    thi khong gia duoc. `hover: none` = khong co con tro nao ro len duoc,
  //    `pointer: coarse` = dau tro to nhu dau ngon tay.
  //
  //    Laptop co man cam ung KHONG dinh vao day: con ban di chuot nen trinh
  //    duyet van bao `hover: hover` va `pointer: fine`. Cai lot luoi nguoc
  //    lai la may tinh bang Windows dung khong chuot - nhung o do Calli cung
  //    khong dung duoc that, nen bao la dung.
  const khongCoChuot = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  return khongCoChuot && navigator.maxTouchPoints > 0;
}

function ManBao({
  tieuDe,
  children,
}: {
  tieuDe: string;
  children: ReactNode;
}) {
  return (
    <div className="dgate" role="alertdialog" aria-modal="true" aria-label={tieuDe}>
      <div className="dgate-hop">
        <img className="dgate-logo" src={wordmark} alt="Calli" />
        <h1 className="dgate-tieu-de">{tieuDe}</h1>
        {children}
      </div>
    </div>
  );
}

export function DeviceGate({ children, allowSmallViewport = false }: { children: ReactNode; allowSmallViewport?: boolean }) {
  const [diDong] = useState(laDiDong);
  const [khung, setKhung] = useState(layKhung);
  useEffect(() => {
    const doLai = () => setKhung(layKhung());
    window.addEventListener("resize", doLai);
    window.addEventListener("orientationchange", doLai);
    return () => {
      window.removeEventListener("resize", doLai);
      window.removeEventListener("orientationchange", doLai);
    };
  }, []);

  const lyDo = lyDoPhongTo(khung);

  function PopupPhongTo() {
    const chuLyDo =
      lyDo === "doc"
        ? "Màn hình đang quá hẹp so với chiều cao."
        : lyDo === "ngang"
          ? "Màn hình đang quá ngang hoặc quá thấp."
          : "Kích thước hiển thị hiện tại quá nhỏ.";
    return (
      <ManBao tieuDe="Hãy phóng to cửa sổ">
        <p>{chuLyDo} Hãy xoay máy hoặc phóng to cửa sổ để tiếp tục.</p>
        <p className="dgate-phu">
          Giao diện cần tối thiểu {RONG_APP_TOI_THIEU}×{CAO_APP_TOI_THIEU}px và tỷ lệ trong khoảng 9:22 đến 22:9.
          Hiện tại: {khung.rong}×{khung.cao}px.
        </p>
      </ManBao>
    );
  }

  return (
    <>
      {children}
      {(!allowSmallViewport || diDong) && lyDo ? (
        <PopupPhongTo />
      ) : null}
    </>
  );
}
