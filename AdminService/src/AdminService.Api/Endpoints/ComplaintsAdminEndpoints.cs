using AdminService.Api.Services;

namespace AdminService.Api.Endpoints;

// UC-13: xu ly khieu nai tu tai khoan bi khoa, qua kenh Redis (TTL 10 tieng)
// cua Chat Service. Toan bo endpoint yeu cau JWT role=admin.
public static class ComplaintsAdminEndpoints
{
    public static void MapComplaintsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/complaints").RequireAuthorization("AdminOnly");

        group.MapGet("", async (ChatServiceClient chat) =>
            Results.Ok(await chat.ListComplaintsAsync()));

        group.MapGet("/{userId:long}", async (long userId, ChatServiceClient chat) =>
        {
            var messages = await chat.GetComplaintMessagesAsync(userId);
            return messages is null
                ? Results.NotFound(new ErrorResponse("not_found", "Khieu nai da qua 10 tieng hoac khong ton tai"))
                : Results.Ok(messages);
        });

        group.MapPost("/{userId:long}/reply", async (long userId, ComplaintReplyRequest req, ChatServiceClient chat) =>
        {
            if (string.IsNullOrWhiteSpace(req.Message))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Noi dung phan hoi khong duoc trong"));

            var reply = await chat.ReplyComplaintAsync(userId, req.Message);
            return reply is null
                ? Results.NotFound(new ErrorResponse("not_found", "Khieu nai da qua 10 tieng hoac khong ton tai"))
                : Results.Created($"/admin/complaints/{userId}", reply);
        });
    }
}
