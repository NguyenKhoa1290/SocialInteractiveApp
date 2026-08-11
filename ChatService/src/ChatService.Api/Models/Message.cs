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

    // E2EE (tu de xuat, tai lieu goc khong mo ta co che cu the) - chi ap
    // dung cho Type == Text. Khi IsEncrypted, Content la ciphertext base64
    // (AES-256-GCM), ContentNonce la nonce/IV base64 di kem BAT BUOC. Server
    // khong bao gio giai ma - chi luu/relay nguyen ciphertext.
    public bool IsEncrypted { get; set; }
    public string? ContentNonce { get; set; }

    public bool IsDeleted { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Conversation? Conversation { get; set; }
    public List<MessageRecipientKey> RecipientKeys { get; set; } = [];

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
