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

public class JwtTokenService(JwtOptions options)
{
    public string IssueToken(User user)
    {
        var expiryMinutes = user.UserType == UserType.Guest
            ? options.GuestTokenExpiryMinutes
            : options.RegisteredTokenExpiryMinutes;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new("user_type", user.UserType == UserType.Guest ? "guest" : "registered"),
            new("nickname", user.Nickname),
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: options.Issuer,
            audience: options.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiryMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
