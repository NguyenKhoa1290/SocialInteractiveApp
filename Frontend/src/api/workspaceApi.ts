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

  listMembers: (id: number) => workspaceHttp.get<WorkspaceMember[]>(`/workspaces/${id}/members`),

  addMember: (id: number, userId: number) =>
    workspaceHttp.post<WorkspaceMember>(`/workspaces/${id}/members`, { userId }),

  removeMember: (id: number, userId: number) => workspaceHttp.delete<void>(`/workspaces/${id}/members/${userId}`),

  updateRole: (id: number, userId: number, role: "deputy" | "member") =>
    workspaceHttp.patch<WorkspaceMember>(`/workspaces/${id}/members/${userId}/role`, { role }),
};
