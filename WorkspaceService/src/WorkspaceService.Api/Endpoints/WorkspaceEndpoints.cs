using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using WorkspaceService.Api.Data;
using WorkspaceService.Api.Models;
using WorkspaceService.Api.Services;

namespace WorkspaceService.Api.Endpoints;

public static class WorkspaceEndpoints
{
    public static void MapWorkspaceEndpoints(this WebApplication app)
    {
        var ws = app.MapGroup("/workspaces").RequireAuthorization();

        // Danh sach nhom cua chinh nguoi goi - tu de xuat, thieu sot phat hien
        // khi build man hinh Frontend F1 "Danh sach nhom cua toi" (tai lieu
        // dac ta frontend muc 4): trong OpenAPI spec goc chi co
        // POST/GET(theo id)/PATCH/DELETE /workspaces, khong co endpoint nao
        // liet ke theo user dang dang nhap.
        ws.MapGet("", async (ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var rows = await db.WorkspaceMembers
                .Where(m => m.UserId == userId)
                .Include(m => m.Workspace)
                .ToListAsync();

            var result = rows
                .OrderByDescending(m => m.Workspace!.UpdatedAt)
                .Select(m => new WorkspaceSummaryResponse(
                    m.Workspace!.Id, m.Workspace.Name, m.Workspace.AvatarUrl,
                    WorkspaceMember.RoleToString(m.Role), m.Workspace.UpdatedAt));

            return Results.Ok(result);
        });

        // UC-17: Tao nhom moi - nguoi goi tu dong thanh Truong nhom
        ws.MapPost("", async (CreateWorkspaceRequest req, ClaimsPrincipal principal, WorkspaceDbContext db, ChatServiceClient chatClient) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 100)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Ten nhom bat buoc, toi da 100 ky tu"));

            var userId = GetUserId(principal)!.Value;
            var workspace = new Workspace
            {
                Name = req.Name,
                AvatarUrl = req.AvatarUrl,
                CreatedBy = userId,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            workspace.Members.Add(new WorkspaceMember
            {
                UserId = userId,
                Role = MemberRole.Leader,
                JoinedAt = DateTimeOffset.UtcNow,
            });
            db.Workspaces.Add(workspace);
            await db.SaveChangesAsync();

            await chatClient.NotifyWorkspaceCreatedAsync(workspace.Id);

            return Results.Created($"/workspaces/{workspace.Id}", WorkspaceResponse.FromEntity(workspace));
        });

        // UC-24: Xem thong tin nhom - phai la thanh vien
        ws.MapGet("/{workspaceId:long}", async (long workspaceId, ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var workspace = await db.Workspaces.Include(w => w.Members).SingleOrDefaultAsync(w => w.Id == workspaceId);
            if (workspace is null)
                return Results.NotFound();

            if (!workspace.Members.Any(m => m.UserId == userId))
                return Results.Json(new ErrorResponse("not_a_member", "Ban khong phai thanh vien nhom nay"), statusCode: 403);

            return Results.Ok(WorkspaceResponse.FromEntity(workspace));
        });

