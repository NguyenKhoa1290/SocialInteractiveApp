using Microsoft.EntityFrameworkCore;
using SpamTrackingService.Api.Data;
using SpamTrackingService.Api.Models;
using SpamTrackingService.Api.Services;

namespace SpamTrackingService.Api.Endpoints;

public record ViolationResponse(long UserId, string Nickname, DateTimeOffset DetectedAt, string Reason, string AccountStatus);
public record PaginatedViolations(List<ViolationResponse> Items, int Total);

// KHONG di qua API Gateway public - dung boi Admin Service (UC-11, UC-12).
// Admin Service CHUA duoc xay dung (Phase 4) - endpoint nay san sang truoc.
public static class ViolationEndpoints
{
    public static void MapViolationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/internal/violations");

        group.MapGet("", async (SpamTrackingDbContext db, IdentityClient identity, int? page, int? pageSize, string? status) =>
        {
            var p = Math.Max(page ?? 1, 1);
            var size = Math.Clamp(pageSize ?? 20, 1, 100);

            var query = db.Violations.AsQueryable();
            if (status is not null)
            {
                var statusEnum = Violation.StatusFromString(status);
                query = query.Where(v => v.AccountStatus == statusEnum);
            }

            var total = await query.CountAsync();
            var items = await query.OrderByDescending(v => v.DetectedAt)
                .Skip((p - 1) * size).Take(size).ToListAsync();

            var userInfos = await identity.ResolveUsersAsync(items.Select(v => v.UserId));
            var result = items.Select(v => new ViolationResponse(
                v.UserId,
                userInfos.GetValueOrDefault(v.UserId)?.Nickname ?? $"user_{v.UserId}",
                v.DetectedAt,
                v.Reason,
                Violation.StatusToString(v.AccountStatus)));

            return Results.Ok(new PaginatedViolations(result.ToList(), total));
        });

        group.MapGet("/{userId:long}", async (long userId, SpamTrackingDbContext db, IdentityClient identity) =>
        {
            var items = await db.Violations.Where(v => v.UserId == userId).OrderByDescending(v => v.DetectedAt).ToListAsync();
            if (items.Count == 0)
                return Results.NotFound();

            var userInfos = await identity.ResolveUsersAsync([userId]);
            var nickname = userInfos.GetValueOrDefault(userId)?.Nickname ?? $"user_{userId}";
            var result = items.Select(v => new ViolationResponse(v.UserId, nickname, v.DetectedAt, v.Reason, Violation.StatusToString(v.AccountStatus)));

            return Results.Ok(result);
        });
    }
}
