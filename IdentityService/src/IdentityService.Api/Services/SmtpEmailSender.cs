using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace IdentityService.Api.Services;

public class SmtpOptions
{
    public string Host { get; set; } = "smtp.gmail.com";
    public int Port { get; set; } = 587;
    public string Username { get; set; } = string.Empty;

    // Gmail yeu cau App Password (16 ky tu, sinh tu Google Account -> Security ->
    // 2-Step Verification -> App passwords) - KHONG dung mat khau Gmail thong
    // thuong, Google se tu choi ket noi SMTP voi mat khau tai khoan binh thuong.
    public string AppPassword { get; set; } = string.Empty;
    public string FromName { get; set; } = "Chat App";
}

public class SmtpEmailSender(SmtpOptions options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public Task SendOtpAsync(string toEmail, string otp) =>
        GuiAsync(
            toEmail,
            "Ma OTP dat lai mat khau",
            $"Ma OTP cua ban la: {otp}\n\nMa co hieu luc trong 10 phut. Bo qua email nay neu ban khong yeu cau.");

    public Task SendRegistrationOtpAsync(string toEmail, string otp, string nickname) =>
        GuiAsync(
            toEmail,
            "Ma xac thuc dang ky tai khoan",
            $"Chao {nickname},\n\n"
            + $"Ma xac thuc dang ky cua ban la: {otp}\n\n"
            + "Nhap ma nay trong 10 phut de hoan tat dang ky. Chua nhap ma thi chua co tai khoan nao duoc tao.\n\n"
            + "Neu ban khong dang ky, cu bo qua email nay - khong co gi de huy ca.");

    private async Task GuiAsync(string toEmail, string tieuDe, string noiDung)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(options.FromName, options.Username));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = tieuDe;
        message.Body = new TextPart("plain") { Text = noiDung };

        using var client = new SmtpClient();
        try
        {
            await client.ConnectAsync(options.Host, options.Port, SecureSocketOptions.StartTls);
            await client.AuthenticateAsync(options.Username, options.AppPassword);
            await client.SendAsync(message);
        }
        finally
        {
            if (client.IsConnected)
                await client.DisconnectAsync(true);
        }

        logger.LogInformation("Da gui mail '{TieuDe}' toi {Email} qua Gmail SMTP", tieuDe, toEmail);
    }
}
