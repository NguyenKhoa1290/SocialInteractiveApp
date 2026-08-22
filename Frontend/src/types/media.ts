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

// Chu y hai loai cuoi NGUOC nghia voi ba loai dau: share_screen/mini_app/
// focus_mode co trong mang = DUOC phep, con no_mic/no_camera co trong mang =
// BI CAM (mic va camera mac dinh ai cung bat duoc).
export type PermissionType = "share_screen" | "mini_app" | "focus_mode" | "no_mic" | "no_camera";

// Trang thai "ai dang trinh bay" - doc tu metadata cua phong LiveKit
// (RoomMetadataChanged), khong phai tu REST. Chi MOT nguoi tai mot thoi diem.
// CHI nhung thu thuc su dung chung ca phong (man hinh dang chia se, mini app
// dang mo). Viec "ghim ai vao giua" KHONG nam o day - do la lua chon xem
// rieng cua tung nguoi, xu ly hoan toan o Frontend.
export interface PresentationState {
  userId: number;
  nickname: string;
  kind: "screen" | "mini_app";
  appId: string | null;
  startedAt: string;
  // Chi co nghia voi kind = "mini_app": kenh MA CA PHONG dang xem. null =
  // da mo Mini App nhung chua chon kenh -> client hien "Dang cho gan link kenh".
  channelId: number | null;
  channelName: string | null;
  // Link nguoi trinh bay dan thang vao, khong qua danh sach kenh. Duong song
  // song voi channelId - cai nao co thi dung cai do, channelUrl uu tien.
  channelUrl: string | null;
}

export interface RoomMetadata {
  presentation?: PresentationState | null;
}

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
