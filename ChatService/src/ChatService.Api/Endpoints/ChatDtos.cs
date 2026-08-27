using ChatService.Api.Models;

namespace ChatService.Api.Endpoints;

public record CreateP2PRequest(long OtherUserId);
public record CreateGroupRequest(long WorkspaceId);

public record ConversationResponse(
    long Id, string Type, long? WorkspaceId, long? ParticipantAId, long? ParticipantBId,
    DateTimeOffset? LastMessageAt, DateTimeOffset CreatedAt)
{
    public static ConversationResponse FromEntity(Conversation c) => new(
        c.Id, Conversation.TypeToString(c.Type), c.WorkspaceId, c.ParticipantAId, c.ParticipantBId,
        c.LastMessageAt, c.CreatedAt);
}

// GET /conversations (list mine, tu de xuat - thieu sot phat hien khi build
// Frontend F2, xem ConversationEndpoints.cs). OtherUserId chi co gia tri voi
// P2P (nguoi con lai, KHONG phai chinh nguoi goi); WorkspaceId chi co gia
// tri voi Group - Frontend tu doi chieu voi danh sach ban be/workspace da co
// san (tu F1/F1.5) de lay nickname/ten hien thi, Chat Service khong resolve
// thay.
public record ConversationSummaryResponse(
    long Id, string Type, long? WorkspaceId, long? OtherUserId,
    DateTimeOffset? LastMessageAt, DateTimeOffset CreatedAt)
{
    public static ConversationSummaryResponse FromEntity(Conversation c, long callerId) => new(
        c.Id, Conversation.TypeToString(c.Type), c.WorkspaceId,
        c.Type == ConversationType.P2P ? (c.ParticipantAId == callerId ? c.ParticipantBId : c.ParticipantAId) : null,
        c.LastMessageAt, c.CreatedAt);
}

// E2EE: khoa phien ma hoa RIENG cho 1 thanh vien Group (fan-out) - client tu
// tinh, server chi luu/relay nguyen van. P2P khong can truyen field nay (2
// ben tu tinh shared secret qua ECDH tu khoa cong khai cua nhau).
public record RecipientKeyInput(long UserId, string EncryptedKey);

// ContentNonce BAT BUOC khi Type == "text" (E2EE bat buoc cho tin nhan
// Text, tu de xuat - xem KeysEndpoints.cs). Voi Group + Text, RecipientKeys
// cung BAT BUOC (>= 1 phan tu, thuong la toan bo thanh vien tai thoi diem
// gui). SearchTokens: danh sach token da bam (HMAC voi search-key rieng cua
// client, xem MessageSearchToken.cs) - tuy chon, chi co y nghia voi Text.
public record CreateMessageRequest(string Type, string? Content, long? FileId, string? ContentNonce, List<RecipientKeyInput>? RecipientKeys, List<string>? SearchTokens, long? ReplyToId = null);

// PATCH /messages/{id}: sua noi dung tin nhan Text da gui (client tu ma hoa
// lai, gui ciphertext + nonce moi; TAI SU DUNG cung session key da fan-out
// truoc do cho Group - KHONG can gui lai RecipientKeys). SearchTokens moi se
// THAY THE toan bo token cu cua tin nhan nay.
public record UpdateMessageRequest(string Content, string ContentNonce, List<string>? SearchTokens);

public record MessageResponse(
    long Id, long ConversationId, long? SenderId, string? SenderDisplayName, string Type, string? Content,
    long? FileId, bool IsDeleted, DateTimeOffset CreatedAt, bool IsEncrypted, string? ContentNonce, string? RecipientEncryptedKey,
    bool IsEdited, DateTimeOffset? EditedAt, long? ReplyToId = null)
{
    public static MessageResponse FromEntity(Message m, string? senderDisplayName = null, long? fileId = null, string? recipientEncryptedKey = null) => new(
        m.Id, m.ConversationId, m.SenderId, senderDisplayName, Message.TypeToString(m.Type), m.Content, fileId,
        m.IsDeleted, m.CreatedAt, m.IsEncrypted, m.ContentNonce, recipientEncryptedKey, m.IsEdited, m.EditedAt, m.ReplyToId);

    // MessageLite di qua cache Redis. ReplyToId PHAI di theo den day: day la
    // duong duy nhat de client biet mot tin la tra loi cho tin nao khi nap lai
    // lich su - thieu no thi khoi trich dan bien mat ngay sau khi tai lai trang.
    public static MessageResponse FromLite(MessageLite m, long conversationId, string? senderDisplayName = null, string? recipientEncryptedKey = null) => new(
        m.Id, conversationId, m.SenderId, senderDisplayName, Message.TypeToString(m.Type), m.Content, m.FileId,
        m.IsDeleted, m.CreatedAt, m.IsEncrypted, m.ContentNonce, recipientEncryptedKey, m.IsEdited, m.EditedAt, m.ReplyToId);
}

