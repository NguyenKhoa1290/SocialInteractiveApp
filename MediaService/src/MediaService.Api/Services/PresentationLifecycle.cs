using System.Collections.Concurrent;
using System.Text.Json;
using Livekit.Server.Sdk.Dotnet;

namespace MediaService.Api.Services;

// Dung chung cho roi phong, kick va doi chieu LiveKit. Redis la nguon su
// that; metadata chi la kenh phat, nen moi lan ghi phai doc trang thai moi.
public class PresentationLifecycle(
    PresentationStore store, LiveKitService liveKit,
    TimeProvider clock, ILogger<PresentationLifecycle> logger)
{
    private static readonly TimeSpan ScreenMissingGrace = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan OwnerMissingGrace = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ScreenStartGrace = TimeSpan.FromMinutes(2);
    private readonly ConcurrentDictionary<long, (PresentationState State, DateTimeOffset Since)> _missing = new();
    private readonly ConcurrentDictionary<long, DateTimeOffset> _screensSeen = new();
    private readonly SemaphoreSlim[] _metadataLocks = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1)).ToArray();
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public async Task ReleaseAsync(long meetingId, long userId)
    {
        var current = await store.GetAsync(meetingId);
        if (current?.UserId == userId && await store.ClearIfCurrentAsync(meetingId, current))
        {
            _missing.TryRemove(meetingId, out _);
            _screensSeen.TryRemove(meetingId, out _);
            await PublishMetadataAsync(meetingId);
        }
    }

    public async Task ReconcileAsync(long meetingId, IReadOnlyCollection<ParticipantInfo>? participants)
    {
        // Khong goi duoc SFU khac voi khong con nguoi chia se.
        if (participants is null) return;
        var current = await store.GetAsync(meetingId);
        if (current is null)
        {
            _missing.TryRemove(meetingId, out _);
            _screensSeen.TryRemove(meetingId, out _);
            return;
        }

        var owner = participants.FirstOrDefault(p => p.Identity == current.UserId.ToString());
        var now = clock.GetUtcNow();
        var hasScreen = owner?.Tracks.Any(t => t.Source == TrackSource.ScreenShare) == true;
        if (current.Kind == "screen" && hasScreen)
            _screensSeen[meetingId] = current.StartedAt;
        // Chi cho hop chon man hinh thoi gian khoi tao. Khi da thay track
        // phat roi, mat track phai duoc don sau 10s, ke ca trong 2 phut dau.
        var waitingForFirstScreen = now - current.StartedAt < ScreenStartGrace &&
            (!_screensSeen.TryGetValue(meetingId, out var seen) || seen != current.StartedAt);
        var healthy = owner is not null && (current.Kind != "screen" ||
            hasScreen || waitingForFirstScreen);
        if (healthy)
        {
            _missing.TryRemove(meetingId, out _);
            return;
        }

        // Cho F5/noi lai mang; khong bo luot chi vi mot lan thieu track.
        var missing = _missing.AddOrUpdate(meetingId, (current, now),
            (_, previous) => previous.State == current ? previous : (current, now));
        var grace = current.Kind == "screen" ? ScreenMissingGrace : OwnerMissingGrace;
        if (now - missing.Since < grace) return;
        if (await store.ClearIfCurrentAsync(meetingId, current))
        {
            _missing.TryRemove(meetingId, out _);
            _screensSeen.TryRemove(meetingId, out _);
            await PublishMetadataAsync(meetingId);
            logger.LogInformation("Da don luot trinh bay khong con nguon phat cua cuoc hop {MeetingId}", meetingId);
        }
    }

    public async Task PublishMetadataAsync(long meetingId)
    {
        // Ghi noi tiep de mot request bat dau cu khong den sau request dung.
        // So khoa co dinh, khong giu mot semaphore cho moi cuoc hop tung tao.
        var gate = _metadataLocks[(int)((ulong)meetingId % (ulong)_metadataLocks.Length)];
        await gate.WaitAsync();
        try
        {
            var current = await store.GetAsync(meetingId);
            await liveKit.SetRoomMetadataAsync(meetingId,
                JsonSerializer.Serialize(new RoomMetadata(current), JsonOpts));
        }
        catch (Exception ex)
        {
            // Frontend poll lai Redis neu duong metadata tam thoi loi.
            logger.LogWarning(ex, "Khong dong bo duoc metadata trinh bay cua cuoc hop {MeetingId}", meetingId);
        }
        finally { gate.Release(); }
    }
}
