namespace ChatService.Api.Services;

public class MediaServiceClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5300";
}

public record MeetingMembership(bool IsParticipant, long? ConversationId, string Status);

// Goi sang Media Service qua /internal/* (khong qua API Gateway public).
//
// Chi dung cho luong THAO LUAN cua cuoc hop: khach vang lai vao hop bang
// link KHONG thuoc workspace nao, nen kiem tra thanh vien san co cua Chat
// Service khong phu duoc - phai hoi Media Service xem ho co dang thuc su o
// trong cuoc hop do khong.
public class MediaServiceClient(HttpClient httpClient, MediaServiceClientOptions options, ILogger<MediaServiceClient> logger)
{
    // Fail-CLOSED: khong hoi duoc Media Service thi tra null va noi goi phai
    // coi nhu KHONG co quyen. Day la kiem tra quyen truy cap, mot su co mang
    // khong duoc phep bien thanh "cho qua".
    public async Task<MeetingMembership?> GetMembershipAsync(long meetingId, long userId)
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/meetings/{meetingId}/membership/{userId}");
            if (!resp.IsSuccessStatusCode)
                return null;
            return await resp.Content.ReadFromJsonAsync<MeetingMembership>();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi Media Service de kiem tra thanh vien cuoc hop {MeetingId}", meetingId);
            return null;
        }
    }
}
