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

    // Ai can duoc bao khi mo cuoc hop trong nhom. Chat Service tra ve danh
    // sach DA LOC (bo host, bo nguoi dang mo san man hinh chat do) - Media
    // khong co du lieu de tu lam viec do.
    //
    // Tra danh sach RONG khi hoi khong duoc: thieu mot thong bao con hon
    // chan luon viec mo cuoc hop.
    public async Task<List<long>> GetNotifyRecipientsAsync(long conversationId, long excludeUserId)
    {
        try
        {
            var resp = await httpClient.GetAsync(
                $"{options.BaseUrl}/internal/conversations/{conversationId}/notify-recipients?exclude={excludeUserId}");
            if (!resp.IsSuccessStatusCode)
                return [];
            var result = await resp.Content.ReadFromJsonAsync<NotifyRecipients>();
            return result?.UserIds ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi hoi Chat Service danh sach nguoi nhan thong bao cho hoi thoai {ConversationId}", conversationId);
            return [];
        }
    }

    // Dung cho cuoc hop mode=in_chat: CA NHOM vao thang duoc, khong can link
    // moi. Media Service khong co ban sao workspace_members nen phai hoi
    // Chat Service (xem InternalEndpoints.cs ben Chat Service).
    // Tra null khi khong hoi duoc - noi goi phai coi nhu KHONG phai thanh
    // vien (fail-closed), khong duoc mac dinh cho vao.
    public async Task<ConversationMembership?> GetMembershipAsync(long conversationId, long userId)
    {
        try
        {
            var resp = await httpClient.GetAsync(
                $"{options.BaseUrl}/internal/conversations/{conversationId}/members/{userId}");
            if (!resp.IsSuccessStatusCode)
                return null;
            return await resp.Content.ReadFromJsonAsync<ConversationMembership>();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Chat Service de kiem tra thanh vien hoi thoai {ConversationId}", conversationId);
            return null;
        }
    }
}

public record ConversationMembership(bool IsMember, bool IsLeader);

public record NotifyRecipients(List<long> UserIds);
