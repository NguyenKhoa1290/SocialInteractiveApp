namespace AdminService.Api.Services;

public class ChatServiceClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5261";
}

public record ComplaintSummary(long UserId, DateTimeOffset LastMessageAt, DateTimeOffset ExpiresAt);
public record ComplaintMessage(string SenderRole, string Message, DateTimeOffset CreatedAt, long? SenderId = null);

// Goi sang Chat Service qua /internal/complaints (khong qua API Gateway
// public). Xem ChatService.Api/Endpoints/InternalEndpoints.cs.
public class ChatServiceClient(HttpClient httpClient, ChatServiceClientOptions options, ILogger<ChatServiceClient> logger)
{
    public async Task<List<ComplaintSummary>> ListComplaintsAsync()
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/complaints");
            if (!resp.IsSuccessStatusCode)
                return [];
            return await resp.Content.ReadFromJsonAsync<List<ComplaintSummary>>() ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Chat Service de liet ke khieu nai");
            return [];
        }
    }

    public async Task<List<ComplaintMessage>?> GetComplaintMessagesAsync(long userId)
    {
        var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/complaints/{userId}");
        return resp.IsSuccessStatusCode ? await resp.Content.ReadFromJsonAsync<List<ComplaintMessage>>() : null;
    }

    public async Task<ComplaintMessage?> ReplyComplaintAsync(long userId, string message)
    {
        var resp = await httpClient.PostAsJsonAsync($"{options.BaseUrl}/internal/complaints/{userId}/reply", new { message });
        return resp.IsSuccessStatusCode ? await resp.Content.ReadFromJsonAsync<ComplaintMessage>() : null;
    }
}
