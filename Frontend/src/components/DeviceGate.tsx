import { useEffect, useState, type ReactNode } from "react";
import wordmark from "../assets/calli/calli-wordmark.svg";
import "./device-gate.css";

// Phong hop hien van duoc ve cho man hinh may tinh 1920x1080 (xem --s trong
// index.css). Rieng cac man app thong thuong da co bo cuc dien thoai. Tuy
// nhien, ca hai van can mot gioi han vat ly de khong dua nguoi dung vao mot
// khung qua nho / qua dai ma giao dien khong con doc duoc.
//
// O route phong hop, file nay con chan them hai truong hop khong dung duoc:
//
//   1. Dien thoai / may tinh bang - ke ca khi bat "che do may tinh"
//   2. Cua so may tinh bi keo qua hep
//
// Hai truong hop xu ly KHAC nhau, co y:
//   - Dien thoai thi khong dung duoc va cung khong sua duoc, nen thay han
//     noi dung: khong mount ung dung, khong mo ket noi LiveKit/SignalR nao.
//   - Cua so hep chi la tam thoi. O do ung dung VAN chay ben duoi, chi phu
//     mot lop bao len tren. Neu thao ung dung ra thi ai dang hop ma lo keo
//     nho cua so se bi ngat khoi phong - dung mot cai nhac nho ma cat cuoc
//     goi cua nguoi ta la khong duoc.

// Do rong toi thieu cua PHONG HOP (px CSS).
//
// Con so nay la MUC THOAI MAI chu khong phai muc vo. Do tren he thong that:
// khong trang nao tran ngang cho toi tan 640px, va phong hop tu chuyen thanh
// doc xuong day o be hep. Nhung popup trong phong hop rong 826 x --s = 661px,
// nen duoi ~700px la chung cham sat hai mep. 900 de lai mot khoang tho, dong
// thoi khong lam phien: mot cua so chiem NUA man hinh 1920 la 960px - van
// yen. Muon noi/that chat thi doi moi con so nay.
const RONG_TOI_THIEU = 900;

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

// Co phai dien thoai/may tinh bang khong.
//
// Cho kho: Chrome tren Android co "Che do may tinh" - no thay chuoi UA thanh
// UA may ban va noi khung nhin ra 980px, nen moi cach nhan dang dua tren UA
// deu tra loi sai. Nen o day di tu trong ra ngoai: bon dau hieu, chi can mot
// cai dung la du.
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

export function DeviceGate({ children, blockNarrow = false }: { children: ReactNode; blockNarrow?: boolean }) {
  // Thiet bi khong doi giua chung mot phien, nen chi do MOT lan. Do lai moi
  // lan render vua thua vua khien man hinh chop khi trinh duyet doi cau tra
  // loi cho matchMedia luc dang xoay may.
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

  if (diDong)
    return blockNarrow ? (
      <ManBao tieuDe="Phòng họp chưa hỗ trợ điện thoại">
        <p>
          Phần nhắn tin đã dùng được trên điện thoại, nhưng giao diện cuộc họp đang được hoàn thiện.
          Hãy mở lại liên kết này bằng máy tính để tham gia cuộc họp.
        </p>
        <p className="dgate-phu">
          Bật “Trang cho máy tính” trong trình duyệt cũng chưa đủ để dùng phần cuộc họp.
        </p>
      </ManBao>
    ) : lyDo ? (
      <>
        {children}
        <PopupPhongTo />
      </>
    ) : <>{children}</>;

  return (
    <>
      {children}
      {blockNarrow && khung.rong < RONG_TOI_THIEU ? (
        <ManBao tieuDe="Hãy mở rộng cửa sổ">
          <p>
            Phòng họp cần cửa sổ rộng ít nhất <b>{RONG_TOI_THIEU}px</b> để hiển thị đủ. Kéo rộng cửa sổ trình
            duyệt là lời nhắc này tự biến mất.
          </p>
          <p className="dgate-phu">
            Đang rộng {khung.rong}px - thiếu {RONG_TOI_THIEU - khung.rong}px.
          </p>
        </ManBao>
      ) : lyDo ? (
        <PopupPhongTo />
      ) : null}
    </>
  );
}
