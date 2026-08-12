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

    // Yeu cau nap dung luong - tu thiet ke theo yeu cau nguoi dung du an:
    // Truong nhom gui yeu cau (Chat Service, API public), Admin duyet/tu
    // choi qua day (Chat Service, "cua sau" noi bo).
    public async Task<List<TopupRequestInfo>> ListPendingTopupRequestsAsync()
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/storage-topup-requests?status=pending");
            if (!resp.IsSuccessStatusCode)
                return [];
            return await resp.Content.ReadFromJsonAsync<List<TopupRequestInfo>>() ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Chat Service de liet ke yeu cau nap dung luong");
            return [];
        }
    }

    public async Task<bool> ApproveTopupRequestAsync(long requestId, long adminUserId)
    {
        var resp = await httpClient.PostAsync($"{options.BaseUrl}/internal/storage-topup-requests/{requestId}/approve?adminUserId={adminUserId}", null);
        return resp.IsSuccessStatusCode;
    }

    public async Task<bool> RejectTopupRequestAsync(long requestId, long adminUserId)
    {
        var resp = await httpClient.PostAsync($"{options.BaseUrl}/internal/storage-topup-requests/{requestId}/reject?adminUserId={adminUserId}", null);
        return resp.IsSuccessStatusCode;
    }
}

public record TopupRequestInfo(long Id, long ConversationId, long RequestedBy, decimal Amount, string Status, DateTimeOffset CreatedAt);
