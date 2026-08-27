import { useState } from "react";
import { avatarUrl, groupAvatarUrl } from "../lib/avatarUrl";

// Anh dai dien dung chung - cho ca NGUOI DUNG lan NHOM.
//
// Chua co anh thi hien chu cai dau tren nen mau nhan - de mot vong tron rong
// thi khong phan biet duoc ai voi ai. Anh hong (mat mang, server tra 404 vi
// vua bi xoa o tab khac) cung lui ve dung chu cai do, khong de lai o anh vo.

type ChungProps = {
  nickname: string | null | undefined;
  avatarUpdatedAt: string | null | undefined;
  // Duong kinh tinh bang px TRUOC khi nhan --s. Truyen thang vao style de mot
  // component dung duoc cho ca thanh dieu huong (48) lan man thong tin (340).
  size: number;
  className?: string;
};

// Anh nguoi va anh nhom nam o hai service khac nhau nen phai biet dang ve ai.
// Dung kieu "hoac ben nay hoac ben kia" thay vi hai truong tuy chon: goi nham
// ca hai, hay quen ca hai, se bao loi ngay luc bien dich chu khong am tham ve
// mot vong tron trong.
type AvatarProps = ChungProps &
  ({ userId: number; workspaceId?: never } | { workspaceId: number; userId?: never });

export function Avatar({ nickname, avatarUpdatedAt, size, className, ...ai }: AvatarProps) {
  // Nho DIA CHI da hong chu khong chi mot co true/false: doi anh nhom la doi
  // dia chi (?v= moi), va anh moi xung dang duoc thu lai - giu mot co chung
  // thi mot lan hong se khoa vinh vien o do o chu cai.
  const [hongSrc, setHongSrc] = useState<string | null>(null);
  const src =
    ai.workspaceId !== undefined
      ? groupAvatarUrl(ai.workspaceId, avatarUpdatedAt)
      : avatarUrl(ai.userId!, avatarUpdatedAt);
  const chuDau = (nickname ?? "?").trim().charAt(0).toUpperCase() || "?";

  const style = {
    width: `calc(${size}px * var(--s))`,
    height: `calc(${size}px * var(--s))`,
    fontSize: `calc(${Math.round(size * 0.42)}px * var(--s))`,
  };

  if (src && hongSrc !== src) {
    return (
      <img
        className={`avatar${className ? " " + className : ""}`}
        style={style}
        src={src}
        alt={nickname ?? "Ảnh đại diện"}
        onError={() => setHongSrc(src)}
        draggable={false}
      />
    );
  }

  return (
    <span className={`avatar avatar-chu${className ? " " + className : ""}`} style={style} aria-hidden="true">
      {chuDau}
    </span>
  );
}
