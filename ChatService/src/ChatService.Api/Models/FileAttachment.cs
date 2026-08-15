namespace ChatService.Api.Models;

public enum FileType
{
    Image,
    Video,
    Voice,
    File
}

// Ten class "FileAttachment" (khong dat "File" de tranh dung ten voi System.IO.File).
// Anh xa vao bang "files" trong DB.
public class FileAttachment
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public long? MessageId { get; set; }
    public long UploadedBy { get; set; }
    public string ObjectKey { get; set; } = string.Empty;
    public FileType FileType { get; set; }
    public long SizeBytes { get; set; }
    public DateTimeOffset UploadedAt { get; set; }

    // Kho luu tru chua file nay ("home" = MinIO may nha, "cloud" = R2/S3).
    // Quyet dinh mot lan luc upload theo dung luong roi giu nguyen mai mai -
    // file da nam o dau thi o do, khong tu di chuyen. Xem StorageService.
    public string StorageProvider { get; set; } = Services.StorageService.Home;

    public static string TypeToString(FileType t) => t switch
    {
        FileType.Image => "image",
        FileType.Video => "video",
        FileType.Voice => "voice",
        _ => "file",
    };

    public static FileType TypeFromString(string t) => t switch
    {
        "image" => FileType.Image,
        "video" => FileType.Video,
        "voice" => FileType.Voice,
        _ => FileType.File,
    };
}
