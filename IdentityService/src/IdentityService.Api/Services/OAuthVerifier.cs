using System.Text.Json;

namespace IdentityService.Api.Services;

public record OAuthUserInfo(string ProviderUserId, string? Email);

// Client ID khong phai secret, nhung la audience bat buoc khi kiem tra token.
// Neu chi goi /userinfo, access token cua MOT ung dung Google KHAC van co the
// tra ve thong tin nguoi dung hop le va bi nhan nham la token cua Calli.
public class OAuthOptions
{
    public string GoogleClientId { get; set; } = string.Empty;
}

public interface IOAuthVerifier
{
    Task<OAuthUserInfo?> VerifyAsync(string provider, string oauthToken);
}

// Goi thang API cua Google/Facebook de xac thuc oauthToken tu client va lay
// provider_user_id + email - khong tu tao/tin token tu client ma khong verify.
public class OAuthVerifier(
    IHttpClientFactory httpClientFactory,
    OAuthOptions options,
    ILogger<OAuthVerifier> logger) : IOAuthVerifier
{
    public async Task<OAuthUserInfo?> VerifyAsync(string provider, string oauthToken)
    {
        var client = httpClientFactory.CreateClient();
        try
        {
            return provider switch
            {
                "google" => await VerifyGoogleAsync(client, oauthToken, options.GoogleClientId),
                "facebook" => await VerifyFacebookAsync(client, oauthToken),
                _ => null,
            };
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "OAuth verify that bai voi provider {Provider}", provider);
            return null;
        }
    }

    private static async Task<OAuthUserInfo?> VerifyGoogleAsync(HttpClient client, string token, string clientId)
    {
        // tokeninfo kiem tra ca hieu luc token LAN audience. API /userinfo cu
        // chi chung minh token hop le, khong chung minh no duoc cap cho Calli.
        if (string.IsNullOrWhiteSpace(clientId))
            return null;

        var resp = await client.GetAsync($"https://oauth2.googleapis.com/tokeninfo?access_token={Uri.EscapeDataString(token)}");
        if (!resp.IsSuccessStatusCode)
            return null;

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        var audience = root.TryGetProperty("aud", out var aud) ? aud.GetString() : null;
        if (!string.Equals(audience, clientId, StringComparison.Ordinal))
            return null;

        var sub = root.GetProperty("sub").GetString();
        var email = root.TryGetProperty("email", out var e) ? e.GetString() : null;
        return sub is null ? null : new OAuthUserInfo(sub, email);
    }

    private static async Task<OAuthUserInfo?> VerifyFacebookAsync(HttpClient client, string token)
    {
        var resp = await client.GetAsync($"https://graph.facebook.com/me?fields=id,email&access_token={Uri.EscapeDataString(token)}");
        if (!resp.IsSuccessStatusCode)
            return null;

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        var id = root.GetProperty("id").GetString();
        var email = root.TryGetProperty("email", out var e) ? e.GetString() : null;
        return id is null ? null : new OAuthUserInfo(id, email);
    }
}
