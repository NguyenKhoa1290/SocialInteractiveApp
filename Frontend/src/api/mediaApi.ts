import { mediaHttp } from "./httpClient";
import type {
  IptvChannelGroup,
  IptvChannelList,
  JoinResult,
  Meeting,
  MeetingInvite,
  MeetingParticipant,
  MeetingPreview,
  MeetingWithCallerStatus,
  PermissionType,
  PresentationState,
  WaitingParticipant,
} from "../types/media";

export const meetingApi = {
  // mode=in_chat gan cuoc hop voi 1 hoi thoai (ca nhom vao thang duoc);
  // mode=standalone la cuoc hop doc lap, chi vao duoc bang link moi.
  // Ten gia tri phai dung theo enum trong media-service-api.yaml
  // (`enum: [in_chat, standalone]`) - truoc day Frontend gui "direct", chay
  // dung nhung lech hop dong API.
  create: (mode: "in_chat" | "standalone", conversationId?: number) =>
    mediaHttp.post<Meeting>("/meetings", { mode, conversationId: conversationId ?? null }),

  // 204 (data rong) khi hoi thoai khong co cuoc hop nao dang mo.
  getActiveForConversation: (conversationId: number) =>
    mediaHttp.get<Meeting | "">("/meetings/active", { params: { conversationId } }),

  // Nguon duy nhat cho biet "toi dang o dau" trong cuoc hop nay - phai POLL
  // vi Media Service chua co tang WebSocket (livekitToken chi tra 1 LAN duy
  // nhat ngay sau khi host duyet, doc xong la mat).
  get: (meetingId: number) => mediaHttp.get<MeetingWithCallerStatus>(`/meetings/${meetingId}`),

  joinInChat: (meetingId: number, nickname?: string) =>
    mediaHttp.post<JoinResult>(`/meetings/${meetingId}/join`, { nickname: nickname ?? null }),

  leave: (meetingId: number) => mediaHttp.post<void>(`/meetings/${meetingId}/leave`),

  end: (meetingId: number) => mediaHttp.post<void>(`/meetings/${meetingId}/end`),

  listParticipants: (meetingId: number) =>
    mediaHttp.get<MeetingParticipant[]>(`/meetings/${meetingId}/participants`),

  listWaitingRoom: (meetingId: number) =>
    mediaHttp.get<WaitingParticipant[]>(`/meetings/${meetingId}/waiting-room`),

  approveWaiting: (meetingId: number, userId: number) =>
    mediaHttp.post<void>(`/meetings/${meetingId}/waiting-room/${userId}/approve`),

  denyWaiting: (meetingId: number, userId: number) =>
    mediaHttp.post<void>(`/meetings/${meetingId}/waiting-room/${userId}/deny`),

  kick: (meetingId: number, userId: number) =>
    mediaHttp.post<void>(`/meetings/${meetingId}/participants/${userId}/kick`),

  grantPermission: (meetingId: number, userId: number, permissionType: PermissionType) =>
    mediaHttp.post<void>(`/meetings/${meetingId}/participants/${userId}/permissions`, { permissionType }),

  revokePermission: (meetingId: number, userId: number, permissionType: PermissionType) =>
    mediaHttp.delete<void>(`/meetings/${meetingId}/participants/${userId}/permissions`, { params: { permissionType } }),

  // Gianh "suat trinh bay" - chi mot nguoi tai mot thoi diem, nguoi sau bi
  // 409 chu khong de len nguoi truoc. Goi TRUOC khi thuc su bat chia se man
  // hinh / mo mini app.
  startPresentation: (
    meetingId: number,
    kind: "screen" | "mini_app",
    opts?: { appId?: string; channelId?: number; channelName?: string },
  ) =>
    mediaHttp.post<PresentationState>(`/meetings/${meetingId}/presentation`, {
      kind,
      appId: opts?.appId ?? null,
      channelId: opts?.channelId ?? null,
      channelName: opts?.channelName ?? null,
    }),

  stopPresentation: (meetingId: number) => mediaHttp.delete<void>(`/meetings/${meetingId}/presentation`),

  createInvite: (meetingId: number, type: "link" | "direct", invitedUserId?: number) =>
    mediaHttp.post<MeetingInvite>(`/meetings/${meetingId}/invites`, { type, invitedUserId: invitedUserId ?? null }),

  previewInvite: (inviteToken: string) => mediaHttp.get<MeetingPreview>(`/meetings/join/${inviteToken}`),

  joinByInvite: (inviteToken: string, nickname?: string) =>
    mediaHttp.post<JoinResult>(`/meetings/join/${inviteToken}`, { nickname: nickname ?? null }),
};

export const iptvApi = {
  listChannelLists: () => mediaHttp.get<IptvChannelList[]>("/miniapps/iptv/channel-lists"),

  createChannelList: (name: string) => mediaHttp.post<IptvChannelList>("/miniapps/iptv/channel-lists", { name }),

  listGroups: (listId: number) =>
    mediaHttp.get<IptvChannelGroup[]>(`/miniapps/iptv/channel-lists/${listId}/groups`),

  createGroup: (listId: number, groupName: string) =>
    mediaHttp.post<void>(`/miniapps/iptv/channel-lists/${listId}/groups`, { groupName }),

  // Nhap ca mot playlist M3U. Server tu tai va tach - trinh duyet khong tai
  // truc tiep duoc vi may chu IPTV gan nhu khong bao gio gui header CORS.
  importPlaylist: (listId: number, url: string) =>
    mediaHttp.post<{ isPlaylist: boolean; imported: number; skipped: number; newGroups: number }>(
      `/miniapps/iptv/channel-lists/${listId}/import`,
      { url },
    ),

  createChannel: (listId: number, groupId: number, channelName: string, streamUrl: string, audioTrack?: string) =>
    mediaHttp.post<void>(`/miniapps/iptv/channel-lists/${listId}/groups/${groupId}/channels`, {
      channelName,
      streamUrl,
      audioTrack: audioTrack || null,
    }),

  // Trong 1 phien hop: bao "toi mo mini app" (chi kiem tra quyen - chua
  // broadcast thuc su duoc vi Media Service chua co tang WebSocket).
  startMiniApp: (meetingId: number, appId = "iptv") =>
    mediaHttp.post<{ appId: string }>(`/meetings/${meetingId}/mini-app/start`, { appId }),

  // Moi nguoi trong phong TU fetch stream rieng (UC-37 buoc 4).
  getStreamUrl: (meetingId: number, channelId: number) =>
    mediaHttp.get<{ streamUrl: string; audioTrack: string | null }>(
      `/meetings/${meetingId}/mini-app/iptv/stream-url`,
      { params: { channelId } },
    ),
};
