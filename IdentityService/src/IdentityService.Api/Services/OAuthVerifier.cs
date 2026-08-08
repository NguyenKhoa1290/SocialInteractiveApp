using System.Text.Json;

namespace IdentityService.Api.Services;

public record OAuthUserInfo(string ProviderUserId, string? Email);

public interface IOAuthVerifier
{
    Task<OAuthUserInfo?> VerifyAsync(string provider, string oauthToken);
}

// Goi thang API cua Google/Facebook de xac thuc oauthToken tu client va lay
// provider_user_id + email - khong tu tao/tin token tu client ma khong verify.
public class OAuthVerifier(IHttpClientFactory httpClientFactory, ILogger<OAuthVerifier> logger) : IOAuthVerifier
{
    public async Task<OAuthUserInfo?> VerifyAsync(string provider, string oauthToken)
    {
        var client = httpClientFactory.CreateClient();
        try
        {
            return provider switch
            {
                "google" => await VerifyGoogleAsync(client, oauthToken),
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

    private static async Task<OAuthUserInfo?> VerifyGoogleAsync(HttpClient client, string token)
    {
        var resp = await client.GetAsync($"https://www.googleapis.com/oauth2/v3/userinfo?access_token={Uri.EscapeDataString(token)}");
        if (!resp.IsSuccessStatusCode)
            return null;

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
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
