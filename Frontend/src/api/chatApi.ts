import { chatHttp } from "./httpClient";
import type { ConversationSummary, ConversationType, Message, MessageType } from "../types/chat";

export interface ConversationDetail {
  id: number;
  type: ConversationType;
  workspaceId: number | null;
  participantAId: number | null;
  participantBId: number | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface UploadUrlResponse {
  fileId: number;
  uploadUrl: string;
  // Co gia tri = file nay phai tai len theo NHIEU PHAN. Xem uploadFile().
  uploadId?: string | null;
  partSizeBytes?: number;
  partUrls?: string[] | null;
  expiresInSeconds: number;
}

export const chatApi = {
  listConversations: () => chatHttp.get<ConversationSummary[]>("/conversations"),

  createOrGetP2P: (otherUserId: number) => chatHttp.post<ConversationSummary>("/conversations/p2p", { otherUserId }),

  getConversation: (id: number) => chatHttp.get<ConversationDetail>(`/conversations/${id}`),

  getMessages: (conversationId: number, before?: string, limit = 50) =>
    chatHttp.get<Message[]>(`/conversations/${conversationId}/messages`, { params: { before, limit } }),

  // F2 chi gui duoc cac loai KHONG phai Text (Text bat buoc E2EE, de danh
  // cho F3) - content/contentNonce/recipientKeys deu bo trong.
  sendFileMessage: (conversationId: number, type: Exclude<MessageType, "text" | "system">, fileId: number) =>
    chatHttp.post<Message>(`/conversations/${conversationId}/messages`, { type, fileId }),

  sendTextMessage: (
    conversationId: number,
    content: string,
    contentNonce: string,
    recipientKeys?: { userId: number; encryptedKey: string }[],
    searchTokens?: string[],
  ) =>
    chatHttp.post<Message>(`/conversations/${conversationId}/messages`, {
      type: "text",
      content,
      contentNonce,
      recipientKeys,
      searchTokens,
    }),

  editTextMessage: (conversationId: number, messageId: number, content: string, contentNonce: string, searchTokens?: string[]) =>
    chatHttp.patch<Message>(`/conversations/${conversationId}/messages/${messageId}`, { content, contentNonce, searchTokens }),

  recallMessage: (conversationId: number, messageId: number) =>
    chatHttp.post<void>(`/conversations/${conversationId}/messages/${messageId}/recall`),

  deleteMessage: (conversationId: number, messageId: number) =>
    chatHttp.delete<void>(`/conversations/${conversationId}/messages/${messageId}`),

  searchMessages: (conversationId: number, params: { tokens?: string[]; senderId?: number; type?: MessageType; from?: string; to?: string }) =>
    chatHttp.get<Message[]>(`/conversations/${conversationId}/messages/search`, {
      params: {
        tokens: params.tokens?.length ? params.tokens.join(",") : undefined,
        senderId: params.senderId,
        type: params.type,
        from: params.from,
        to: params.to,
      },
    }),

  // meetingId (tuy chon): file gui trong luong thao luan cua cuoc hop -
  // van tinh vao han muc luu tru cua nhom nhu file chat binh thuong.
  requestUploadUrl: (
    conversationId: number,
    fileType: "image" | "video" | "voice" | "file",
    sizeBytes: number,
    meetingId?: number,
  ) => chatHttp.post<UploadUrlResponse>("/files/upload-url", { conversationId, fileType, sizeBytes, meetingId }),

  // --- Thao luan cua cuoc hop (KHONG ma hoa - xem MeetingDiscussionEndpoints.cs) ---
  listMeetingDiscussions: (conversationId: number) =>
    chatHttp.get<{ meetingId: number; messageCount: number; lastMessageAt: string }[]>(
      `/conversations/${conversationId}/meetings`,
    ),

  getMeetingMessages: (conversationId: number, meetingId: number, before?: string, limit = 50) =>
    chatHttp.get<Message[]>(`/conversations/${conversationId}/meetings/${meetingId}/messages`, {
      params: { before, limit },
    }),

  sendMeetingText: (conversationId: number, meetingId: number, content: string) =>
    chatHttp.post<Message>(`/conversations/${conversationId}/meetings/${meetingId}/messages`, {
      type: "text",
      content,
    }),

  sendMeetingFile: (
    conversationId: number,
    meetingId: number,
    type: Exclude<MessageType, "text" | "system">,
    fileId: number,
  ) => chatHttp.post<Message>(`/conversations/${conversationId}/meetings/${meetingId}/messages`, { type, fileId }),

  getDownloadUrl: (fileId: number) => chatHttp.get<UploadUrlResponse>(`/files/${fileId}/download-url`),

  completeUpload: (fileId: number, uploadId: string) =>
    chatHttp.post<void>(`/files/${fileId}/complete-upload`, { uploadId }),

  abortUpload: (fileId: number, uploadId: string) =>
    chatHttp.post<void>(`/files/${fileId}/abort-upload`, { uploadId }),

  // Tai file len thang MinIO bang URL da ky san.
  //
  // Dung XMLHttpRequest chu KHONG phai fetch: fetch() khong co cach nao bao
  // tien do tai LEN. Body cua no la mot khoi kin, trinh duyet khong phat su
  // kien nao trong luc gui. XHR thi co xhr.upload.onprogress - day la ly do
  // duy nhat con giu XHR trong ma nguon nay.
  //
  // Tien the sua mot lo hong that: ban fetch cu KHONG kiem tra ma tra ve.
  // fetch() chi reject khi loi mang, con MinIO tra 403/500 thi no van coi la
  // thanh cong, roi ma o tren goi tiep sendFileMessage - sinh ra mot tin
  // nhan tro toi file KHONG HE TON TAI tren kho. Ban nay kiem status.
  uploadToPresignedUrl: (
    uploadUrl: string,
    body: Blob,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);

      xhr.upload.onprogress = (e) => {
        // lengthComputable = false khi trinh duyet khong biet tong kich
        // thuoc; voi File thi hiem, nhung van lay file.size lam duong lui.
        onProgress?.(e.loaded, e.lengthComputable ? e.total : body.size);
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Kho lưu trữ từ chối tệp (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Mất kết nối khi đang tải tệp lên"));
      xhr.ontimeout = () => reject(new Error("Tải tệp lên quá lâu, đã dừng"));
      xhr.onabort = () => reject(new Error("Đã huỷ tải tệp lên"));

      xhr.send(body);
    }),

  // Tai mot tep len, tu chon di duong mot lan hay nhieu phan.
  //
  // VI SAO CAN NHIEU PHAN: he thong ra Internet qua Cloudflare Tunnel, va
  // Cloudflare bo cuoc voi nhung lan tai len lon (loi 524). Do that: mot lan
  // 10MB qua duoc (72,6 giay), mot lan 25MB chet 524; cat thanh nhieu phan
  // thi 25MB va 45MB deu qua, checksum khop.
  //
  // Cat nho thi moi phan la mot request rieng va du nho de di lot. Kem theo
  // mot loi lon nua: phan nao dut thi THU LAI MOT MINH phan do, khong phai
  // lam lai ca tep - dung cai canh "tai do bi dut la phai lam lai tu dau".
  uploadFile: async (
    slot: UploadUrlResponse,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> => {
    // Tep nho: mot lan PUT nhu cu.
    if (!slot.uploadId || !slot.partUrls || !slot.partSizeBytes) {
      await chatApi.uploadToPresignedUrl(slot.uploadUrl, file, onProgress);
      return;
    }

    const partSize = slot.partSizeBytes;
    let done = 0;

    for (let i = 0; i < slot.partUrls.length; i++) {
      const start = i * partSize;
      if (start >= file.size) break;
      const chunk = file.slice(start, Math.min(start + partSize, file.size));

      // Thu lai tung phan. Mang nha chap chon thi mot phan hong khong con la
      // tham hoa nua.
      // 5 lan chu khong phai 3: da quan sat that mot phan 5MB chay toi 148
      // giay moi xong, va 524 thi thinh thoang van roi vao. Thu them vai lan
      // re hon nhieu so voi bat nguoi dung lam lai ca tep.
      let lastErr: unknown = null;
      let ok = false;
      for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
        try {
          await chatApi.uploadToPresignedUrl(slot.partUrls[i], chunk, (loaded) =>
            onProgress?.(done + loaded, file.size),
          );
          ok = true;
        } catch (err) {
          lastErr = err;
          // Cho tang dan roi thu lai - dut mang thoang qua thi lan sau qua.
          if (attempt < 5) await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
      if (!ok) throw lastErr;

      done += chunk.size;
      onProgress?.(done, file.size);
    }
  },

  listMutedMembers: (conversationId: number) => chatHttp.get<number[]>(`/conversations/${conversationId}/mutes`),

  muteMember: (conversationId: number, userId: number) => chatHttp.post<void>(`/conversations/${conversationId}/mutes`, { userId }),

  unmuteMember: (conversationId: number, userId: number) => chatHttp.delete<void>(`/conversations/${conversationId}/mutes/${userId}`),

  getStorage: (conversationId: number) => chatHttp.get<StorageInfo>(`/conversations/${conversationId}/storage`),

  // Nap dung luong giờ phải qua duyệt Admin (khong tu cong truc tiep nua) -
  // Truong nhom chi gui YEU CAU, xem AdminService StorageAdminEndpoints.cs.
  requestStorageTopup: (conversationId: number, amount: number) =>
    chatHttp.post<TopupRequestInfo>(`/conversations/${conversationId}/storage/topup-requests`, { amount }),

  listStorageTopupRequests: (conversationId: number) =>
    chatHttp.get<TopupRequestInfo[]>(`/conversations/${conversationId}/storage/topup-requests`),

  unlockStorage: (conversationId: number, storageExpiresAt: string | null) =>
    chatHttp.post<StorageInfo>(`/conversations/${conversationId}/storage/unlock`, { storageExpiresAt }),
};

export interface StorageInfo {
  plan: string;
  quotaBytes: number;
  usedBytes: number;
  isLocked: boolean;
  expiresAt: string | null;
}

export interface TopupRequestInfo {
  id: number;
  conversationId: number;
  requestedBy: number;
  amount: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export const complaintsApi = {
  list: () => chatHttp.get<{ senderRole: string; message: string; createdAt: string; senderId: number | null }[]>("/complaints/messages"),
  send: (message: string) => chatHttp.post("/complaints/messages", { message }),
};
