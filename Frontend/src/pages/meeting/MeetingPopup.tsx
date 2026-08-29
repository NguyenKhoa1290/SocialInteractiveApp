import type { ReactNode } from "react";

// Khung chung cua moi popup trong phong hop (Figma 136:515, 140:497, 140:645,
// 140:218, 136:419): the nen sang #F2F2F7 bo 20, dau la mot the vien 92px co
// ten canh giua va "X Dong" ben phai.
//
// Nen SANG de len phong toi la co y trong ban thiet ke, khong phai nham -
// moi frame popup deu ve vay.
export function MeetingPopup({
  title,
  onClose,
  width = 825,
  children,
}: {
  title: string;
  onClose: () => void;
  // Be rong theo thiet ke, TRUOC khi nhan --s. 825 cho Cai dat, 893 cho
  // Quan ly thanh vien (no co them cot nut ben phai moi hang).
  width?: number;
  children: ReactNode;
}) {
  return (
    <aside className="mpop" style={{ width: `min(calc(${width}px * var(--s)), 96vw)` }}>
      <header className="mpop-head">
        <span className="mpop-title">{title}</span>
        <button type="button" className="mpop-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Đóng
        </button>
      </header>
      <div className="mpop-than">{children}</div>
    </aside>
  );
}

// Cong tac bat/tat - Figma "Nut bat" 138:22 / "Nut tat" 112:770: mot vet dai
// 21 net 30 (thanh mot vien thuoc bo tron 51x30) voi nut tron 21px #D9D9D9.
// Bat thi vet mau #85AEB0, tat thi mau toi.
export function CongTac({
  bat,
  doi,
  nhan,
  khoa = false,
}: {
  bat: boolean;
  doi: (v: boolean) => void;
  nhan: string;
  khoa?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mpop-tac${bat ? " mpop-tac-bat" : ""}`}
      role="switch"
      aria-checked={bat}
      aria-label={nhan}
      title={nhan}
      disabled={khoa}
      onClick={() => doi(!bat)}
    >
      <span className="mpop-tac-nut" />
    </button>
  );
}

// Mot hang "nhan ben trai, cong tac ben phai" - dung o ca Cai dat lan Cai
// dat phong.
export function HangTac({
  nhan,
  bat,
  doi,
  khoa = false,
}: {
  nhan: string;
  bat: boolean;
  doi: (v: boolean) => void;
  khoa?: boolean;
}) {
  return (
    <div className="mpop-hang-tac">
      <span>{nhan}</span>
      <CongTac bat={bat} doi={doi} nhan={nhan} khoa={khoa} />
    </div>
  );
}
