namespace WorkspaceService.Api.Services;

public class ChatServiceClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5195";
}

// Goi sang Chat Service khi tao/xoa workspace - dam bao 1 group conversation
// luon di kem 1 workspace, va don du lieu chat khi workspace bi xoa/giai tan
// (conversations.workspace_id chi la lien ket logic, khac DB vat ly - xem
// UC-19 va tai lieu roadmap muc 5.1). 2 endpoint tuong ung dinh nghia phia
// ChatService.Api/Endpoints/InternalEndpoints.cs.
public class ChatServiceClient(HttpClient httpClient, ChatServiceClientOptions options, ILogger<ChatServiceClient> logger)
{
    public async Task NotifyWorkspaceCreatedAsync(long workspaceId)
    {
        try
        {
            var resp = await httpClient.PostAsJsonAsync($"{options.BaseUrl}/internal/conversations/group", new { workspaceId });
            if (!resp.IsSuccessStatusCode)
                logger.LogWarning("Chat Service tra ve {Status} khi tao group conversation cho workspace {WorkspaceId}", resp.StatusCode, workspaceId);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Khong goi duoc Chat Service de tao group conversation cho workspace {WorkspaceId}", workspaceId);
        }
    }

    public async Task NotifyWorkspaceDeletedAsync(long workspaceId)
    {
        try
        {
            var resp = await httpClient.DeleteAsync($"{options.BaseUrl}/internal/conversations/by-workspace/{workspaceId}");
            if (!resp.IsSuccessStatusCode)
                logger.LogWarning("Chat Service tra ve {Status} khi dep du lieu workspace {WorkspaceId}", resp.StatusCode, workspaceId);
        }
        catch (Exception ex)
        {
            // Khong chan request xoa workspace chinh chi vi Chat Service tam thoi
            // khong goi duoc - log canh bao, chap nhan du lieu mo coi tam thoi
            // (co the don don bang job rieng sau).
            logger.LogWarning(ex, "Khong goi duoc Chat Service de dep du lieu workspace {WorkspaceId}", workspaceId);
        }
    }
}
