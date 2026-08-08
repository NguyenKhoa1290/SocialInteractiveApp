namespace ChatService.Api.Models;

public enum ConversationType
{
    P2P,
    Group
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

    public static string TypeToString(ConversationType t) => t == ConversationType.P2P ? "p2p" : "group";
    public static ConversationType TypeFromString(string t) => t == "p2p" ? ConversationType.P2P : ConversationType.Group;

    public bool HasParticipant(long userId) => ParticipantAId == userId || ParticipantBId == userId;
}
