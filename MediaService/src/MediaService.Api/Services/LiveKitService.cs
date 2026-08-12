using Livekit.Server.Sdk.Dotnet;

namespace MediaService.Api.Services;

public class LiveKitOptions
{
    // URL Server API (http/https) - KHAC voi URL websocket client dung de
    // ket noi phong (thuong la wss://.../ nhung LiveKit dung chung 1 port
    // http cho ca 2 - client SDK tu quyet dinh scheme ws/wss).
    public string ServerUrl { get; set; } = "http://localhost:7880";

    // URL client SDK dung de ket noi phong (ws://.../wss://...) - tra ve
    // trong JoinResult de client tu ket noi, KHAC voi ServerUrl (dung noi
    // bo cho RoomServiceClient goi Server API).
    public string ClientUrl { get; set; } = "ws://localhost:7880";
    public string ApiKey { get; set; } = string.Empty;
    public string ApiSecret { get; set; } = string.Empty;
}

// Boc RoomServiceClient + AccessToken cua Livekit.Server.Sdk.Dotnet - dung
// theo muc 7.1 "Ha tang: LiveKit Service + TURN Service". STUN dung server
// cua Google (mien phi, khong gioi han) cau hinh o phia LiveKit server
// (Tainguyen/infra/livekit-values.yaml, rtc.stun_servers) - Media Service
// khong can biet gi ve STUN, chi can token + server URL.
public class LiveKitService
{
    private readonly LiveKitOptions _options;
    private readonly RoomServiceClient _roomService;

    public LiveKitService(LiveKitOptions options)
    {
        _options = options;
        _roomService = new RoomServiceClient(options.ServerUrl, options.ApiKey, options.ApiSecret);
    }

    // Ten phong LiveKit = "meeting-{id}" - on dinh, du de map nguoc lai
    // meeting trong Media DB khi can (vd webhook trong tuong lai).
    public static string RoomName(long meetingId) => $"meeting-{meetingId}";

    public string ClientUrl => _options.ClientUrl;

    public Task CreateRoomAsync(long meetingId, int maxParticipants) =>
        _roomService.CreateRoom(new CreateRoomRequest
        {
            Name = RoomName(meetingId),
            MaxParticipants = (uint)maxParticipants,
            EmptyTimeout = 300, // tu dong don phong ben LiveKit neu khong ai vao trong 5 phut sau khi tao
        });

    // LiveKit TU XOA phong rong sau EmptyTimeout (5 phut, xem CreateRoom).
    // Dung dieu do lam NGUON SU THAT cho cau hoi "cuoc hop con song khong",
    // thay vi tin vao left_at trong DB: left_at chi duoc set khi nguoi dung
    // bam "Roi phong" tu te, con dong tab/mat mang thi khong.
    // Fail-OPEN: LiveKit tra loi/khong goi duoc thi coi nhu phong VAN CON -
    // mot su co tam thoi cua LiveKit khong duoc phep di ket thuc cuoc hop
    // that cua nguoi dung.
    public async Task<bool> RoomExistsAsync(long meetingId)
    {
        try
        {
            var resp = await _roomService.ListRooms(new ListRoomsRequest { Names = { RoomName(meetingId) } });
            return resp.Rooms.Count > 0;
        }
        catch (Exception)
        {
            return true;
        }
    }

    public Task DeleteRoomAsync(long meetingId) =>
        _roomService.DeleteRoom(new DeleteRoomRequest { Room = RoomName(meetingId) });

    public Task RemoveParticipantAsync(long meetingId, long userId) =>
        _roomService.RemoveParticipant(new RoomParticipantIdentity
        {
            Room = RoomName(meetingId),
            Identity = userId.ToString(),
        });

    // identity = userId (dang string) de cac endpoint dieu khien phong
    // (kick, mute...) map thang duoc ve user_id trong DB, khong can lookup
    // them. name = nickname hien thi trong phong.
    public string GenerateAccessToken(long meetingId, long userId, string nickname, string? email, TimeSpan ttl)
    {
        var identity = new Dictionary<string, string> { ["userId"] = userId.ToString() };
        if (email is not null)
            identity["email"] = email;

        var token = new AccessToken(_options.ApiKey, _options.ApiSecret)
            .WithIdentity(userId.ToString())
            .WithName(nickname)
            .WithGrants(new VideoGrants { RoomJoin = true, Room = RoomName(meetingId) })
            .WithAttributes(identity)
            .WithTtl(ttl);

        return token.ToJwt();
    }
}
