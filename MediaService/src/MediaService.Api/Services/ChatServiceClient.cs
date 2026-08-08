namespace MediaService.Api.Services;

public class ChatServiceClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5261";
}

// Goi sang Chat Service qua /internal/* (khong qua API Gateway public) -
// dung khi mo hop voi mode=in_chat (UC-31) de tao tin nhan he thong trong
// luong chat cua group.
public class ChatServiceClient(HttpClient httpClient, ChatServiceClientOptions options, ILogger<ChatServiceClient> logger)
{
    public async Task PostSystemMessageAsync(long conversationId, string content)
    {
        try
        {
            var resp = await httpClient.PostAsJsonAsync(
                $"{options.BaseUrl}/internal/conversations/{conversationId}/system-message",
                new { content });
            if (!resp.IsSuccessStatusCode)
                logger.LogWarning("Khong tao duoc tin nhan he thong cho conversation {ConversationId}, status {Status}", conversationId, resp.StatusCode);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Chat Service de tao tin nhan he thong");
        }
    }
}
