namespace ChatService.Api.Models;

// Blind-index searchable encryption (tu de xuat, giong co che that cua
// Facebook Messenger E2EE mac dinh) - token la HMAC(searchKey, tu-khoa) do
// CLIENT tu tinh truoc khi ma hoa noi dung goc, searchKey KHONG BAO GIO gui
// len server (chi client giu, tuong tu private key). Server chi so khop
// token == token, khong the suy nguoc ra tu goc la gi.
public class MessageSearchToken
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public string Token { get; set; } = string.Empty;
}
