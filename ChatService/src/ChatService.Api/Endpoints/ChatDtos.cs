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

public record CreateMessageRequest(string Type, string? Content, long? FileId);

public record MessageResponse(long Id, long ConversationId, long? SenderId, string? SenderDisplayName, string Type, string? Content, long? FileId, bool IsDeleted, DateTimeOffset CreatedAt)
{
    public static MessageResponse FromEntity(Message m, string? senderDisplayName = null, long? fileId = null) => new(
        m.Id, m.ConversationId, m.SenderId, senderDisplayName, Message.TypeToString(m.Type), m.Content, fileId, m.IsDeleted, m.CreatedAt);
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
