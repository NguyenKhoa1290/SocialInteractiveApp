import { useState } from "react";
import { avatarUrl } from "../lib/avatarUrl";

// Anh dai dien dung chung.
//
// Chua co anh thi hien chu cai dau tren nen mau nhan - de mot vong tron rong
// thi khong phan biet duoc ai voi ai. Anh hong (mat mang, server tra 404 vi
// vua bi xoa o tab khac) cung lui ve dung chu cai do, khong de lai o anh vo.
export function Avatar({
  userId,
  nickname,
  avatarUpdatedAt,
  size,
  className,
}: {
  userId: number;
  nickname: string | null | undefined;
  avatarUpdatedAt: string | null | undefined;
  // Duong kinh tinh bang px TRUOC khi nhan --s. Truyen thang vao style de mot
  // component dung duoc cho ca thanh dieu huong (48) lan man thong tin (340).
  size: number;
  className?: string;
}) {
  const [hong, setHong] = useState(false);
  const src = avatarUrl(userId, avatarUpdatedAt);
  const chuDau = (nickname ?? "?").trim().charAt(0).toUpperCase() || "?";

  const style = {
    width: `calc(${size}px * var(--s))`,
    height: `calc(${size}px * var(--s))`,
    fontSize: `calc(${Math.round(size * 0.42)}px * var(--s))`,
  };

  if (src && !hong) {
    return (
      <img
        className={`avatar${className ? " " + className : ""}`}
        style={style}
        src={src}
        alt={nickname ?? "Ảnh đại diện"}
        onError={() => setHong(true)}
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
