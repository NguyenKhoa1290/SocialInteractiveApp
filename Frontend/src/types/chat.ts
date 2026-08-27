export type ConversationType = "p2p" | "group";
export type MessageType = "text" | "image" | "video" | "file" | "voice" | "vote" | "system";

export interface ConversationSummary {
  id: number;
  type: ConversationType;
  workspaceId: number | null;
  otherUserId: number | null;
  lastMessageAt: string | null;
  createdAt: string;
}

// Tin nhan cuoi cua mot hoi thoai - chi du du lieu de CLIENT tu giai ma.
export interface LastMessage {
  conversationId: number;
  messageId: number;
  senderId: number | null;
  type: MessageType;
  content: string | null;
  contentNonce: string | null;
  recipientEncryptedKey: string | null;
  isEncrypted: boolean;
  isDeleted: boolean;
  createdAt: string;
}

// Mot tep da gui trong hoi thoai - dung cho luoi "file media da gui".
export interface FileMeta {
  id: number;
  conversationId: number;
  uploadedBy: number;
  fileType: "image" | "video" | "voice" | "file";
  sizeBytes: number;
  uploadedAt: string;
  fileName: string | null;
}

export interface Message {
  id: number;
  // Tin nay tra loi tin nao (null = khong tra loi ai). Xoa tin goc thi ve
  // null - cau tra loi van con, chi mat trich dan.
  replyToId?: number | null;
  conversationId: number;
  senderId: number | null;
  senderDisplayName: string | null;
  type: MessageType;
  content: string | null;
  fileId: number | null;
  isDeleted: boolean;
  createdAt: string;
  isEncrypted: boolean;
  contentNonce: string | null;
  recipientEncryptedKey: string | null;
  isEdited: boolean;
  editedAt: string | null;
}
