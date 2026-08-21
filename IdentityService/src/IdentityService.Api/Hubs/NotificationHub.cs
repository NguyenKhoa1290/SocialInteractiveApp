using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;

namespace IdentityService.Api.Hubs;

// Kenh WebSocket day thong bao xuong dung mot nguoi.
//
// KHONG co method nao cho client goi len: day la kenh MOT CHIEU. Client chi
// can ket noi, moi viec danh dau da doc deu qua REST - de mot duong duy nhat
// ghi du lieu, khong phai dong bo hai co che.
//
// Moi nguoi dung nam trong mot group rieng dat ten theo userId. Dung group
// thay vi Clients.User(...) vi Clients.User dua vao IUserIdProvider mac dinh
// (doc ClaimTypes.NameIdentifier), ma service nay dat MapInboundClaims=false
// nen claim giu nguyen ten "sub" - se khong khop.
[Authorize]
public class NotificationHub : Hub
{
    public static string GroupName(long userId) => $"user-{userId}";

    public override async Task OnConnectedAsync()
    {
        var userId = GetUserId(Context.User);
        if (userId is not null)
            await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(userId.Value));
        await base.OnConnectedAsync();
    }

    // Khong can go khoi group luc ngat: SignalR tu don connection khoi moi
    // group khi no dong.

    private static long? GetUserId(ClaimsPrincipal? principal)
    {
        var raw = principal?.FindFirstValue("sub");
        return long.TryParse(raw, out var id) ? id : null;
    }
}
