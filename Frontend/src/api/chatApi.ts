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
  // Chi co o duong TAI VE: ten goc va kich thuoc de hien duoi tin nhan.
  fileName?: string | null;
  sizeBytes?: number;
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
    fileName?: string,
  ) =>
    chatHttp.post<UploadUrlResponse>("/files/upload-url", {
      conversationId,
      fileType,
      sizeBytes,
      meetingId,
      fileName: fileName ?? null,
    }),

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

    const chunks: Blob[] = [];
    for (let i = 0; i < slot.partUrls.length; i++) {
      const start = i * partSize;
      if (start >= file.size) break;
      chunks.push(file.slice(start, Math.min(start + partSize, file.size)));
    }

    // Tien do phai cong don theo TUNG PHAN chu khong dung mot bien chay:
    // nhieu phan bay cung luc nen "da xong bao nhieu + phan nay duoc bao
    // nhieu" khong con dung nua.
    const loadedPerPart = new Array<number>(chunks.length).fill(0);
    const report = () => onProgress?.(loadedPerPart.reduce((a, b) => a + b, 0), file.size);

    const sendPart = async (index: number) => {
      // 5 lan chu khong phai 3: da quan sat that mot phan 5MB chay toi 148
      // giay moi xong, va 524 thi thinh thoang van roi vao. Thu them vai lan
      // re hon nhieu so voi bat nguoi dung lam lai ca tep.
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await chatApi.uploadToPresignedUrl(slot.partUrls![index], chunks[index], (loaded) => {
            loadedPerPart[index] = loaded;
            report();
          });
          // Chot bang dung kich thuoc phan: su kien progress cuoi cung khong
          // phai luc nao cung bao du, de thanh tien do ket lai o 99%.
          loadedPerPart[index] = chunks[index].size;
          report();
          return;
        } catch (err) {
          lastErr = err;
          loadedPerPart[index] = 0; // thu lai la gui lai tu dau phan do
          report();
          if (attempt < 5) await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
      throw lastErr;
    };

    // --- Gui SONG SONG ---------------------------------------------------
    //
    // Do that tren he thong (4 cap xen ke tuan tu/song song, moi vong 15MB):
    //   tuan tu    : 0,186  0,083  0,173  0,145  MB/s
    //   song song 3: 0,113  0,396  0,465  0,477  MB/s
    //
    // Ba trong bon lan song song dat 0,40-0,48 MB/s, muc ma tuan tu chua lan
    // nao cham toi (cao nhat 0,186). Nghia la nut that KHONG phai bang thong
    // duong truyen - neu la bang thong thi chia luong chi lam moi luong cham
    // di, tong van the. Nut that la DO TRE: duong di may nguoi dung -> bien
    // Cloudflare -> tunnel -> may chu nha co RTT rat cao, mot ket noi TCP don
    // le gui het mot cua so roi phai ngoi cho xac nhan quay ve.
    //
    // Vi sao dung 3 chu khong nhieu hon: nginx truoc kho luu tru dat
    // limit_conn perip 4. Lay 3 la con chua mot suat cho viec tai VE cua chinh
    // nguoi do; cham tran se bi tra 503. Trong lan do, 24/24 request deu 200 -
    // muc 3 khong cham tran.
    //
    // LUU Y TRUNG THUC: mot trong bon cap do ra song song CHAM hon (0,61x).
    // Mang nha dao dong rat manh nen day la xu huong, khong phai hang so.
    const CONCURRENCY = 3;
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length) await sendPart(next++);
    });
    // Phai la allSettled roi tu nem: voi Promise.all, mot phan hong se tra ve
    // NGAY trong khi cac phan khac VAN DANG BAY - vua ro ri ket noi vua co the
    // goi complete-upload luc chua du phan.
    const settled = await Promise.allSettled(workers);
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
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
