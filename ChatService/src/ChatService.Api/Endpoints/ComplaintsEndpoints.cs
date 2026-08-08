using System.Security.Claims;
using System.Text.Json;
using ChatService.Api.Services;

namespace ChatService.Api.Endpoints;

// UC-09/UC-30: kenh khieu nai tach biet hoan toan khoi chat thong thuong,
// PHAI truy cap duoc ke ca khi tai khoan dang bi khoa - JWT van hop le du
// status=locked (Identity Service chi kiem tra status luc /auth/login, khong
// blocklist JWT theo status), nen endpoint nay khong can xu ly gi dac biet,
// chi don gian KHONG kiem tra status o day.
public static class ComplaintsEndpoints
{
    public static void MapComplaintsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/complaints").RequireAuthorization();

        group.MapGet("/messages", async (ClaimsPrincipal principal, ComplaintStore store) =>
        {
            var userId = GetUserId(principal)!.Value;
            var messages = await store.GetMessagesAsync(userId);
            return Results.Ok(messages);
        });

        group.MapPost("/messages", async (ComplaintMessageRequest req, ClaimsPrincipal principal, ComplaintStore store) =>
        {
            if (string.IsNullOrWhiteSpace(req.Message))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Noi dung khieu nai khong duoc trong"));

            var userId = GetUserId(principal)!.Value;
            var message = new ComplaintMessageResponse("user", req.Message, DateTimeOffset.UtcNow, userId);
            await store.AppendMessageAsync(userId, message);

            return Results.Created($"/complaints/messages", message);
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
