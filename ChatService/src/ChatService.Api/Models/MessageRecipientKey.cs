namespace ChatService.Api.Models;

// E2EE Group: khoa phien (ngau nhien, dung 1 lan cho 1 tin nhan) duoc ma
// hoa RIENG cho tung thanh vien bang khoa cong khai cua nguoi do (fan-out).
// P2P KHONG dung bang nay - 2 nguoi tu tinh duoc shared secret qua ECDH.
public class MessageRecipientKey
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public long RecipientUserId { get; set; }
    public string EncryptedKey { get; set; } = string.Empty;
}
