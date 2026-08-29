using System.Security.Claims;
using IdentityService.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

public static class UsersEndpoints
{
    public static void MapUsersEndpoints(this WebApplication app)
    {
        MapAvatarEndpoints(app);

        var users = app.MapGroup("/users").RequireAuthorization();

        users.MapGet("/me", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId.Value);
            return user is null ? Results.NotFound() : Results.Ok(UserResponse.FromEntity(user));
        });

        // Bat buoc goi sau dang ky/dang nhap OAuth lan dau (requiresNickname=true),
        // co the goi lai bat ky luc nao de doi ten hien thi.
        users.MapPatch("/me/nickname", async (UpdateNicknameRequest req, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Nickname) || req.Nickname.Length > 50)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Nickname bat buoc, toi da 50 ky tu"));

            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId.Value);
            if (user is null)
                return Results.NotFound();

            var nicknameTaken = await db.Users.AnyAsync(u => u.Id != userId && u.Nickname.ToLower() == req.Nickname.ToLower());
            if (nicknameTaken)
                return Results.Conflict(new ErrorResponse("nickname_taken", "Nickname da co nguoi su dung"));

            user.Nickname = req.Nickname;
            await db.SaveChangesAsync();
            return Results.Ok(UserResponse.FromEntity(user));
        });

        // Tim nguoi dung theo nickname (tu de xuat, phuc vu man hinh "Tim
        // ban" o Frontend - tinh nang ban be khong co trong tai lieu goc,
        // xem FriendsEndpoints.cs). Chi tim user Active, loai chinh minh.
        users.MapGet("/search", async (string q, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(q))
                return Results.Ok(Array.Empty<UserResponse>());

            var results = await db.Users
                .Where(u => u.Id != userId && u.Status == Models.UserStatus.Active && EF.Functions.ILike(u.Nickname, $"%{q}%"))
                .OrderBy(u => u.Nickname)
                .Take(20)
                .ToListAsync();

            return Results.Ok(results.Select(UserResponse.FromEntity));
        });

        // Ho so CONG KHAI cua nhieu nguoi cung luc, tra theo danh sach id.
        //
        // Sinh ra vi phong hop: Media Service chi biet userId + nickname cua
        // nguoi trong phong, khong biet moc doi anh dai dien. Ma thieu moc do
        // thi lib/avatarUrl.ts tra null va o nao trong phong cung chi hien
        // duoc chu cai dau. Hoi tung nguoi mot thi mot phong 30 nguoi la 30
        // request.
        //
        // Tra ve KIEU HEP rieng chu khong dung UserResponse: UserResponse co
        // ca email va trang thai khoa: khong co ly do gi de mot nguoi trong
        // phong hop doc duoc email cua nhung nguoi con lai.
        users.MapGet("", async (string? ids, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            // Chan 200 id mot lan goi: danh sach do client dat nen khong the
            // de no tu quyet dinh cau IN dai bao nhieu.
            var danhSach = (ids ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => long.TryParse(x, out var v) ? v : (long?)null)
                .Where(x => x is not null)
                .Select(x => x!.Value)
                .Distinct()
                .Take(200)
                .ToArray();

            if (danhSach.Length == 0)
                return Results.Ok(Array.Empty<PublicUserResponse>());

            var rows = await db.Users
                .Where(u => danhSach.Contains(u.Id))
                .Select(u => new PublicUserResponse(u.Id, u.Nickname, u.AvatarUpdatedAt))
                .ToListAsync();

            return Results.Ok(rows);
        });
    }

    // ---- Anh dai dien ----------------------------------------------------
    //
    // Luu thang trong DB thay vi MinIO - xem ghi chu o identity-db-init.sql.
    //
    // Anh da duoc trinh duyet cat con <=512px va nen lai TRUOC khi gui (xem
    // lib/imageResize.ts), nen cai den day chi con vai chuc KB. Server van
    // phai tu kiem lai: khong bao gio tin kich thuoc hay kieu file ma client
    // khai bao.
    private const int AvatarMaxBytes = 256 * 1024;

    // Nhan dang anh bang CHU KY BYTE DAU FILE chu khong theo header
    // Content-Type. Content-Type do client dat nen no muon ghi gi cung duoc;
    // mot file HTML kem ma doc van co the tu xung la "image/png". Doc byte
    // that thi khong gia duoc.
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

    private static void MapAvatarEndpoints(WebApplication app)
    {
        // Tra anh dai dien. KHONG doi dang nhap: anh dai dien hien o danh sach
        // ban be, danh sach nhom, khung chat... deu qua the <img>, ma the <img>
        // khong gan duoc header Authorization. Anh dai dien cung khong phai bi
        // mat - ai nhin thay nguoi do thi nhin thay anh.
        app.MapGet("/users/{userId:long}/avatar", async (long userId, HttpContext http, IdentityDbContext db) =>
        {
            var row = await db.Users
                .Where(u => u.Id == userId)
                .Select(u => new { u.AvatarBytes, u.AvatarMime, u.AvatarUpdatedAt })
                .FirstOrDefaultAsync();

            if (row?.AvatarBytes is null || row.AvatarMime is null)
                return Results.NotFound();

            // Chi cho phep dung ba kieu da tung sniff duoc. Cong them nosniff
            // de trinh duyet khong tu doan lai kieu roi chay nham thu gi do.
            var mime = row.AvatarMime is "image/png" or "image/jpeg" or "image/webp"
                ? row.AvatarMime
                : "application/octet-stream";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";

            // URL luon kem ?v=<AvatarUpdatedAt> (client tu gan) nen mot URL cu
            // the KHONG BAO GIO doi noi dung - cache duoc rat lau. Doi anh la
            // doi URL, trinh duyet lay ban moi ngay.
            http.Response.Headers.CacheControl = "public, max-age=604800, immutable";
            return Results.File(row.AvatarBytes, mime);
        }).AllowAnonymous();

        var me = app.MapGroup("/users/me").RequireAuthorization();

        // Nhan THANG byte anh trong than request (khong phai multipart): client
        // da co san mot Blob sau khi cat anh, gui thang la xong - khong phai
        // dung goi thu vien nao de doc/ghi dinh dang multipart.
        me.MapPut("/avatar", async (HttpContext http, ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            // Doc co gioi han: doc thang toi khi het luong thi mot request
            // co tinh gui 2GB se lam sap ca tien trinh. Doc du nguong + 1 byte
            // roi tu choi neu dai hon - biet la qua ma khong phai nuot het.
            using var ms = new MemoryStream();
            var buf = new byte[64 * 1024];
            int read;
            while ((read = await http.Request.Body.ReadAsync(buf)) > 0)
            {
                ms.Write(buf, 0, read);
                if (ms.Length > AvatarMaxBytes)
                    return Results.Json(
                        new ErrorResponse("avatar_too_large", $"Ảnh đại diện tối đa {AvatarMaxBytes / 1024} KB"),
                        statusCode: 413);
            }

            var bytes = ms.ToArray();
            if (bytes.Length == 0)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Không nhận được dữ liệu ảnh"));

            var mime = SniffImageMime(bytes);
            if (mime is null)
                return Results.BadRequest(new ErrorResponse("invalid_image", "Chỉ nhận ảnh PNG, JPEG hoặc WebP"));

            var user = await db.Users.FindAsync(userId.Value);
            if (user is null)
                return Results.NotFound();

            user.AvatarBytes = bytes;
            user.AvatarMime = mime;
            user.AvatarUpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(UserResponse.FromEntity(user));
        }).DisableAntiforgery();

        me.MapDelete("/avatar", async (ClaimsPrincipal principal, IdentityDbContext db) =>
        {
            var userId = GetUserId(principal);
            if (userId is null)
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId.Value);
            if (user is null)
                return Results.NotFound();

            user.AvatarBytes = null;
            user.AvatarMime = null;
            user.AvatarUpdatedAt = null;
            await db.SaveChangesAsync();

            return Results.Ok(UserResponse.FromEntity(user));
        });
    }

    private static long? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub");
        return sub is not null && long.TryParse(sub, out var id) ? id : null;
    }
}
