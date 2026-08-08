using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using IdentityService.Api.Models;
using Microsoft.IdentityModel.Tokens;

namespace IdentityService.Api.Services;

public class JwtOptions
{
    public string SigningKey { get; set; } = string.Empty;
    public string Issuer { get; set; } = "identity-service";
    public string Audience { get; set; } = "chat-app";
    public int RegisteredTokenExpiryMinutes { get; set; } = 60;

    // Guest dung sliding expiration (UC-04): token song ngan, nhung tu gia han
    // moi khi con hoat dong - xem AuthEndpoints, endpoint refresh.
    public int GuestTokenExpiryMinutes { get; set; } = 30;
}

public record IssuedToken(string AccessToken, string Jti, DateTime ExpiresAtUtc);

public class JwtTokenService(JwtOptions options)
{
    public IssuedToken IssueToken(User user)
    {
        var expiryMinutes = user.UserType == UserType.Guest
            ? options.GuestTokenExpiryMinutes
            : options.RegisteredTokenExpiryMinutes;
        var expiresAt = DateTime.UtcNow.AddMinutes(expiryMinutes);
        var jti = Guid.NewGuid().ToString("N");

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, jti),
            new("user_type", user.UserType == UserType.Guest ? "guest" : "registered"),
            new("nickname", user.Nickname),
        };

        // role=admin chi duoc gan khi User.IsAdmin=true (Phase 4, Admin Service
        // kiem tra claim nay). Khong co claim "role" cho user thuong.
        if (user.IsAdmin)
            claims.Add(new Claim("role", "admin"));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: options.Issuer,
            audience: options.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);
        return new IssuedToken(accessToken, jti, expiresAt);
    }
}
