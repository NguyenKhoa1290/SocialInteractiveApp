namespace IdentityService.Api.Services;

public interface IEmailSender
{
    Task SendOtpAsync(string toEmail, string otp);

    // Ma xac thuc luc DANG KY. Tach khoi SendOtpAsync (quen mat khau) chu
    // khong dung chung: hai email den vao hai luc khac han nhau, dung chung
    // mot dong tieu de "Ma OTP xac thuc tai khoan" thi nguoi dung khong biet
    // cai nao la cai minh vua yeu cau.
    Task SendRegistrationOtpAsync(string toEmail, string otp, string nickname);
}
