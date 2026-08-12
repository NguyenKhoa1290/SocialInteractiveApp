namespace ChatService.Api.Services;

public class IdentityClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5194";
}

public record UserPublicInfo(long Id, string Nickname, string UserType);

// Goi sang Identity Service qua /internal/* - cung quy uoc voi WorkSpace/
// Media/SpamTracking/Admin Service.
//
// Chat Service truoc day KHONG can client nay: ten nguoi gui trong chat nhom
// duoc lay tu danh sach thanh vien workspace (WorkspaceClient). Nhung luong
// THAO LUAN cua cuoc hop co ca khach vang lai - ho khong thuoc workspace nao
// nen khong tra ra ten duoc bang cach do, phai hoi thang Identity Service.
public class IdentityClient(HttpClient httpClient, IdentityClientOptions options, ILogger<IdentityClient> logger)
{
    public async Task<Dictionary<long, UserPublicInfo>> ResolveUsersAsync(IEnumerable<long> userIds)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
            return [];

        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/users?ids={string.Join(',', ids)}");
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
