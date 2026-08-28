namespace ChatService.Api.Models;

public enum ConversationType
{
    P2P,
    Group,
    // Hoi thoai TAM cua mot phong hop tuy chinh - bi xoa han khi hop xong.
    // Xem ghi chu o chat-db-init.sql.
    Meeting
}

public class Conversation
{
    public long Id { get; set; }
    public ConversationType Type { get; set; }
    public long? WorkspaceId { get; set; }
    public long? ParticipantAId { get; set; }
    public long? ParticipantBId { get; set; }
    public DateTimeOffset? LastMessageAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<Message> Messages { get; set; } = [];

    public static string TypeToString(ConversationType t) => t switch
    {
        ConversationType.P2P => "p2p",
        ConversationType.Meeting => "meeting",
        _ => "group",
    };

    public static ConversationType TypeFromString(string t) => t switch
    {
        "p2p" => ConversationType.P2P,
        "meeting" => ConversationType.Meeting,
        _ => ConversationType.Group,
    };

    public bool HasParticipant(long userId) => ParticipantAId == userId || ParticipantBId == userId;
}
