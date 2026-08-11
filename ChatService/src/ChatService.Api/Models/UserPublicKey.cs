namespace ChatService.Api.Models;

// Danh ba khoa cong khai cho E2EE - moi user 1 khoa X25519. Khoa RIENG TU
// khong bao gio xuat hien o day/o server - client tu sinh, tu luu, tu bao
// ve bang PIN cuc bo tren thiet bi.
public class UserPublicKey
{
    public long UserId { get; set; }
    public string PublicKey { get; set; } = string.Empty;
    public string Algorithm { get; set; } = "x25519";
    public DateTimeOffset UpdatedAt { get; set; }
}
