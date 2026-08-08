namespace ChatService.Api.Models;

public class MutedMember
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public long UserId { get; set; }
    public long MutedBy { get; set; }
    public DateTimeOffset MutedAt { get; set; }
}
