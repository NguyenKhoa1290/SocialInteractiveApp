import { workspaceHttp } from "./httpClient";
import type { Workspace, WorkspaceMember, WorkspaceSummary } from "../types/workspace";

export const workspaceApi = {
  listMine: () => workspaceHttp.get<WorkspaceSummary[]>("/workspaces"),

  get: (id: number) => workspaceHttp.get<Workspace>(`/workspaces/${id}`),

  create: (name: string, avatarUrl?: string) =>
    workspaceHttp.post<Workspace>("/workspaces", { name, avatarUrl: avatarUrl ?? null }),

  update: (id: number, patch: { name?: string; avatarUrl?: string }) =>
    workspaceHttp.patch<Workspace>(`/workspaces/${id}`, patch),

  remove: (id: number) => workspaceHttp.delete<void>(`/workspaces/${id}`),

  // Anh nhom: gui THANG byte trong than request, khong boc multipart - client
  // da co san mot Blob sau khi cat/nen (lib/imageResize.ts). Chi Truong nhom
  // va Pho nhom duoc goi, server tu chan bang 403.
  uploadAvatar: (id: number, blob: Blob) =>
    workspaceHttp.put<{ avatarUpdatedAt: string | null }>(`/workspaces/${id}/avatar`, blob, {
      headers: { "Content-Type": blob.type || "application/octet-stream" },
    }),

  deleteAvatar: (id: number) =>
    workspaceHttp.delete<{ avatarUpdatedAt: string | null }>(`/workspaces/${id}/avatar`),

  listMembers: (id: number) => workspaceHttp.get<WorkspaceMember[]>(`/workspaces/${id}/members`),

  addMember: (id: number, userId: number) =>
    workspaceHttp.post<WorkspaceMember>(`/workspaces/${id}/members`, { userId }),

  removeMember: (id: number, userId: number) => workspaceHttp.delete<void>(`/workspaces/${id}/members/${userId}`),

  updateRole: (id: number, userId: number, role: "deputy" | "member") =>
    workspaceHttp.patch<WorkspaceMember>(`/workspaces/${id}/members/${userId}/role`, { role }),
};
