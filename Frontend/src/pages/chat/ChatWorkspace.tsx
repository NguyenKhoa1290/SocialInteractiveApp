import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AppShell } from "../../components/AppShell";
import "./workspace.css";

// Bo cuc ba panel cua man hinh chinh (Figma node 111:391).
//
// Ca /app (chua chon hoi thoai nao) lan /app/chat/:id deu dung chung bo cuc
// nay - danh sach ben trai KHONG bien mat khi mo mot cuoc tro chuyen, dung
// nhu ban thiet ke. Truoc day day la hai trang roi nhau va phai bam "Ve danh
// sach chat" de quay lai.
export function ChatWorkspace({
  list,
  chat,
  info,
  hasActive,
  isGroup,
  infoHidden,
}: {
  list: ReactNode;
  chat: ReactNode;
  info?: ReactNode;
  // Chi dung o man hep: chua chon gi thi hien danh sach, chon roi thi hien
  // khung chat. Man rong hien ca hai nen khong dinh gi toi.
  hasActive: boolean;
  // Panel phai rong hon o nhom (462 so voi 416) - xem workspace.css. Va cung
  // la cau tra loi cho thanh dieu huong: /app/chat/:id dung cho ca hai muc
  // nen chi trang nay biet dang mo nhom hay mo chat ca nhan.
  isGroup?: boolean;
  // Da gap thanh thong tin ben phai lai (Figma frame 138:80 "Danh sach nhom
  // An thanh thong tin"). Cot thu ba thu ve 0 va khung chat an het cho trong.
  infoHidden?: boolean;
}) {
  // Man hinh hep khong du cho ca ba cot cua ban desktop. Thay vi chi an bot
  // panel (va lam mat luon phan thong tin), coi moi cot la mot man nho: nguoi
  // dung bam thanh chuyen de xem Danh sach / Tin nhan / Thong tin.
  //
  // Trang danh sach chua chon hoi thoai nao thi chi co panel dau tien. Vao
  // mot hoi thoai bang link truc tiep thi bat dau o panel chat, dung voi y
  // dinh cua URL va tranh hien man danh sach roi moi nhay sang chat.
  type MobilePanel = "list" | "chat" | "info";
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(() => (hasActive ? "chat" : "list"));

  useEffect(() => {
    setMobilePanel(hasActive ? "chat" : "list");
  }, [hasActive]);

  const coThongTin = info !== undefined;

  return (
    <AppShell activeTab={isGroup ? "groups" : "chat"}>
      <div
        className={`cw cw-mobile-${mobilePanel}${hasActive ? "" : " cw-no-active"}${isGroup ? " cw-group" : ""}${
          infoHidden ? " cw-info-off" : ""
        }`}
      >
        {hasActive && (
          <nav className="cw-mobile-tabs" aria-label="Chuyen phan hoi thoai">
            <button
              type="button"
              className={mobilePanel === "list" ? "active" : ""}
              onClick={() => setMobilePanel("list")}
              aria-current={mobilePanel === "list" ? "page" : undefined}
            >
              Danh sach
            </button>
            <button
              type="button"
              className={mobilePanel === "chat" ? "active" : ""}
              onClick={() => setMobilePanel("chat")}
              aria-current={mobilePanel === "chat" ? "page" : undefined}
            >
              Tin nhan
            </button>
            <button
              type="button"
              className={mobilePanel === "info" ? "active" : ""}
              onClick={() => setMobilePanel("info")}
              disabled={!coThongTin}
              aria-current={mobilePanel === "info" ? "page" : undefined}
            >
              Thong tin
            </button>
          </nav>
        )}
        <div className="cw-col cw-col-list">{list}</div>
        <div className="cw-col cw-col-chat">{chat}</div>
        {info !== undefined && <div className="cw-col cw-col-info">{info}</div>}
      </div>
    </AppShell>
  );
}
