namespace MediaService.Api.Services;

public class IdentityClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5194";
}

public record UserPublicInfo(long Id, string Nickname, string UserType);

// Email khong nam trong UserPublicInfo (chi co trong JWT claim nickname,
// khong co email) - dung endpoint admin-detail co san (xay cho Admin
// Service, Phase 4) de lay email khi can chia se dinh danh day du cho
// user da dang nhap (UC theo muc 7.1 "Chia se dinh danh").
public record UserAdminDetail(long Id, string UserType, string Nickname, string? Email);

// Goi sang Identity Service qua /internal/* (khong qua API Gateway public) -
// cung quy uoc voi WorkSpace/Chat/SpamTracking/Admin Service.
public class IdentityClient(HttpClient httpClient, IdentityClientOptions options, ILogger<IdentityClient> logger)
{
    public async Task<UserPublicInfo?> ResolveUserAsync(long userId)
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/users/{userId}");
            return resp.IsSuccessStatusCode ? await resp.Content.ReadFromJsonAsync<UserPublicInfo>() : null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Identity Service de resolve user {UserId}", userId);
            return null;
        }
    }

    public async Task<UserAdminDetail?> ResolveUserDetailAsync(long userId)
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/users/{userId}/admin-detail");
            return resp.IsSuccessStatusCode ? await resp.Content.ReadFromJsonAsync<UserAdminDetail>() : null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Identity Service de lay chi tiet user {UserId}", userId);
            return null;
        }
    }

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
                return [];

            var users = await resp.Content.ReadFromJsonAsync<List<UserPublicInfo>>() ?? [];
            return users.ToDictionary(u => u.Id);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Identity Service de resolve nhieu user");
            return [];
        }
    }
}
