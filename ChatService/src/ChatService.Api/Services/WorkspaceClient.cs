namespace ChatService.Api.Services;

public class WorkspaceClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5153";
}

public record WorkspaceMemberInfo(long UserId, string Nickname, string Role);

// Goi sang WorkSpace Service de kiem tra thanh vien/vai tro khi thao tac
// tren conversation type='group' - Chat Service khong co ban sao du lieu
// workspace_members, luon hoi truc tiep (khong cache) de tranh du lieu cu.
public class WorkspaceClient(HttpClient httpClient, WorkspaceClientOptions options, ILogger<WorkspaceClient> logger)
{
    public async Task<List<WorkspaceMemberInfo>?> GetMembersAsync(long workspaceId)
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/workspaces/{workspaceId}/members");
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("Khong lay duoc danh sach thanh vien workspace {WorkspaceId}, status {Status}", workspaceId, resp.StatusCode);
                return null;
            }
            return await resp.Content.ReadFromJsonAsync<List<WorkspaceMemberInfo>>();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi WorkSpace Service de lay thanh vien workspace {WorkspaceId}", workspaceId);
            return null;
        }
    }

    public async Task<WorkspaceMemberInfo?> GetMemberAsync(long workspaceId, long userId)
    {
        var members = await GetMembersAsync(workspaceId);
        return members?.SingleOrDefault(m => m.UserId == userId);
    }
}