// Hinh dang trung gian dung chung cho ca 2 nguon du lieu (Redis cache hoac
// Postgres) khi doc lich su tin nhan - xem ConversationEndpoints.cs GET
// messages va ChatCacheService.cs.
// Tin nhan cuoi cua mot hoi thoai, cho doan xem truoc o danh sach.
// Chi mang du thu de CLIENT tu giai ma - server khong doc duoc noi dung.
public record LastMessageResponse(
    long ConversationId, long MessageId, long? SenderId, string Type, string? Content,
    string? ContentNonce, string? RecipientEncryptedKey, bool IsEncrypted, bool IsDeleted,
    DateTimeOffset CreatedAt);

public record MessageLite(
    long Id, long? SenderId, MessageType Type, string? Content, bool IsDeleted,
    DateTimeOffset CreatedAt, bool IsEncrypted, string? ContentNonce, long? FileId,
    bool IsEdited, DateTimeOffset? EditedAt, long? ReplyToId = null);

// MeetingId (tu chon): co gia tri = file gui trong luong THAO LUAN cua cuoc
// hop do. Dung de kiem tra quyen theo nhanh "dang o trong cuoc hop" cho
// khach vang lai. File van thuoc conversation nhu binh thuong nen VAN tinh
// vao han muc luu tru cua nhom.
public record UploadUrlRequest(
    long ConversationId, string FileType, long SizeBytes, long? MeetingId = null, string? FileName = null);
// UploadId != null nghia la file nay phai tai len theo NHIEU PHAN: client
// PUT tung phan vao PartUrls[i] (phan i lay tu byte i*PartSizeBytes), roi goi
// POST /files/{id}/complete-upload de ghep lai. Xem StorageService de biet vi
// sao phai lam vay (gioi han ~100 giay moi request cua Cloudflare).
//
// UploadId == null la file nho, tai mot lan bang UploadUrl nhu cu.
public record UploadUrlResponse(
    long FileId,
    string UploadUrl,
    int ExpiresInSeconds,
    string? UploadId = null,
    int PartSizeBytes = 0,
    string[]? PartUrls = null,
    // Chi co nghia o duong TAI VE (GET /files/{id}/download-url): ten goc va
    // kich thuoc de client hien duoi tin nhan. Dat o day thay vi nhet vao DTO
    // tin nhan de khoi phai doi ca hinh dang cache Redis - client da goi
    // endpoint nay moi lan hien file roi.
    string? FileName = null,
    long SizeBytes = 0);

public record CompleteUploadRequest(string UploadId);

// UploadId cho phep NULL: luc trang bi dong, client goi buoc huy nay bang
// mot request "keepalive" toi gian va server da tu luu upload_id trong bang
// files roi - khong bat client phai gui lai cho dung.
public record AbortUploadRequest(string? UploadId);

// FileName da co trong bang tu Phase 15 nhung chua duoc tra ra o day - luoi
// "file media da gui" o panel phai can no de dat title cho tung o.
public record FileMetaResponse(
    long Id, long ConversationId, long UploadedBy, string FileType, long SizeBytes,
    DateTimeOffset UploadedAt, string? FileName)
{
    public static FileMetaResponse FromEntity(FileAttachment f) => new(
        f.Id, f.ConversationId, f.UploadedBy, FileAttachment.TypeToString(f.FileType), f.SizeBytes,
        f.UploadedAt, f.FileName);
}

public record MuteRequest(long UserId);

public record MeetingDiscussionSummary(long MeetingId, int MessageCount, DateTimeOffset LastMessageAt);

public record StorageInfoResponse(string Plan, long QuotaBytes, long UsedBytes, bool IsLocked, DateTimeOffset? ExpiresAt)
{
    public static StorageInfoResponse FromEntity(GroupChatSettings s) => new(
        GroupChatSettings.PlanToString(s.Plan), s.StorageQuotaBytes, s.StorageUsedBytes, s.IsLocked, s.StorageExpiresAt);
}

public record TopupRequest(decimal Amount);
public record UnlockRequest(DateTimeOffset? StorageExpiresAt);

public record TopupRequestResponse(long Id, long ConversationId, long RequestedBy, decimal Amount, string Status, DateTimeOffset CreatedAt);

public record ComplaintMessageRequest(string Message);
public record ComplaintMessageResponse(string SenderRole, string Message, DateTimeOffset CreatedAt, long? SenderId = null);
public record ComplaintSummary(long UserId, DateTimeOffset LastMessageAt, DateTimeOffset ExpiresAt);
public record ComplaintReplyRequest(string Message);

public record ErrorResponse(string Error, string Message);
