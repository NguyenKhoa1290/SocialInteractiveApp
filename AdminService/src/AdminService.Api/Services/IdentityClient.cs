namespace AdminService.Api.Services;

public class IdentityClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5194";
}

public record AdminUserInfo(
    long Id, string UserType, string Nickname, string? Email, string Status,
    bool IsAdmin, DateTimeOffset CreatedAt, DateTimeOffset LastActiveAt);

public record PaginatedAdminUsers(List<AdminUserInfo> Items, int Total, int Page, int PageSize);

// Goi sang Identity Service qua /internal/* (khong qua API Gateway public).
// Xem IdentityService.Api/Endpoints/InternalEndpoints.cs cho phia con lai.
public class IdentityClient(HttpClient httpClient, IdentityClientOptions options, ILogger<IdentityClient> logger)
{
    public async Task<PaginatedAdminUsers?> ListUsersAsync(int page, int pageSize, string? search)
    {
        var url = $"{options.BaseUrl}/internal/users/admin-list?page={page}&pageSize={pageSize}";
        if (!string.IsNullOrWhiteSpace(search))
            url += $"&search={Uri.EscapeDataString(search)}";

        var resp = await httpClient.GetAsync(url);
        if (!resp.IsSuccessStatusCode)
        {
            logger.LogWarning("Identity Service khong phan hoi khi liet ke user, status {Status}", resp.StatusCode);
            return null;
        }
        return await resp.Content.ReadFromJsonAsync<PaginatedAdminUsers>();
    }

    public async Task<AdminUserInfo?> GetUserAsync(long userId)
    {
        var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/users/{userId}/admin-detail");
        return resp.IsSuccessStatusCode ? await resp.Content.ReadFromJsonAsync<AdminUserInfo>() : null;
    }

    public async Task<bool> UnlockUserAsync(long userId)
    {
        var resp = await httpClient.PostAsync($"{options.BaseUrl}/internal/users/{userId}/unlock", null);
        return resp.IsSuccessStatusCode;
    }
}
