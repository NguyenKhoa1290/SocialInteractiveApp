namespace IdentityService.Api.Services;

public interface IEmailSender
{
    Task SendOtpAsync(string toEmail, string otp);
}
