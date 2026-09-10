using IdentityService.Api.Models;

namespace IdentityService.Api.Endpoints;

public record RegisterRequest(string Email, string Password, string DisplayName);
public record LoginRequest(string Email, string Password);
// DeviceFingerprint la SHA-256 do frontend tinh tu mot tap dac tinh giao dien
// toi thieu. No la tin hieu chong lam dung, khong phai dinh danh hay thong tin
// dang nhap; client cu khong gui no van duoc gioi han bang cookie device.
public record GuestRequest(string DisplayName, string? DeviceFingerprint);

// AvatarUpdatedAt vua la co "co anh dai dien hay khong" vua la ma chong cache:
// client gan no vao URL anh, nen doi anh la trinh duyet lay ban moi ngay, con
// khong doi thi no dung lai anh da tai - khong phai tai lai sau moi lan mo.
// KHONG tra byte anh o day: DTO nay di kem moi lan dang nhap, moi lan lay
// thong tin, keo theo vai tram KB moi lan thi qua phi.
public record UserResponse(
    long Id, string UserType, string Nickname, string DisplayName, string? Email, string Status,
    DateTimeOffset CreatedAt, DateTimeOffset? AvatarUpdatedAt)
{
    public static UserResponse FromEntity(User u) => new(
        u.Id,
        u.UserType == Models.UserType.Guest ? "guest" : "registered",
        u.Nickname,
        u.DisplayName,
        u.Email,
        u.Status == UserStatus.Active ? "active" : "locked",
        u.CreatedAt,
        u.AvatarUpdatedAt);
}

// Nhung gi MOI NGUOI trong he thong duoc biet ve mot nguoi khac: ten hien
// thi, va moc doi anh dai dien (vua la co "co anh khong", vua la ma chong
// cache - xem lib/avatarUrl.ts). Khong co email, khong co trang thai khoa.
public record PublicUserResponse(long Id, string Nickname, string DisplayName, DateTimeOffset? AvatarUpdatedAt);

public record AuthSuccessResponse(string AccessToken, UserResponse User);
public record ErrorResponse(string Error, string Message);

public record OAuthRequest(string OauthToken);
public record OAuthSuccessResponse(string AccessToken, UserResponse User, bool IsNewUser, bool RequiresDisplayName);

public record ForgotPasswordRequest(string Email);
public record VerifyOtpRequest(string Email, string Otp);

// Dang ky xong buoc 1: CHUA co tai khoan nao, chi moi gui ma qua mail.
// `TtlGiay` de client dem nguoc "ma het han sau...", `GuiLaiSauGiay` de biet
// khi nao mo lai duoc nut "Gui lai ma".
public record RegisterPendingResponse(string Email, int TtlGiay, int GuiLaiSauGiay);
public record VerifyRegistrationRequest(string Email, string Otp);
public record VerifyOtpResponse(string ResetToken, bool IsFirstTimePassword);
public record ResetPasswordRequest(string ResetToken, string NewPassword);

public record UpdateNicknameRequest(string Nickname);
public record UpdateDisplayNameRequest(string DisplayName);
