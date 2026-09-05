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
        MapAvatarEndpoints(app);

        var ws = app.MapGroup("/workspaces").RequireAuthorization();

        // Danh sach nhom cua chinh nguoi goi - tu de xuat, thieu sot phat hien
        // khi build man hinh Frontend F1 "Danh sach nhom cua toi" (tai lieu
        // dac ta frontend muc 4): trong OpenAPI spec goc chi co
        // POST/GET(theo id)/PATCH/DELETE /workspaces, khong co endpoint nao
        // liet ke theo user dang dang nhap.
        ws.MapGet("", async (ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;

            // Chieu rieng tung cot thay vi Include ca dong workspaces: dong do
            // co cot avatar_bytes nang toi 256KB, keo ve het chi de hien mot
            // danh sach ten nhom la vo nghia. Anh di duong rieng qua
            // GET /workspaces/{id}/avatar, trinh duyet tu cache theo ?v=.
            var rows = await db.WorkspaceMembers
                .Where(m => m.UserId == userId)
                .OrderByDescending(m => m.Workspace!.UpdatedAt)
                .Select(m => new
                {
                    m.Workspace!.Id,
                    m.Workspace.Name,
                    m.Workspace.AvatarUrl,
                    m.Workspace.AvatarUpdatedAt,
                    m.Role,
                    m.Workspace.UpdatedAt,
                })
                .ToListAsync();

            var result = rows.Select(r => new WorkspaceSummaryResponse(
                r.Id, r.Name, r.AvatarUrl, r.AvatarUpdatedAt,
                WorkspaceMember.RoleToString(r.Role), r.UpdatedAt));

            return Results.Ok(result);
        });

        // UC-17: Tao nhom moi - nguoi goi tu dong thanh Truong nhom
        ws.MapPost("", async (CreateWorkspaceRequest req, ClaimsPrincipal principal, WorkspaceDbContext db, ChatServiceClient chatClient) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Length > 100)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Ten nhom bat buoc, toi da 100 ky tu"));

            // Khach KHONG duoc tao nhom - diem mo cua UC-17 gio da chot.
            //
            // Ly do: tai khoan Guest bi xoa tu dong sau 6 thang khong hoat dong.
            // Ma Truong nhom roi nhom = GIAI TAN ca nhom (trigger
            // cascade_delete_workspace_on_leader_leave), nen mot cai xoa dinh ky
            // se keo theo ca nhom va toan bo lich su chat cua nhung nguoi khac -
            // ho khong lam gi sai va cung khong duoc bao truoc.
            //
            // Doc THANG claim user_type trong JWT (IdentityService JwtTokenService
            // gan san) chu khong goi sang Identity: mot cau hoi mang o duong tao
            // nhom chi de biet mot thu da nam san trong token.
            if (principal.FindFirstValue("user_type") == "guest")
                return Results.Json(
                    new ErrorResponse("guest_not_allowed", "Tai khoan khach khong tao duoc nhom - hay dang ky tai khoan"),
                    statusCode: 403);

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

            // Chieu cot, khong nap ca thuc the: man chat goi endpoint nay moi
            // lan mo mot nhom, ma dong workspaces co cot anh nang toi 256KB.
            var row = await db.Workspaces
                .Where(w => w.Id == workspaceId)
                .Select(w => new
                {
                    w.Id, w.Name, w.AvatarUrl, w.AvatarUpdatedAt, w.CreatedBy, w.CreatedAt, w.UpdatedAt,
                    MemberIds = w.Members.Select(m => m.UserId).ToList(),
                })
                .SingleOrDefaultAsync();
            if (row is null)
                return Results.NotFound();

            if (!row.MemberIds.Contains(userId))
                return Results.Json(new ErrorResponse("not_a_member", "Ban khong phai thanh vien nhom nay"), statusCode: 403);

            return Results.Ok(new WorkspaceResponse(
                row.Id, row.Name, row.AvatarUrl, row.AvatarUpdatedAt,
                row.CreatedBy, row.CreatedAt, row.UpdatedAt, row.MemberIds));
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

    // ---- Anh nhom ---------------------------------------------------------
    //
    // Cung khuon voi anh dai dien nguoi dung ben Identity Service
    // (UsersEndpoints.cs): byte nam trong DB, client cat/nen truoc khi gui,
    // server van tu kiem lai kich thuoc va chu ky byte.

    private const int AvatarMaxBytes = 256 * 1024;

    // Nhan dang anh bang CHU KY BYTE DAU FILE chu khong theo Content-Type -
    // header do client dat nen no muon khai gi cung duoc. Ban sao co y cua ham
    // cung ten ben Identity Service: hai service khong dung chung thu vien
    // nao, va mot ham muoi dong khong dang de dung mot goi NuGet noi bo.
    private static string? SniffImageMime(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47)
            return "image/png";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
            return "image/jpeg";
        // WEBP: "RIFF" .... "WEBP"
        if (b.Length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46
            && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50)
            return "image/webp";
        return null;
    }

    // Chi Truong nhom / Pho nhom duoc doi anh - cung quyen voi doi ten nhom
    // (PATCH /workspaces/{id}, UC-18).
    private static async Task<bool> CoQuyenSuaAsync(WorkspaceDbContext db, long workspaceId, long userId)
    {
        var role = await db.WorkspaceMembers
            .Where(m => m.WorkspaceId == workspaceId && m.UserId == userId)
            .Select(m => (MemberRole?)m.Role)
            .SingleOrDefaultAsync();
        return role is MemberRole.Leader or MemberRole.Deputy;
    }

    private static void MapAvatarEndpoints(WebApplication app)
    {
        // KHONG doi dang nhap, cung ly do voi anh dai dien nguoi dung: anh hien
        // qua the img, ma the img khong gan duoc header Authorization.
        app.MapGet("/workspaces/{workspaceId:long}/avatar", async (long workspaceId, HttpContext http, WorkspaceDbContext db) =>
        {
            var row = await db.Workspaces
                .Where(w => w.Id == workspaceId)
                .Select(w => new { w.AvatarBytes, w.AvatarMime })
                .FirstOrDefaultAsync();

            if (row?.AvatarBytes is null || row.AvatarMime is null)
                return Results.NotFound();

            var mime = row.AvatarMime is "image/png" or "image/jpeg" or "image/webp"
                ? row.AvatarMime
                : "application/octet-stream";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";

            // Dia chi luon kem ?v=<AvatarUpdatedAt> nen mot dia chi cu the
            // khong bao gio doi noi dung - cache duoc rat lau.
            http.Response.Headers.CacheControl = "public, max-age=604800, immutable";
            return Results.File(row.AvatarBytes, mime);
        }).AllowAnonymous();

        var avatar = app.MapGroup("/workspaces/{workspaceId:long}/avatar").RequireAuthorization();

        // Nhan THANG byte anh trong than request (khong phai multipart): client
        // da co san mot Blob sau khi cat anh, gui thang la xong.
        avatar.MapPut("", async (long workspaceId, HttpContext http, ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            if (!await CoQuyenSuaAsync(db, workspaceId, userId))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom hoac Pho nhom duoc doi anh nhom"), statusCode: 403);

            // Doc co gioi han: doc thang toi khi het luong thi mot request co
            // tinh gui 2GB se lam sap ca tien trinh.
            using var ms = new MemoryStream();
            var buf = new byte[64 * 1024];
            int read;
            while ((read = await http.Request.Body.ReadAsync(buf)) > 0)
            {
                ms.Write(buf, 0, read);
                if (ms.Length > AvatarMaxBytes)
                    return Results.Json(
                        new ErrorResponse("avatar_too_large", $"Anh nhom toi da {AvatarMaxBytes / 1024} KB"),
                        statusCode: 413);
            }

            var bytes = ms.ToArray();
            if (bytes.Length == 0)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Khong nhan duoc du lieu anh"));

            var mime = SniffImageMime(bytes);
            if (mime is null)
                return Results.BadRequest(new ErrorResponse("invalid_image", "Chi nhan anh PNG, JPEG hoac WebP"));

            var workspace = await db.Workspaces.FindAsync(workspaceId);
            if (workspace is null)
                return Results.NotFound();

            var now = DateTimeOffset.UtcNow;
            workspace.AvatarBytes = bytes;
            workspace.AvatarMime = mime;
            workspace.AvatarUpdatedAt = now;
            // KHONG dong vao UpdatedAt: cot do sap thu tu danh sach nhom theo
            // "hoat dong gan day", doi anh khong phai mot hoat dong trong nhom.
            await db.SaveChangesAsync();

            return Results.Ok(new WorkspaceAvatarResponse(now));
        }).DisableAntiforgery();

        avatar.MapDelete("", async (long workspaceId, ClaimsPrincipal principal, WorkspaceDbContext db) =>
        {
            var userId = GetUserId(principal)!.Value;
            if (!await CoQuyenSuaAsync(db, workspaceId, userId))
                return Results.Json(new ErrorResponse("forbidden", "Chi Truong nhom hoac Pho nhom duoc doi anh nhom"), statusCode: 403);

            var workspace = await db.Workspaces.FindAsync(workspaceId);
            if (workspace is null)
                return Results.NotFound();

            workspace.AvatarBytes = null;
            workspace.AvatarMime = null;
            workspace.AvatarUpdatedAt = null;
            await db.SaveChangesAsync();

            return Results.Ok(new WorkspaceAvatarResponse(null));
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
