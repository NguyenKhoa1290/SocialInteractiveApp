export type MemberRole = "leader" | "deputy" | "member";

export interface WorkspaceSummary {
  id: number;
  name: string;
  /** Duong dan anh do nguoi dung dan vao - truong cu tu ban dac ta goc. */
  avatarUrl: string | null;
  /** Moc thoi gian anh nhom TU TAI LEN doi lan cuoi; null la chua co anh.
   *  Vua la co "co anh khong", vua la ma chong cache - xem lib/avatarUrl.ts. */
  avatarUpdatedAt: string | null;
  myRole: MemberRole;
  updatedAt: string;
}

export interface Workspace {
  id: number;
  name: string;
  avatarUrl: string | null;
  avatarUpdatedAt: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  memberIds: number[];
}

export interface WorkspaceMember {
  userId: number;
  nickname: string;
  role: MemberRole;
  joinedAt: string;
}
