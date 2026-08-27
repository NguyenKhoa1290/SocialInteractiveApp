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
}: {
  list: ReactNode;
  chat: ReactNode;
  info?: ReactNode;
  // Chi dung o man hep: chua chon gi thi hien danh sach, chon roi thi hien
  // khung chat. Man rong hien ca hai nen khong dinh gi toi.
  hasActive: boolean;
  // Panel phai rong hon o nhom (462 so voi 416) - xem workspace.css.
  isGroup?: boolean;
}) {
  return (
    <AppShell>
      <div className={`cw${hasActive ? "" : " cw-no-active"}${isGroup ? " cw-group" : ""}`}>
        <div className="cw-col cw-col-list">{list}</div>
        <div className="cw-col cw-col-chat">{chat}</div>
        {info !== undefined && <div className="cw-col cw-col-info">{info}</div>}
      </div>
    </AppShell>
  );
}
