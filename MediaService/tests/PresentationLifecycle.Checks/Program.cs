using Google.Protobuf;
using Livekit.Server.Sdk.Dotnet;
using MediaService.Api.Services;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Logging.Abstractions;
using StackExchange.Redis;

static void Check(bool result, string description)
{
    if (!result) throw new InvalidOperationException(description);
    Console.WriteLine($"PASS {description}");
}

// Redis that, SFU API gia lap: khong tao/xoa phong hop dang dung tren server.
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
await using var app = builder.Build();
var metadata = new List<string>();
TaskCompletionSource? entered = null, unblock = null;
app.MapPost("/twirp/livekit.RoomService/UpdateRoomMetadata", async (HttpContext ctx) =>
{
    using var buffer = new MemoryStream();
    await ctx.Request.Body.CopyToAsync(buffer);
    var json = ctx.Request.ContentType?.Contains("json") == true;
    var request = json
        ? JsonParser.Default.Parse<UpdateRoomMetadataRequest>(System.Text.Encoding.UTF8.GetString(buffer.ToArray()))
        : UpdateRoomMetadataRequest.Parser.ParseFrom(buffer.ToArray());
    if (entered is not null)
    {
        entered.TrySetResult();
        await unblock!.Task;
    }
    metadata.Add(request.Metadata);
    var response = new Room { Name = request.Room, Metadata = request.Metadata };
    return json ? Results.Text(JsonFormatter.Default.Format(response), "application/json")
        : Results.Bytes(response.ToByteArray(), "application/protobuf");
});
await app.StartAsync();
var address = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>()
    .Features.Get<IServerAddressesFeature>()!.Addresses.Single();
using var redis = await ConnectionMultiplexer.ConnectAsync(
    Environment.GetEnvironmentVariable("PRESENTATION_CHECK_REDIS") ?? "127.0.0.1:6379");
var store = new PresentationStore(redis);
var liveKit = new LiveKitService(new LiveKitOptions { ServerUrl = address, ApiKey = "test-key", ApiSecret = new string('x', 32) });
var clock = new TestClock();
var lifecycle = new PresentationLifecycle(store, liveKit, clock, NullLogger<PresentationLifecycle>.Instance);
var meetingId = Random.Shared.NextInt64(1_000_000_000, 2_000_000_000);
var initial = new PresentationState(11, "Presenter", "screen", null, clock.GetUtcNow() - TimeSpan.FromMinutes(5));
var owner = new ParticipantInfo { Identity = "11" };
owner.Tracks.Add(new TrackInfo { Source = TrackSource.ScreenShare });
var remaining = new ParticipantInfo { Identity = "22" };

try
{
    await store.TryClaimAsync(meetingId, initial);
    await lifecycle.ReleaseAsync(meetingId, 22);
    Check(await store.GetAsync(meetingId) == initial, "Leaving viewer preserves another participant's presentation");
    await lifecycle.ReleaseAsync(meetingId, 11);
    Check(await store.GetAsync(meetingId) is null, "Leaving/kicked presenter releases the slot immediately");
    Check(metadata.Last().Contains("\"presentation\":null"), "Released slot is broadcast as empty room metadata");
    await lifecycle.ReleaseAsync(meetingId, 11);
    Check(await store.TryClaimAsync(meetingId, initial with { UserId = 22 }) is null, "Another participant can present after cleanup");
    await store.ClearAsync(meetingId);

    await store.TryClaimAsync(meetingId, initial);
    await lifecycle.ReconcileAsync(meetingId, [remaining]);
    clock.Advance(TimeSpan.FromSeconds(9));
    await lifecycle.ReconcileAsync(meetingId, [remaining]);
    Check(await store.GetAsync(meetingId) is not null, "Temporary disconnect preserves the slot during grace");
    await lifecycle.ReconcileAsync(meetingId, [owner, remaining]);
    clock.Advance(TimeSpan.FromSeconds(5));
    await lifecycle.ReconcileAsync(meetingId, [remaining]);
    Check(await store.GetAsync(meetingId) is not null, "Reconnect resets the missing-source timer");
    clock.Advance(TimeSpan.FromSeconds(10));
    await lifecycle.ReconcileAsync(meetingId, null);
    Check(await store.GetAsync(meetingId) is not null, "SFU API failure does not delete presentation state");
    await lifecycle.ReconcileAsync(meetingId, [remaining]);
    Check(await store.GetAsync(meetingId) is null, "Screen slot is cleaned after 10 seconds of observed absence");

    var fresh = initial with { StartedAt = clock.GetUtcNow() };
    owner.Tracks.Clear();
    await store.TryClaimAsync(meetingId, fresh);
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    clock.Advance(TimeSpan.FromSeconds(90));
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    Check(await store.GetAsync(meetingId) is not null, "Screen picker has time to publish the first track");
    clock.Advance(TimeSpan.FromSeconds(31));
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    clock.Advance(TimeSpan.FromSeconds(10));
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    Check(await store.GetAsync(meetingId) is null, "Missing screen publication is cleaned even when its owner remains connected");

    fresh = initial with { StartedAt = clock.GetUtcNow() };
    await store.TryClaimAsync(meetingId, fresh);
    owner.Tracks.Add(new TrackInfo { Source = TrackSource.ScreenShare });
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    owner.Tracks.Clear();
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    clock.Advance(TimeSpan.FromSeconds(9));
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    Check(await store.GetAsync(meetingId) is not null, "Short screen interruption preserves the slot");
    clock.Advance(TimeSpan.FromSeconds(1));
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    Check(await store.GetAsync(meetingId) is null, "Previously published screen is cleaned at 10 seconds, including during startup grace");

    var miniApp = initial with { Kind = "mini_app", StartedAt = clock.GetUtcNow() };
    await store.TryClaimAsync(meetingId, miniApp);
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    clock.Advance(TimeSpan.FromMinutes(5));
    await lifecycle.ReconcileAsync(meetingId, [owner]);
    Check(await store.GetAsync(meetingId) == miniApp, "Mini app does not require a screen video track");
    Check(!await store.ClearIfCurrentAsync(meetingId, initial), "Delayed cleanup cannot remove a newer presentation");

    await lifecycle.ReconcileAsync(meetingId, [remaining]);
    clock.Advance(TimeSpan.FromSeconds(10));
    await lifecycle.ReconcileAsync(meetingId, [remaining]);
    Check(await store.GetAsync(meetingId) == miniApp, "Mini app owner absence still has a 60-second grace");
    await lifecycle.ReconcileAsync(meetingId, [owner]);

    entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
    unblock = new(TaskCreationOptions.RunContinuationsAsynchronously);
    var oldPublish = lifecycle.PublishMetadataAsync(meetingId);
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    var release = lifecycle.ReleaseAsync(meetingId, 11);
    unblock.TrySetResult();
    await Task.WhenAll(oldPublish, release);
    Check(metadata.Last().Contains("\"presentation\":null"), "Delayed start metadata cannot restore a stopped presentation");
}
finally
{
    await store.ClearAsync(meetingId);
    await app.StopAsync();
}

sealed class TestClock : TimeProvider
{
    private DateTimeOffset _now = DateTimeOffset.UtcNow;
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan duration) => _now += duration;
}
