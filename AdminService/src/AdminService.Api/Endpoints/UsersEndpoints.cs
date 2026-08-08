using AdminService.Api.Services;

namespace AdminService.Api.Endpoints;

// UC-10, UC-11, UC-12. Toan bo endpoint yeu cau JWT role=admin (policy
// "AdminOnly" khai bao trong Program.cs).
public static class UsersEndpoints
{
    public static void MapUsersEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/users").RequireAuthorization("AdminOnly");

        group.MapGet("", async (int? page, int? pageSize, string? search, IdentityClient identity) =>
        {
            var result = await identity.ListUsersAsync(page.GetValueOrDefault(1), pageSize.GetValueOrDefault(20), search);
            if (result is null)
                return Results.Json(new ErrorResponse("identity_unavailable", "Identity Service khong phan hoi"), statusCode: 502);

            return Results.Ok(new PaginatedUsers(result.Items, result.Total, result.Page, result.PageSize));
        });

        group.MapGet("/{userId:long}", async (long userId, IdentityClient identity, SpamTrackingClient spam) =>
        {
            var user = await identity.GetUserAsync(userId);
            if (user is null)
                return Results.NotFound();

            var violations = await spam.GetViolationsForUserAsync(userId);
            return Results.Ok(AdminUserDetail.FromInfo(user, violations));
        });

        // Xoa vinh vien vi spam (UC-12, nhanh 3b) - publish bat dong bo qua
        // RabbitMQ, Identity Service consume va xoa that (AccountLockedConsumerService).
        group.MapDelete("/{userId:long}", async (long userId, IdentityClient identity, ChatServiceClient chat, RabbitMqPublisher publisher) =>
        {
            var user = await identity.GetUserAsync(userId);
            if (user is null)
                return Results.NotFound();

            // Rang buoc DE XUAT them (khong bat buoc trong use case goc):
            // chan xoa neu con khieu nai dang cho xu ly, doi Admin xu ly UC-13
            // truoc (goi POST /admin/complaints/{userId}/reply de dong lai).
            var complaints = await chat.ListComplaintsAsync();
            if (complaints.Any(c => c.UserId == userId))
                return Results.Json(
                    new ErrorResponse("complaint_pending", "Tai khoan dang co khieu nai chua xu ly xong"),
                    statusCode: 409);

            try
            {
                await publisher.PublishDeleteAccountSpamAsync(userId, "Admin xoa thu cong qua Admin Service");
            }
            catch (Exception)
            {
                return Results.Json(new ErrorResponse("queue_unavailable", "Khong the gui yeu cau xoa (RabbitMQ)"), statusCode: 502);
            }

            return Results.Accepted();
        });

        group.MapPost("/{userId:long}/unlock", async (long userId, IdentityClient identity) =>
        {
            var ok = await identity.UnlockUserAsync(userId);
            return ok ? Results.Ok() : Results.NotFound();
        });

        app.MapGet("/admin/spam-violations", async (int? page, int? pageSize, SpamTrackingClient spam) =>
        {
            var result = await spam.ListViolationsAsync(page.GetValueOrDefault(1), pageSize.GetValueOrDefault(20));
            return Results.Ok(result);
        }).RequireAuthorization("AdminOnly");
    }
}
