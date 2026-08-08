namespace ChatService.Api.Models;

public enum MessageType
{
    Text,
    Image,
    Video,
    File,
    Voice,
    Vote,
    System
}

public class Message
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public long? SenderId { get; set; }
    public MessageType Type { get; set; }
    public string? Content { get; set; }
    public bool IsDeleted { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Conversation? Conversation { get; set; }

    public static string TypeToString(MessageType t) => t switch
    {
        MessageType.Text => "text",
        MessageType.Image => "image",
        MessageType.Video => "video",
        MessageType.File => "file",
        MessageType.Voice => "voice",
        MessageType.Vote => "vote",
        _ => "system",
    };

    public static MessageType TypeFromString(string t) => t switch
    {
        "text" => MessageType.Text,
        "image" => MessageType.Image,
        "video" => MessageType.Video,
        "file" => MessageType.File,
        "voice" => MessageType.Voice,
        "vote" => MessageType.Vote,
        _ => MessageType.System,
    };
}
