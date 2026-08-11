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

// E2EE: khoa phien ma hoa RIENG cho 1 thanh vien Group (fan-out) - client tu
// tinh, server chi luu/relay nguyen van. P2P khong can truyen field nay (2
// ben tu tinh shared secret qua ECDH tu khoa cong khai cua nhau).
public record RecipientKeyInput(long UserId, string EncryptedKey);

// ContentNonce BAT BUOC khi Type == "text" (E2EE bat buoc cho tin nhan
// Text, tu de xuat - xem KeysEndpoints.cs). Voi Group + Text, RecipientKeys
// cung BAT BUOC (>= 1 phan tu, thuong la toan bo thanh vien tai thoi diem
// gui).
public record CreateMessageRequest(string Type, string? Content, long? FileId, string? ContentNonce, List<RecipientKeyInput>? RecipientKeys);

public record MessageResponse(
    long Id, long ConversationId, long? SenderId, string? SenderDisplayName, string Type, string? Content,
    long? FileId, bool IsDeleted, DateTimeOffset CreatedAt, bool IsEncrypted, string? ContentNonce, string? RecipientEncryptedKey)
{
    public static MessageResponse FromEntity(Message m, string? senderDisplayName = null, long? fileId = null, string? recipientEncryptedKey = null) => new(
        m.Id, m.ConversationId, m.SenderId, senderDisplayName, Message.TypeToString(m.Type), m.Content, fileId,
        m.IsDeleted, m.CreatedAt, m.IsEncrypted, m.ContentNonce, recipientEncryptedKey);
}

public record UploadUrlRequest(long ConversationId, string FileType, long SizeBytes);
public record UploadUrlResponse(long FileId, string UploadUrl, int ExpiresInSeconds);

public record FileMetaResponse(long Id, long ConversationId, long UploadedBy, string FileType, long SizeBytes, DateTimeOffset UploadedAt)
{
    public static FileMetaResponse FromEntity(FileAttachment f) => new(
        f.Id, f.ConversationId, f.UploadedBy, FileAttachment.TypeToString(f.FileType), f.SizeBytes, f.UploadedAt);
}

public record MuteRequest(long UserId);

public record StorageInfoResponse(string Plan, long QuotaBytes, long UsedBytes, bool IsLocked, DateTimeOffset? ExpiresAt)
{
    public static StorageInfoResponse FromEntity(GroupChatSettings s) => new(
        GroupChatSettings.PlanToString(s.Plan), s.StorageQuotaBytes, s.StorageUsedBytes, s.IsLocked, s.StorageExpiresAt);
}

public record TopupRequest(decimal Amount);
public record UnlockRequest(DateTimeOffset? StorageExpiresAt);

public record ComplaintMessageRequest(string Message);
public record ComplaintMessageResponse(string SenderRole, string Message, DateTimeOffset CreatedAt, long? SenderId = null);
public record ComplaintSummary(long UserId, DateTimeOffset LastMessageAt, DateTimeOffset ExpiresAt);
public record ComplaintReplyRequest(string Message);

public record ErrorResponse(string Error, string Message);
