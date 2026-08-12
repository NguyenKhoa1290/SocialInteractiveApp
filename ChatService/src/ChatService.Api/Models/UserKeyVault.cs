namespace ChatService.Api.Models;

// Khoi phuc private key tren thiet bi moi bang PIN 6 so - xem ghi chu day
// du o chat-db-init.sql. Server chi giu ho ciphertext, khong bao gio thay
// PIN hay private key goc.
public class UserKeyVault
{
    public long UserId { get; set; }
    public string Salt { get; set; } = string.Empty;
    public string Nonce { get; set; } = string.Empty;
    public string Ciphertext { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; }
}
