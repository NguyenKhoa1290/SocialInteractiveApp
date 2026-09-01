import { useEffect, useState, type ReactNode } from "react";
import wordmark from "../assets/calli/calli-wordmark.svg";
import "./device-gate.css";

// Calli duoc ve cho man hinh may tinh 1920x1080 (xem --s trong index.css).
// File nay chan hai truong hop khong dung duoc:
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

// Do rong toi thieu (px CSS).
//
// Con so nay la MUC THOAI MAI chu khong phai muc vo. Do tren he thong that:
// khong trang nao tran ngang cho toi tan 640px, va phong hop tu chuyen thanh
// doc xuong day o be hep. Nhung popup trong phong hop rong 826 x --s = 661px,
// nen duoi ~700px la chung cham sat hai mep. 900 de lai mot khoang tho, dong
// thoi khong lam phien: mot cua so chiem NUA man hinh 1920 la 960px - van
// yen. Muon noi/that chat thi doi moi con so nay.
const RONG_TOI_THIEU = 900;

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

export function DeviceGate({ children }: { children: ReactNode }) {
  // Thiet bi khong doi giua chung mot phien, nen chi do MOT lan. Do lai moi
  // lan render vua thua vua khien man hinh chop khi trinh duyet doi cau tra
  // loi cho matchMedia luc dang xoay may.
  const [diDong] = useState(laDiDong);

  const [rong, setRong] = useState(() => window.innerWidth);
  useEffect(() => {
    if (diDong) return;
    const doLai = () => setRong(window.innerWidth);
    window.addEventListener("resize", doLai);
    return () => window.removeEventListener("resize", doLai);
  }, [diDong]);

  if (diDong)
    return (
      <ManBao tieuDe="Calli chưa hỗ trợ điện thoại">
        <p>
          Ứng dụng hiện chỉ chạy trên máy tính. Hãy mở lại trang này bằng máy tính để trò chuyện và tham
          gia cuộc họp.
        </p>
        <p className="dgate-phu">
          Bật “Trang cho máy tính” trong trình duyệt cũng chưa dùng được - giao diện vẫn cần một màn hình
          rộng thật sự.
        </p>
      </ManBao>
    );

  return (
    <>
      {children}
      {rong < RONG_TOI_THIEU && (
        <ManBao tieuDe="Hãy mở rộng cửa sổ">
          <p>
            Calli cần cửa sổ rộng ít nhất <b>{RONG_TOI_THIEU}px</b> để hiển thị đủ. Kéo rộng cửa sổ trình
            duyệt là lời nhắc này tự biến mất.
          </p>
          <p className="dgate-phu">
            Đang rộng {rong}px - thiếu {RONG_TOI_THIEU - rong}px.
          </p>
        </ManBao>
      )}
    </>
  );
}
