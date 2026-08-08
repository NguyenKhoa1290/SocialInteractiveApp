namespace SpamTrackingService.Api.Services;

public class IdentityClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5194";
}

public record UserPublicInfo(long Id, string Nickname, string UserType);

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
}
