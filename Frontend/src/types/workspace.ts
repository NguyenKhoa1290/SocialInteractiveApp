export type MemberRole = "leader" | "deputy" | "member";

export interface WorkspaceSummary {
  id: number;
  name: string;
  avatarUrl: string | null;
  myRole: MemberRole;
  updatedAt: string;
}

export interface Workspace {
  id: number;
  name: string;
  avatarUrl: string | null;
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