        // UC-18: Sua avatar/ten - Truong nhom hoac Pho nhom
        ws.MapPatch("/{workspaceId:long}", async (long workspaceId, UpdateWorkspaceRequest req, ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var workspace = await db.Workspaces.Include(w => w.Members).SingleOrDefaultAsync(w => w.Id == workspaceId);
            if (workspace is null)
                return Results.NotFound();

            var caller = workspace.Members.SingleOrDefault(m => m.UserId == userId);
            if (caller is null || caller.Role == MemberRole.Member)
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom hoac Pho nhom duoc sua"), statusCode: 403);

            if (req.Name is not null)
            {
                if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 100)
                    return Results.BadRequest(new ErrorResponse("invalid_request", "Ten nhom khong hop le"));
                workspace.Name = req.Name;
            }
            if (req.AvatarUrl is not null)
                workspace.AvatarUrl = req.AvatarUrl;
            workspace.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(WorkspaceResponse.FromEntity(workspace));
        });

        // UC-19: Xoa nhom (vinh vien) - chi Truong nhom
        ws.MapDelete("/{workspaceId:long}", async (long workspaceId, ClaimsPrincipal principal, WorkspaceDbContext db, MemberNotificationPublisher notifier, ChatServiceClient chatClient) =>
        {
            var userId = GetUserId(principal)!.Value;
            var leaderRow = await db.WorkspaceMembers
                .SingleOrDefaultAsync(m => m.WorkspaceId == workspaceId && m.UserId == userId && m.Role == MemberRole.Leader);
            if (leaderRow is null)
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc xoa nhom"), statusCode: 403);

            // Xoa dong membership cua Truong nhom - trigger DB
            // (trg_cascade_delete_workspace_on_leader_leave) se tu dong cascade
            // xoa ca bang workspaces + toan bo thanh vien khac. KHONG duoc xoa
            // truc tiep workspace o day (se lam trigger chay sai thu tu).
            db.WorkspaceMembers.Remove(leaderRow);
            await db.SaveChangesAsync();

            await notifier.PublishAsync("workspace_dissolved", workspaceId, userId);
            await chatClient.NotifyWorkspaceDeletedAsync(workspaceId);

            return Results.NoContent();
        });

        // Danh sach thanh vien kem vai tro + nickname (resolve qua Identity Service)
        ws.MapGet("/{workspaceId:long}/members", async (long workspaceId, ClaimsPrincipal principal, WorkspaceDbContext db, IdentityClient identity) =>
        {
            var userId = GetUserId(principal)!.Value;
            var members = await db.WorkspaceMembers.Where(m => m.WorkspaceId == workspaceId).ToListAsync();
            if (members.Count == 0)
                return Results.NotFound();

            if (!members.Any(m => m.UserId == userId))
                return Results.Json(new ErrorResponse("not_a_member", "Ban khong phai thanh vien nhom nay"), statusCode: 403);

            var userInfos = await identity.ResolveUsersAsync(members.Select(m => m.UserId));
            var result = members.Select(m => new WorkspaceMemberResponse(
                m.UserId,
                userInfos.GetValueOrDefault(m.UserId)?.Nickname ?? $"user_{m.UserId}",
                WorkspaceMember.RoleToString(m.Role),
                m.JoinedAt));

            return Results.Ok(result);
        });

        // UC-20: Them thanh vien - Truong nhom hoac Pho nhom
        ws.MapPost("/{workspaceId:long}/members", async (long workspaceId, AddMemberRequest req, ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            var members = await db.WorkspaceMembers.Where(m => m.WorkspaceId == workspaceId).ToListAsync();
            if (members.Count == 0)
                return Results.NotFound();

            var caller = members.SingleOrDefault(m => m.UserId == userId);
            if (caller is null || caller.Role == MemberRole.Member)
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom hoac Pho nhom duoc them thanh vien"), statusCode: 403);

            if (members.Any(m => m.UserId == req.UserId))
                return Results.Conflict(new ErrorResponse("already_member", "Nguoi dung da la thanh vien nhom nay"));

            var newMember = new WorkspaceMember
            {
                WorkspaceId = workspaceId,
                UserId = req.UserId,
                Role = MemberRole.Member,
                InvitedBy = userId,
                JoinedAt = DateTimeOffset.UtcNow,
            };
            db.WorkspaceMembers.Add(newMember);
            await db.SaveChangesAsync();

            return Results.Created($"/workspaces/{workspaceId}/members/{req.UserId}",
                new WorkspaceMemberResponse(newMember.UserId, $"user_{newMember.UserId}", "member", newMember.JoinedAt));
        });

        // UC-22 (kick) + UC-23 (tu roi) - dung chung endpoint, phan biet theo userId vs nguoi goi
        ws.MapDelete("/{workspaceId:long}/members/{userId:long}", async (long workspaceId, long userId, ClaimsPrincipal principal, WorkspaceDbContext db, MemberNotificationPublisher notifier, ChatServiceClient chatClient) =>
        {
            var callerId = GetUserId(principal)!.Value;
            var members = await db.WorkspaceMembers.Where(m => m.WorkspaceId == workspaceId).ToListAsync();
            if (members.Count == 0)
                return Results.NotFound();

            var caller = members.SingleOrDefault(m => m.UserId == callerId);
            if (caller is null)
                return Results.Json(new ErrorResponse("not_a_member", "Ban khong phai thanh vien nhom nay"), statusCode: 403);

            var target = members.SingleOrDefault(m => m.UserId == userId);
            if (target is null)
                return Results.NotFound();

            if (userId != callerId)
            {
                // Kick - chi Truong nhom duoc phep
                if (caller.Role != MemberRole.Leader)
                    return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc xoa thanh vien khac"), statusCode: 403);

                db.WorkspaceMembers.Remove(target);
                await db.SaveChangesAsync();
                await notifier.PublishAsync("member_kicked", workspaceId, userId);
                await chatClient.NotifyMemberRemovedAsync(workspaceId, userId);
                return Results.NoContent();
            }

            if (target.Role == MemberRole.Leader)
            {
                // Truong nhom tu roi = giai tan nhom (trigger DB cascade xoa het)
                db.WorkspaceMembers.Remove(target);
                await db.SaveChangesAsync();
                await notifier.PublishAsync("workspace_dissolved", workspaceId, userId);
                await chatClient.NotifyWorkspaceDeletedAsync(workspaceId);
                return Results.NoContent();
            }

            // Tu roi binh thuong (Pho nhom / Nhom vien)
            db.WorkspaceMembers.Remove(target);
            await db.SaveChangesAsync();
            await notifier.PublishAsync("member_left", workspaceId, userId);
            await chatClient.NotifyMemberRemovedAsync(workspaceId, userId);
            return Results.NoContent();
        });

        // UC-21: Phong ham / xoa phong ham - chi Truong nhom, chi doi giua deputy/member
        ws.MapPatch("/{workspaceId:long}/members/{userId:long}/role", async (long workspaceId, long userId, UpdateRoleRequest req, ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            if (req.Role is not ("deputy" or "member"))
                return Results.BadRequest(new ErrorResponse("invalid_role", "role phai la 'deputy' hoac 'member'"));

            var callerId = GetUserId(principal)!.Value;
            var members = await db.WorkspaceMembers.Where(m => m.WorkspaceId == workspaceId).ToListAsync();
            if (members.Count == 0)
                return Results.NotFound();

            var caller = members.SingleOrDefault(m => m.UserId == callerId);
            if (caller is null || caller.Role != MemberRole.Leader)
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom duoc phong/xoa ham"), statusCode: 403);

            var target = members.SingleOrDefault(m => m.UserId == userId);
            if (target is null || target.Role == MemberRole.Leader)
                return Results.NotFound(new ErrorResponse("not_found", "userId khong phai thanh vien hop le cua nhom"));

            target.Role = WorkspaceMember.RoleFromString(req.Role);
            await db.SaveChangesAsync();

            return Results.Ok(new WorkspaceMemberResponse(target.UserId, $"user_{target.UserId}", req.Role, target.JoinedAt));
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
