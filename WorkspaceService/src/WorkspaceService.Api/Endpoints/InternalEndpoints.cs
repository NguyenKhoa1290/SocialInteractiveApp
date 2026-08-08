using Microsoft.EntityFrameworkCore;
using WorkspaceService.Api.Data;
using WorkspaceService.Api.Services;

namespace WorkspaceService.Api.Endpoints;

// KHONG di qua API Gateway public - dung boi Chat Service de kiem tra
// thanh vien/vai tro khi thao tac tren conversation type='group' (Phase 3).
public static class InternalEndpoints
{
    public static void MapInternalWorkspaceEndpoints(this WebApplication app)
    {
        app.MapGet("/internal/workspaces/{workspaceId:long}/members", async (long workspaceId, WorkspaceDbContext db, IdentityClient identity) =>
        {
            var members = await db.WorkspaceMembers.Where(m => m.WorkspaceId == workspaceId).ToListAsync();
            if (members.Count == 0)
                return Results.NotFound();

            var userInfos = await identity.ResolveUsersAsync(members.Select(m => m.UserId));
            var result = members.Select(m => new WorkspaceMemberResponse(
                m.UserId,
                userInfos.GetValueOrDefault(m.UserId)?.Nickname ?? $"user_{m.UserId}",
                WorkspaceService.Api.Models.WorkspaceMember.RoleToString(m.Role),
                m.JoinedAt));

            return Results.Ok(result);
        });
    }
}
