using System.Security.Claims;
using IdentityService.Api.Data;
using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

// Tinh nang "ban be" - tu thiet ke hoan toan (khong co trong tai lieu goc,
// xem ghi chu o Friendship.cs va identity-db-init.sql). Co che gui loi
// moi + doi phuong dong y (giong Facebook/Zalo), KHONG them ngay lap tuc -
// tranh spam ket ban hang loat.
public static class FriendsEndpoints
{
    public static void MapFriendsEndpoints(this WebApplication app)
    {
        var friends = app.MapGroup("/friends").RequireAuthorization();

        // Gui loi moi ket ban. Neu doi phuong DA gui loi moi cho minh truoc
        // (Pending, chieu nguoc lai) thi tu dong chap nhan luon - giong 2
        // nguoi cung bam "Ket ban" cho nhau, khong bat ho phai vao Accept
        // rieng cho truong hop nay.
        friends.MapPost("/requests", async (SendFriendRequestRequest req, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            if (req.AddresseeId == userId)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Khong the tu ket ban voi chinh minh"));

            var addressee = await db.Users.FindAsync(req.AddresseeId);
            if (addressee is null || addressee.Status == UserStatus.Locked)
                return Results.NotFound(new ErrorResponse("user_not_found", "Nguoi dung khong ton tai"));

            var (a, b) = userId < req.AddresseeId ? (userId, req.AddresseeId) : (req.AddresseeId, userId);
            var existing = await db.Friendships.SingleOrDefaultAsync(f =>
                (f.RequesterId == a && f.AddresseeId == b) || (f.RequesterId == b && f.AddresseeId == a));

            if (existing is not null)
            {
                if (existing.Status == FriendshipStatus.Accepted)
                    return Results.Conflict(new ErrorResponse("already_friends", "Hai nguoi da la ban be"));

                if (existing.RequesterId == req.AddresseeId)
                {
                    // Doi phuong da gui loi moi cho minh truoc -> tu dong ghep doi
                    existing.Status = FriendshipStatus.Accepted;
                    existing.RespondedAt = DateTimeOffset.UtcNow;
                    await db.SaveChangesAsync();
                    return Results.Ok(new FriendResponse(addressee.Id, addressee.Nickname, existing.RespondedAt.Value));
                }

                return Results.Conflict(new ErrorResponse("request_already_sent", "Da gui loi moi ket ban truoc do, dang cho phan hoi"));
            }

            var friendship = new Friendship
            {
                RequesterId = userId,
                AddresseeId = req.AddresseeId,
                Status = FriendshipStatus.Pending,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Friendships.Add(friendship);
            await db.SaveChangesAsync();

            return Results.Created($"/friends/requests/{friendship.Id}",
                new FriendRequestResponse(friendship.Id, addressee.Id, addressee.Nickname, friendship.CreatedAt));
        });

        // Loi moi NGUOI KHAC gui cho minh, dang cho minh phan hoi.
        friends.MapGet("/requests/incoming", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var rows = await db.Friendships
                .Where(f => f.AddresseeId == userId && f.Status == FriendshipStatus.Pending)
                .ToListAsync();

            var requesterIds = rows.Select(r => r.RequesterId).ToList();
            var nicknames = await db.Users.Where(u => requesterIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Nickname);

            var result = rows.Select(r => new FriendRequestResponse(
                r.Id, r.RequesterId, nicknames.GetValueOrDefault(r.RequesterId, $"user_{r.RequesterId}"), r.CreatedAt));
            return Results.Ok(result);
        });

        // Loi moi CHINH MINH da gui, dang cho doi phuong phan hoi - de UI
        // "Tim ban" hien dung trang thai "Da gui loi moi" thay vi nut Ket ban.
        friends.MapGet("/requests/outgoing", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var rows = await db.Friendships
                .Where(f => f.RequesterId == userId && f.Status == FriendshipStatus.Pending)
                .ToListAsync();

            var addresseeIds = rows.Select(r => r.AddresseeId).ToList();
            var nicknames = await db.Users.Where(u => addresseeIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Nickname);

            var result = rows.Select(r => new FriendRequestResponse(
                r.Id, r.AddresseeId, nicknames.GetValueOrDefault(r.AddresseeId, $"user_{r.AddresseeId}"), r.CreatedAt));
            return Results.Ok(result);
        });

        friends.MapPost("/requests/{requestId:long}/accept", async (long requestId, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var request = await db.Friendships.SingleOrDefaultAsync(f => f.Id == requestId);
            if (request is null || request.Status != FriendshipStatus.Pending || request.AddresseeId != userId)
                return Results.NotFound(new ErrorResponse("request_not_found", "Loi moi khong ton tai hoac ban khong phai nguoi nhan"));

            request.Status = FriendshipStatus.Accepted;
            request.RespondedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            var requester = await db.Users.FindAsync(request.RequesterId);
            return Results.Ok(new FriendResponse(request.RequesterId, requester?.Nickname ?? $"user_{request.RequesterId}", request.RespondedAt.Value));
        });

        // Dung chung cho "tu choi loi moi den" (nguoi nhan) va "huy loi moi
        // da gui" (nguoi gui) - ca 2 truong hop deu la XOA dong Pending,
        // cho phep gui lai lan sau (khong luu trang thai "rejected" vinh vien).
        friends.MapDelete("/requests/{requestId:long}", async (long requestId, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var request = await db.Friendships.SingleOrDefaultAsync(f => f.Id == requestId);
            if (request is null || request.Status != FriendshipStatus.Pending)
                return Results.NotFound();

            if (request.RequesterId != userId && request.AddresseeId != userId)
                return Results.Json(new ErrorResponse("forbidden", "Ban khong lien quan toi loi moi nay"), statusCode: 403);

            db.Friendships.Remove(request);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        friends.MapGet("", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var rows = await db.Friendships
                .Where(f => (f.RequesterId == userId || f.AddresseeId == userId) && f.Status == FriendshipStatus.Accepted)
                .ToListAsync();

            var friendIds = rows.Select(r => r.RequesterId == userId ? r.AddresseeId : r.RequesterId).ToList();
            var users = await db.Users.Where(u => friendIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Nickname);

            var result = rows.Select(r =>
            {
                var friendId = r.RequesterId == userId ? r.AddresseeId : r.RequesterId;
                return new FriendResponse(friendId, users.GetValueOrDefault(friendId, $"user_{friendId}"), r.RespondedAt ?? r.CreatedAt);
            });
            return Results.Ok(result);
        });

        friends.MapDelete("/{friendUserId:long}", async (long friendUserId, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var friendship = await db.Friendships.SingleOrDefaultAsync(f =>
                f.Status == FriendshipStatus.Accepted &&
                ((f.RequesterId == userId && f.AddresseeId == friendUserId) || (f.RequesterId == friendUserId && f.AddresseeId == userId)));

            if (friendship is null)
                return Results.NotFound();

            db.Friendships.Remove(friendship);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
