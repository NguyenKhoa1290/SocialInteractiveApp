import { useEffect, useState, type ReactNode } from "react";
import wordmark from "../assets/calli/calli-wordmark.svg";
import "./device-gate.css";

// All layouts, including meetings on desktop and mobile, keep viewport limits.
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

export function DeviceGate({ children }: { children: ReactNode }) {
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
      {lyDo ? (
        <PopupPhongTo />
      ) : null}
    </>
  );
}
