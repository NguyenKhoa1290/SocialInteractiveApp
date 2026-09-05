// Trang thai cua NGUOI DANG GOI doi voi 1 cuoc hop (khong phai thuoc tinh
// chung cua cuoc hop) - xem MeetingWithCallerStatusResponse ben Media
// Service. Co che poll thay WebSocket vi Media Service chua co tang realtime.
export type CallerStatus = "host" | "participant" | "pending" | "denied" | "approved" | "not_joined";

export type MeetingStatus = "active" | "ended";

export interface Meeting {
  id: number;
  hostId: number;
  // Nguoi MO phong - bat bien. Khac hostId khi chu roi phong va quyen dang
  // tam o nguoi khac; chu that quay lai la lay lai ngay.
  creatorId: number;
  conversationId: number | null;
  status: MeetingStatus;
  maxParticipants: number;
  createdAt: string;
  /** Phòng tuỳ chỉnh: không mở từ nhóm nào, và toàn bộ hội thoại + tệp bên
   *  trong bị xoá khi cuộc họp kết thúc. */
  isTemporary: boolean;
  /** Có bật phòng chờ hay không - chủ phòng bật/tắt được ngay trong phòng. */
  requiresApproval: boolean;

  /* "Cài đặt phòng" (Figma 140:645) - MẶC ĐỊNH CỦA CẢ PHÒNG, áp cho cả người
   * vào sau. Riêng từng người thì một hàng `no_*` trong permissions đè lên
   * trên; chủ phòng luôn được phép. */
  allowCamera: boolean;
  allowMic: boolean;
  allowScreenShare: boolean;
  /** Cho phép một thành viên KHÔNG phải chủ phòng bắt đầu ứng dụng. Mặc định
   *  tắt, và là quyết định của cả phòng - không cấp lẻ từng người. */
  allowMiniApp: boolean;
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

// Chu y ba loai cuoi NGUOC nghia voi ba loai dau: share_screen/mini_app/
// focus_mode co trong mang = DUOC phep, con no_mic/no_camera/no_screen_share
// co trong mang = BI CAM.
//
// no_screen_share them sau, cung dot voi "Cai dat phong": chia se man hinh
// gio mac dinh CO (meeting.allowScreenShare) nen cam mot nguoi moi la thao
// tac dang ghi - giong het mic va camera. share_screen o dau mang chi con de
// doc du lieu cu.
export type PermissionType =
  | "share_screen"
  | "mini_app"
  | "focus_mode"
  | "no_mic"
  | "no_camera"
  | "no_screen_share"
  // Dong chu phong: co du quyen dieu khien cuoc hop nhu chu phong, va la
  // nguoi ke vi thu nhat khi chu phong roi di. Chi chu phong THAT phong hoac
  // thu duoc quyen nay.
  | "co_host";

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
  // Cap KID:KEY hex do nguoi trinh bay nhap, di kem trang thai trinh bay de
  // tat ca client deu co key giai ma Shaka Player.
  clearKey: string | null;
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
  /** Playlist dùng chung do quản trị viên đặt sẵn: ai cũng thấy và xem được. */
  isShared: boolean;
  /** Người đang gọi có sửa được playlist này không - playlist dùng chung thì
   *  ai cũng thấy nhưng chỉ admin sửa. Không phải thuộc tính cố định của
   *  playlist mà là câu trả lời cho "tôi làm gì được với nó". */
  canEdit: boolean;
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
