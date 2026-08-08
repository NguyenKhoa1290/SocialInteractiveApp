using System.Text.Json;

namespace WorkspaceService.Api.Services;

public class IdentityClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5194";
}

public record UserPublicInfo(long Id, string Nickname, string UserType);

// Goi sang Identity Service qua /internal/* (khong qua API Gateway public)
// de resolve nickname theo user_id - dung theo mo ta lien ket logic cross-DB
// trong tai lieu roadmap muc 1 va 5.3 (schema WorkspaceMember.nickname).
public class IdentityClient(HttpClient httpClient, IdentityClientOptions options, ILogger<IdentityClient> logger)
{
    public async Task<Dictionary<long, UserPublicInfo>> ResolveUsersAsync(IEnumerable<long> userIds)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
            return [];

        try
        {
            var idsParam = string.Join(',', ids);
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/users?ids={idsParam}");
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("Khong resolve duoc user tu Identity Service, status {Status}", resp.StatusCode);
                return [];
            }

            var users = await resp.Content.ReadFromJsonAsync<List<UserPublicInfo>>() ?? [];
            return users.ToDictionary(u => u.Id);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Identity Service de resolve user");
            return [];
        }
    }

    public async Task<UserPublicInfo?> ResolveUserAsync(long userId)
    {
        var result = await ResolveUsersAsync([userId]);
        return result.GetValueOrDefault(userId);
    }
}
