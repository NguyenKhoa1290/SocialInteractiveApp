namespace AdminService.Api.Services;

public class SpamTrackingClientOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5160";
}

public record SpamViolation(long UserId, string Nickname, DateTimeOffset DetectedAt, string Reason, string AccountStatus);
public record PaginatedViolations(List<SpamViolation> Items, int Total);

// Goi sang SpamTrackingService qua /internal/violations (khong qua API
// Gateway public). Xem SpamTrackingService.Api/Endpoints/ViolationEndpoints.cs.
public class SpamTrackingClient(HttpClient httpClient, SpamTrackingClientOptions options, ILogger<SpamTrackingClient> logger)
{
    public async Task<PaginatedViolations> ListViolationsAsync(int page, int pageSize)
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/violations?page={page}&pageSize={pageSize}");
            if (!resp.IsSuccessStatusCode)
                return new PaginatedViolations([], 0);
            return await resp.Content.ReadFromJsonAsync<PaginatedViolations>() ?? new PaginatedViolations([], 0);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi SpamTrackingService de liet ke vi pham");
            return new PaginatedViolations([], 0);
        }
    }

    public async Task<List<SpamViolation>> GetViolationsForUserAsync(long userId)
    {
        try
        {
            var resp = await httpClient.GetAsync($"{options.BaseUrl}/internal/violations/{userId}");
            if (!resp.IsSuccessStatusCode)
                return [];
            return await resp.Content.ReadFromJsonAsync<List<SpamViolation>>() ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Loi goi SpamTrackingService de lay vi pham cua user {UserId}", userId);
            return [];
        }
    }
}
