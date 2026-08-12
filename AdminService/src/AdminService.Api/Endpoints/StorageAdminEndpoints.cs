using System.Security.Claims;
using AdminService.Api.Services;

namespace AdminService.Api.Endpoints;

// Duyet yeu cau nap dung luong nhom - tu thiet ke theo yeu cau nguoi dung
// du an: Truong nhom KHONG con tu cong dung luong duoc nua, phai gui yeu
// cau qua Chat Service roi Admin duyet o day (giong nap tien that can nguoi
// xac nhan da nhan tien). Toan bo endpoint yeu cau JWT role=admin.
public static class StorageAdminEndpoints
{
    public static void MapStorageAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/storage-requests").RequireAuthorization("AdminOnly");

        group.MapGet("", async (ChatServiceClient chat) =>
            Results.Ok(await chat.ListPendingTopupRequestsAsync()));

        group.MapPost("/{requestId:long}/approve", async (long requestId, ClaimsPrincipal principal, ChatServiceClient chat) =>
        {
            var adminUserId = GetUserId(principal)!.Value;
            var ok = await chat.ApproveTopupRequestAsync(requestId, adminUserId);
            return ok ? Results.NoContent() : Results.NotFound(new ErrorResponse("not_found", "Yeu cau khong ton tai hoac da duoc xu ly"));
        });

        group.MapPost("/{requestId:long}/reject", async (long requestId, ClaimsPrincipal principal, ChatServiceClient chat) =>
        {
            var adminUserId = GetUserId(principal)!.Value;
            var ok = await chat.RejectTopupRequestAsync(requestId, adminUserId);
            return ok ? Results.NoContent() : Results.NotFound(new ErrorResponse("not_found", "Yeu cau khong ton tai hoac da duoc xu ly"));
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
