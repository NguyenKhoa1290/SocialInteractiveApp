// Trang thai cua NGUOI DANG GOI doi voi 1 cuoc hop (khong phai thuoc tinh
// chung cua cuoc hop) - xem MeetingWithCallerStatusResponse ben Media
// Service. Co che poll thay WebSocket vi Media Service chua co tang realtime.
export type CallerStatus = "host" | "participant" | "pending" | "denied" | "approved" | "not_joined";

export type MeetingStatus = "active" | "ended";

export interface Meeting {
  id: number;
  hostId: number;
  conversationId: number | null;
  status: MeetingStatus;
  maxParticipants: number;
  createdAt: string;
}

export interface MeetingWithCallerStatus extends Meeting {
  callerStatus: CallerStatus;
  livekitToken: string | null;
  livekitUrl: string | null;
}

export interface MeetingPreview {
  meetingId: number;
  hostNickname: string;
  participantCount: number;
  requiresApproval: boolean;
}

export interface JoinResult {
  status: "approved" | "pending";
  livekitToken: string | null;
  livekitUrl: string | null;
  meetingId: number;
}

export interface WaitingParticipant {
  userId: number;
  nickname: string;
  requestedAt: string;
}

export interface MeetingParticipant {
  userId: number;
  nickname: string;
  role: "host" | "participant";
  joinedAt: string;
  permissions: PermissionType[];
}

export type PermissionType = "share_screen" | "mini_app" | "focus_mode";

export interface MeetingInvite {
  id: number;
  type: "link" | "direct";
  inviteToken: string;
  expiresAt: string | null;
}

export interface IptvChannelList {
  id: number;
  name: string;
  createdAt: string;
}

export interface IptvChannel {
  id: number;
  channelName: string;
  streamUrl: string;
  audioTrack: string | null;
}

export interface IptvChannelGroup {
  id: number;
  groupName: string;
  channels: IptvChannel[];
}
