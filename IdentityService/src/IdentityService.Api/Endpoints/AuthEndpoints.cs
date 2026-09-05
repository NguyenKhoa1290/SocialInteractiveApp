using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using IdentityService.Api.Data;
using IdentityService.Api.Models;
using IdentityService.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Endpoints;

public static class AuthEndpoints
{
    private static readonly TimeSpan OtpTtl = TimeSpan.FromMinutes(10);

    // Mot lan dang ky cho xac thuc song bao lau. Bang OTP quen mat khau cho de
    // nho: qua 10 phut thi bam "Dang ky" lai tu dau.
    private static readonly TimeSpan DangKyTtl = TimeSpan.FromMinutes(10);
    // Bam "Gui lai ma" som nhat sau bao lau.
    private static readonly TimeSpan GuiLaiCach = TimeSpan.FromSeconds(60);
    // Nhap sai qua so lan nay thi huy han lan dang ky do - ma 6 so chi co mot
    // trieu kha nang, khong chan thi do dung duoc.
    private const int MaxLanSai = 5;
    private static readonly TimeSpan ResetTokenTtl = TimeSpan.FromMinutes(10);

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/auth");

        // UC-06: Dang ky bang email + mat khau, CO xac thuc email.
        //
        // Buoc nay KHONG ghi gi vao Postgres. Ca lan dang ky nam trong Redis 10
        // phut, cho toi khi nguoi dung nhap dung ma gui qua mail - chi
        // POST /auth/register/verify moi thuc su tao tai khoan.
        //
        // VI SAO khong tao truoc roi danh dau "chua xac thuc": lam vay thi bang
        // users day tai khoan treo do nguoi la go bua dia chi mail cua nguoi
        // khac, va email/nickname bi giu cho boi nhung ban ghi khong ai dung.
        // Doi lai: mat ma giua chung thi phai bam "Dang ky" lai tu dau - chap
        // nhan duoc voi mot thao tac chi lam mot lan trong doi tai khoan.
        auth.MapPost("/register", async (
            RegisterRequest req, IdentityDbContext db, RedisAuthStore store,
            IEmailSender email, ILoggerFactory loggerFactory) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password) || string.IsNullOrWhiteSpace(req.Nickname))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Email, password va nickname la bat buoc"));

            if (req.Password.Length < 8)
                return Results.BadRequest(new ErrorResponse("weak_password", "Mat khau toi thieu 8 ky tu"));

            // Dia chi phai gui duoc thi moi co nghia - truoc day khong kiem, go
            // bua mot chuoi van ra tai khoan that.
            if (!DiaChiMailHopLe(req.Email))
                return Results.BadRequest(new ErrorResponse("invalid_email", "Dia chi email khong hop le"));

            var exists = await db.Users.AnyAsync(u => u.Email == req.Email);
            if (exists)
                return Results.Conflict(new ErrorResponse("email_taken", "Email da duoc dang ky"));

            // Nickname phai duy nhat toan he thong (tu bo sung, xem
            // identity-db-init.sql idx_users_nickname_lower) - can cho tim
            // kiem ban be theo nickname khong bi lan giua nhieu nguoi.
            var nicknameTaken = await db.Users.AnyAsync(u => u.Nickname.ToLower() == req.Nickname.ToLower());
            if (nicknameTaken)
                return Results.Conflict(new ErrorResponse("nickname_taken", "Nickname da co nguoi su dung"));

            var ma = Random.Shared.Next(0, 1_000_000).ToString("D6");
            await store.StorePendingRegistrationAsync(
                new PendingRegistration(req.Email, BCrypt.Net.BCrypt.HashPassword(req.Password), req.Nickname, ma),
                DangKyTtl);

            try
            {
                await email.SendRegistrationOtpAsync(req.Email, ma, req.Nickname);
            }
            catch (Exception ex)
            {
                // Khong gui duoc mail thi phai noi that. Im lang tra 202 la de
                // nguoi dung ngoi cho mot email khong bao gio toi.
                loggerFactory.CreateLogger("DangKy").LogError(ex, "Khong gui duoc ma xac thuc toi {Email}", req.Email);
                await store.DeletePendingRegistrationAsync(req.Email);
                return Results.Json(
                    new ErrorResponse("email_send_failed", "Khong gui duoc ma xac thuc toi email nay, thu lai sau"),
                    statusCode: 502);
            }

            // Bat dong ho cho "Gui lai ma" ngay tu lan gui dau: khong thi bam
            // Dang ky xong bam Gui lai luon la ra hai email trong mot giay.
            await store.DuocGuiLaiAsync(req.Email, GuiLaiCach);

            return Results.Accepted(value: new RegisterPendingResponse(
                req.Email, (int)DangKyTtl.TotalSeconds, (int)GuiLaiCach.TotalSeconds));
        });

        // Nhap ma -> luc nay tai khoan moi thuc su duoc tao.
        auth.MapPost("/register/verify", async (
            VerifyRegistrationRequest req, IdentityDbContext db, RedisAuthStore store,
            JwtTokenService jwt, KafkaProducerService kafka) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Otp))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Email va ma xac thuc la bat buoc"));

            var pending = await store.GetPendingRegistrationAsync(req.Email);
            if (pending is null)
                return Results.BadRequest(new ErrorResponse("registration_expired", "Lan dang ky nay da het han, hay dang ky lai"));

            if (pending.Otp != req.Otp.Trim())
            {
                var lanSai = await store.DemLanSaiAsync(req.Email, DangKyTtl);
                if (lanSai >= MaxLanSai)
                {
                    await store.DeletePendingRegistrationAsync(req.Email);
                    return Results.BadRequest(new ErrorResponse("too_many_attempts", "Nhap sai qua nhieu lan, hay dang ky lai"));
                }
                return Results.BadRequest(new ErrorResponse("invalid_otp", "Ma xac thuc khong dung"));
            }

            // Kiem lai mot lan nua: 10 phut vua roi du de nguoi khac lay mat
            // email hoac nickname do.
            if (await db.Users.AnyAsync(u => u.Email == pending.Email))
            {
                await store.DeletePendingRegistrationAsync(req.Email);
                return Results.Conflict(new ErrorResponse("email_taken", "Email da duoc dang ky"));
            }
            if (await db.Users.AnyAsync(u => u.Nickname.ToLower() == pending.Nickname.ToLower()))
            {
                await store.DeletePendingRegistrationAsync(req.Email);
                return Results.Conflict(new ErrorResponse("nickname_taken", "Nickname da co nguoi su dung"));
            }

            var user = new User
            {
                UserType = UserType.Registered,
                Nickname = pending.Nickname,
                Email = pending.Email,
                // Mat khau da hash tu luc bam "Dang ky" - Redis khong bao gio
                // giu mat khau goc.
                PasswordHash = pending.PasswordHash,
                Status = UserStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                LastActiveAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            await store.DeletePendingRegistrationAsync(req.Email);

            var token = jwt.IssueToken(user);
            await kafka.PublishAuthEventAsync("register", user.Id, user.Email, "registered");
            return Results.Created($"/users/{user.Id}", new AuthSuccessResponse(token.AccessToken, UserResponse.FromEntity(user)));
        });

        // Gui lai ma cho lan dang ky dang cho.
        auth.MapPost("/register/resend", async (
            ForgotPasswordRequest req, RedisAuthStore store, IEmailSender email, ILoggerFactory loggerFactory) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email))
                return Results.BadRequest(new ErrorResponse("invalid_request", "Email la bat buoc"));

            var pending = await store.GetPendingRegistrationAsync(req.Email);
            if (pending is null)
                return Results.BadRequest(new ErrorResponse("registration_expired", "Lan dang ky nay da het han, hay dang ky lai"));

            if (!await store.DuocGuiLaiAsync(req.Email, GuiLaiCach))
                return Results.Json(
                    new ErrorResponse("resend_too_soon", $"Doi {GuiLaiCach.TotalSeconds:0} giay roi hay gui lai"),
                    statusCode: 429);

            // Gui lai DUNG ma cu chu khong sinh ma moi: nguoi dung mo hai email
            // ra thay hai ma khac nhau thi chi to roi.
            try
            {
                await email.SendRegistrationOtpAsync(pending.Email, pending.Otp, pending.Nickname);
            }
            catch (Exception ex)
            {
                loggerFactory.CreateLogger("DangKy").LogError(ex, "Khong gui lai duoc ma xac thuc toi {Email}", pending.Email);
                return Results.Json(
                    new ErrorResponse("email_send_failed", "Khong gui duoc ma xac thuc toi email nay, thu lai sau"),
                    statusCode: 502);
            }

            return Results.Accepted(value: new RegisterPendingResponse(
                pending.Email, (int)DangKyTtl.TotalSeconds, (int)GuiLaiCach.TotalSeconds));
        });

        // UC-01: Dang nhap email + mat khau
        auth.MapPost("/login", async (LoginRequest req, IdentityDbContext db, JwtTokenService jwt, KafkaProducerService kafka) =>
        {
            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == req.Email);
            if (user is null || user.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
                return Results.Json(new ErrorResponse("invalid_credentials", "Sai email hoac mat khau"), statusCode: 401);

            if (user.Status == UserStatus.Locked)
                return Results.Json(
                    new { error = "account_locked", message = "Tai khoan dang bi khoa vi vi pham chinh sach chong spam" },
                    statusCode: 403);

            user.LastActiveAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            var token = jwt.IssueToken(user);
            await kafka.PublishAuthEventAsync("login", user.Id, user.Email, "registered");
            return Results.Ok(new AuthSuccessResponse(token.AccessToken, UserResponse.FromEntity(user)));
        });

        // UC-04: Truy cap dang Guest - chi can nickname
        auth.MapPost("/guest", async (GuestRequest req, IdentityDbContext db, JwtTokenService jwt, KafkaProducerService kafka) =>
        {
            if (string.IsNullOrWhiteSpace(req.Nickname) || req.Nickname.Length > 50)
                return Results.BadRequest(new ErrorResponse("invalid_request", "Nickname bat buoc, toi da 50 ky tu"));

            var nicknameTaken = await db.Users.AnyAsync(u => u.Nickname.ToLower() == req.Nickname.ToLower());
            if (nicknameTaken)
                return Results.Conflict(new ErrorResponse("nickname_taken", "Nickname da co nguoi su dung"));

            var user = new User
            {
                UserType = UserType.Guest,
                Nickname = req.Nickname,
                Status = UserStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                LastActiveAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            var token = jwt.IssueToken(user);
            await kafka.PublishAuthEventAsync("guest", user.Id, null, "guest");
            return Results.Ok(new AuthSuccessResponse(token.AccessToken, UserResponse.FromEntity(user)));
        });

        // UC-02/03/07/08: Dang nhap/Dang ky qua OAuth (Google/Facebook) - dung chung endpoint
        auth.MapPost("/oauth/{provider}", async (string provider, OAuthRequest req, IdentityDbContext db, JwtTokenService jwt, IOAuthVerifier verifier, KafkaProducerService kafka) =>
        {
            if (provider is not ("google" or "facebook"))
                return Results.BadRequest(new ErrorResponse("invalid_provider", "provider phai la google hoac facebook"));

            var info = await verifier.VerifyAsync(provider, req.OauthToken);
            if (info is null)
                return Results.Json(new ErrorResponse("invalid_oauth_token", "Khong xac thuc duoc oauthToken voi provider"), statusCode: 401);

            var providerEnum = provider == "google" ? OAuthProvider.Google : OAuthProvider.Facebook;

            var existingLink = await db.OAuthLinks
                .Include(l => l.User)
                .SingleOrDefaultAsync(l => l.Provider == providerEnum && l.ProviderUserId == info.ProviderUserId);

            if (existingLink is not null)
            {
                var existingUser = existingLink.User!;
                if (existingUser.Status == UserStatus.Locked)
                    return Results.Json(new { error = "account_locked", message = "Tai khoan dang bi khoa vi vi pham chinh sach chong spam" }, statusCode: 403);

                existingUser.LastActiveAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
                var tok = jwt.IssueToken(existingUser);
                await kafka.PublishAuthEventAsync("login", existingUser.Id, existingUser.Email, "registered");
                return Results.Ok(new OAuthSuccessResponse(tok.AccessToken, UserResponse.FromEntity(existingUser), IsNewUser: false, RequiresNickname: false));
            }

            // Email tu provider da ton tai voi phuong thuc dang ky khac - CHUA CHOT xu ly
            // (xem UC-07, muc Ghi chu/Diem mo trong tai lieu roadmap). Tam thoi tu choi 409.
            if (info.Email is not null && await db.Users.AnyAsync(u => u.Email == info.Email))
                return Results.Conflict(new ErrorResponse("email_already_linked_other_method", "Email nay da dang ky bang phuong thuc khac"));

            var newUser = new User
            {
                UserType = UserType.Registered,
                Nickname = $"user_{Guid.NewGuid():N}"[..12], // tam, bat buoc doi qua PATCH /users/me/nickname
                Email = null, // KHONG tu lay email lam dinh danh chinh - nickname bat buoc nhap rieng theo UC-07/08
                Status = UserStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow,
                LastActiveAt = DateTimeOffset.UtcNow,
            };
            newUser.OAuthLinks.Add(new OAuthLink
            {
                Provider = providerEnum,
                ProviderUserId = info.ProviderUserId,
                LinkedAt = DateTimeOffset.UtcNow,
            });
            db.Users.Add(newUser);
            await db.SaveChangesAsync();

            var newTok = jwt.IssueToken(newUser);
            await kafka.PublishAuthEventAsync("register", newUser.Id, newUser.Email, "registered");
            return Results.Ok(new OAuthSuccessResponse(newTok.AccessToken, UserResponse.FromEntity(newUser), IsNewUser: true, RequiresNickname: true));
        });

        // UC-05 buoc 1-2: Gui OTP qua email
        auth.MapPost("/forgot-password", async (ForgotPasswordRequest req, IdentityDbContext db, RedisAuthStore store, IEmailSender email) =>
        {
            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == req.Email);
            if (user is not null)
            {
                var otp = Random.Shared.Next(0, 1_000_000).ToString("D6");
                await store.StoreOtpAsync(req.Email, otp, OtpTtl);
                await email.SendOtpAsync(req.Email, otp);
            }
            // Luon tra 202 ke ca email khong ton tai - tranh lo thong tin email nao da dang ky
            return Results.Accepted();
        });

        // UC-05 buoc 3: Xac thuc OTP
        auth.MapPost("/verify-otp", async (VerifyOtpRequest req, IdentityDbContext db, RedisAuthStore store) =>
        {
            var valid = await store.VerifyAndConsumeOtpAsync(req.Email, req.Otp);
            if (!valid)
                return Results.BadRequest(new ErrorResponse("invalid_otp", "OTP sai hoac het han"));

            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == req.Email);
            if (user is null)
                return Results.BadRequest(new ErrorResponse("invalid_otp", "OTP sai hoac het han"));

            var resetToken = await store.IssueResetTokenAsync(req.Email, ResetTokenTtl);
            return Results.Ok(new VerifyOtpResponse(resetToken, IsFirstTimePassword: user.PasswordHash is null));
        });

        // UC-05 buoc 4: Dat mat khau moi (ap dung ca lan dau tao mat khau cho tai khoan OAuth-only)
        auth.MapPost("/reset-password", async (ResetPasswordRequest req, IdentityDbContext db, RedisAuthStore store) =>
        {
            if (req.NewPassword.Length < 8)
                return Results.BadRequest(new ErrorResponse("weak_password", "Mat khau toi thieu 8 ky tu"));

            var email = await store.ConsumeResetTokenAsync(req.ResetToken);
            if (email is null)
                return Results.BadRequest(new ErrorResponse("invalid_reset_token", "resetToken khong hop le hoac da het han"));

            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == email);
            if (user is null)
                return Results.BadRequest(new ErrorResponse("invalid_reset_token", "resetToken khong hop le hoac da het han"));

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // Dang xuat - danh dau jti cua token hien tai vao blocklist toi khi het han tu nhien
        auth.MapPost("/logout", async (ClaimsPrincipal principal, RedisAuthStore store) =>
        {
            var jti = principal.FindFirstValue(JwtRegisteredClaimNames.Jti);
            var expClaim = principal.FindFirstValue(JwtRegisteredClaimNames.Exp);
            if (jti is not null && expClaim is not null && long.TryParse(expClaim, out var expUnix))
            {
                var expiresAt = DateTimeOffset.FromUnixTimeSeconds(expUnix);
                var ttl = expiresAt - DateTimeOffset.UtcNow;
                if (ttl > TimeSpan.Zero)
                    await store.BlocklistTokenAsync(jti, ttl);
            }
            return Results.NoContent();
        }).RequireAuthorization();

        // Sliding expiration (tu de xuat, khac phuc thieu sot: comment cu o
        // JwtTokenService.cs nhac toi "endpoint refresh" nhung chua tung
        // duoc viet) - client goi endpoint nay TRUOC khi token het han (vi
        // du o 80% thoi gian song) de duoc cap token moi cung han muc,
        // mien la con hoat dong. Bat buoc token HIEN TAI van con hop le
        // (RequireAuthorization) - khong the "hoi sinh" token da het han,
        // dung dung nguyen tac "chi gia han khi con hoat dong".
        auth.MapPost("/refresh", async (ClaimsPrincipal principal, IdentityDbContext db, JwtTokenService jwt, RedisAuthStore store) =>
        {
            var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
            if (sub is null || !long.TryParse(sub, out var userId))
                return Results.Unauthorized();

            var user = await db.Users.FindAsync(userId);
            if (user is null)
                return Results.Unauthorized();

            if (user.Status == UserStatus.Locked)
                return Results.Json(
                    new { error = "account_locked", message = "Tai khoan dang bi khoa vi vi pham chinh sach chong spam" },
                    statusCode: 403);

            // Chan token cu ngay sau khi cap token moi - tranh 2 token cung
            // song song hop le (giam thieu rui ro neu token cu bi lo).
            var jti = principal.FindFirstValue(JwtRegisteredClaimNames.Jti);
            var expClaim = principal.FindFirstValue(JwtRegisteredClaimNames.Exp);
            if (jti is not null && expClaim is not null && long.TryParse(expClaim, out var expUnix))
            {
                var expiresAt = DateTimeOffset.FromUnixTimeSeconds(expUnix);
                var ttl = expiresAt - DateTimeOffset.UtcNow;
                if (ttl > TimeSpan.Zero)
                    await store.BlocklistTokenAsync(jti, ttl);
            }

            user.LastActiveAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            var token = jwt.IssueToken(user);
            return Results.Ok(new AuthSuccessResponse(token.AccessToken, UserResponse.FromEntity(user)));
        }).RequireAuthorization();
    }

    // Dia chi mail co gui duoc khong. KHONG dung regex tu che: MailAddress
    // trong .NET da lam dung viec nay, va mot regex email tu viet thi hoac
    // chan nham dia chi that hoac lot dia chi rac.
    private static bool DiaChiMailHopLe(string email)
    {
        try
        {
            var m = new System.Net.Mail.MailAddress(email.Trim());
            // MailAddress nhan ca "a@b" - phai co dau cham o phan ten mien thi
            // moi gui thuc te duoc.
            return m.Address == email.Trim() && m.Host.Contains('.');
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
