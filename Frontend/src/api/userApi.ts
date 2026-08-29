import { identityHttp } from "./httpClient";
import type { PublicUser } from "../types/auth";

export const userApi = {
  // Ho so cong khai cua NHIEU nguoi mot lan goi.
  //
  // Dung o nhung man hinh chi biet userId ma lai can ten + anh dai dien: luoi
  // nguoi trong phong hop la vi du ro nhat - Media Service khong luu moc doi
  // anh, ma thieu moc do thi avatarUrl() tra null va o nao cung chi hien duoc
  // chu cai dau (xem lib/avatarUrl.ts).
  //
  // Server chan 200 id mot lan goi va bo qua id khong ton tai.
  byIds: (ids: number[]) => identityHttp.get<PublicUser[]>("/users", { params: { ids: ids.join(",") } }),
};
