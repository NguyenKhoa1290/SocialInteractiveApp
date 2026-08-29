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

    // Trang thai "ai dang trinh bay" duoc luu vao METADATA CUA PHONG ben
    // LiveKit, khong phai bang rieng trong Media DB. Ly do:
    //  - LiveKit TU broadcast RoomMetadataChanged cho moi nguoi dang trong
    //    phong, khong can Media Service co tang WebSocket rieng (van chua co).
    //  - Nguoi vao MUON doc duoc ngay tu `room.metadata` luc ket noi, khong
    //    can goi them API nao - khong bao gio bi lo mat trang thai.
    //  - Phong tan la metadata mat theo, khong de lai rac.
    public async Task<string?> GetRoomMetadataAsync(long meetingId)
    {
        try
        {
            var resp = await _roomService.ListRooms(new ListRoomsRequest { Names = { RoomName(meetingId) } });
            return resp.Rooms.Count > 0 ? resp.Rooms[0].Metadata : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public Task SetRoomMetadataAsync(long meetingId, string metadata) =>
        _roomService.UpdateRoomMetadata(new UpdateRoomMetadataRequest
        {
            Room = RoomName(meetingId),
            Metadata = metadata,
        });

    public Task DeleteRoomAsync(long meetingId) =>
        _roomService.DeleteRoom(new DeleteRoomRequest { Room = RoomName(meetingId) });

    // Hoi MOT LAN cho NHIEU cuoc hop: trong danh sach nay, phong nao ben
    // LiveKit con ton tai. Dung cho tien trinh quet dinh ky - hoi rieng tung
    // cai la moi vong quet ton dung bang so cuoc hop dang mo loi goi mang,
    // trong khi ListRooms nhan duoc nhieu ten cung luc.
    //
    // Tra ve null khi khong hoi duoc, y nghia la "khong biet" chu KHONG phai
    // "khong con phong nao" - ben goi phai bo qua ca vong quet. Nham cho nay
    // thi mot lan LiveKit tro chung se di ket thuc sach moi cuoc hop that.
    public async Task<HashSet<long>?> ListExistingRoomsAsync(IReadOnlyCollection<long> meetingIds)
    {
        if (meetingIds.Count == 0) return [];

        try
        {
            var req = new ListRoomsRequest();
            var byName = new Dictionary<string, long>();
            foreach (var id in meetingIds)
            {
                var name = RoomName(id);
                byName[name] = id;
                req.Names.Add(name);
            }

            var resp = await _roomService.ListRooms(req);
            var alive = new HashSet<long>();
            foreach (var room in resp.Rooms)
                if (byName.TryGetValue(room.Name, out var id))
                    alive.Add(id);
            return alive;
        }
        catch (Exception)
        {
            return null;
        }
    }

    // Ai DANG THUC SU ket noi trong phong. Khac han voi bang
    // meeting_participants: bang do chi biet nhung gi client tu khai bao
    // (bam nut "Roi phong"), con dong tab thi khong bao gi ca. LiveKit thi
    // QUAN SAT duoc, vi ket noi dut la no biet ngay.
    //
    // Tra ve null khi khong hoi duoc (LiveKit loi, hoac phong khong con) -
    // KHONG duoc lan lon voi "phong rong". Ben goi phai coi null la "khong
    // biet" va khong dam ket luan gi, neu khong mot su co tam thoi cua
    // LiveKit se quet sach danh sach nguoi trong mot cuoc hop that.
    public async Task<HashSet<long>?> ListParticipantIdsAsync(long meetingId)
    {
        try
        {
            var resp = await _roomService.ListParticipants(new ListParticipantsRequest { Room = RoomName(meetingId) });
            var ids = new HashSet<long>();
            foreach (var p in resp.Participants)
                if (long.TryParse(p.Identity, out var id))
                    ids.Add(id);
            return ids;
        }
        catch (Exception)
        {
            return null;
        }
    }

    // Chu phong thu quyen bat mic/camera cua mot nguoi.
    //
    // PHAI cuong che o LiveKit chu khong chi an nut ben Frontend: an nut chi
    // ngan nguoi dung binh thuong, ai mo Console goi thang SDK van publish
    // duoc. LiveKit tu choi track co source khong nam trong danh sach cho
    // phep, nen no la cho duy nhat chan duoc that.
    //
    // BAY: canPublishSources RONG co nghia la "cho phep TAT CA" chu khong
    // phai "cam tat ca". Nen luon phai liet ke tuong minh nhung nguon duoc
    // phep, khong bao gio de danh sach rong.
    public Task ApplyPublishPermissionsAsync(
        long meetingId, long userId, bool micAllowed, bool camAllowed, bool shareAllowed)
    {
        var permission = new ParticipantPermission
        {
            CanSubscribe = true,
            CanPublish = true,
            CanPublishData = true,
        };

        if (micAllowed) permission.CanPublishSources.Add(TrackSource.Microphone);
        if (camAllowed) permission.CanPublishSources.Add(TrackSource.Camera);
        // Man hinh chia se nay CUNG chan o day. Truoc kia no chi bi kiem o
        // tang API, tuc la an nut ben Frontend cong voi mot cau if o endpoint
        // "bat dau trinh bay" - ai goi thang SDK LiveKit van publish duoc mot
        // luong man hinh ma ca phong nhin thay. Tu khi "Cai dat phong" co muc
        // cho phep/cam chia se man hinh thi no la mot cai khoa that, phai
        // khoa o cho khoa duoc.
        if (shareAllowed)
        {
            permission.CanPublishSources.Add(TrackSource.ScreenShare);
            permission.CanPublishSources.Add(TrackSource.ScreenShareAudio);
        }

        return _roomService.UpdateParticipant(new UpdateParticipantRequest
        {
            Room = RoomName(meetingId),
            Identity = userId.ToString(),
            Permission = permission,
        });
    }

    // Doi quyen chi chan lan publish TIEP THEO - track dang phat van chay.
    // Nen phai tat thang track dang co, neu khong nguoi bi thu quyen van
    // dang noi cho ca phong nghe cho toi khi ho tu tat.
    public async Task MutePublishedAsync(long meetingId, long userId, bool muteMic, bool muteCam)
    {
        if (!muteMic && !muteCam) return;

        try
        {
            var info = await _roomService.GetParticipant(new RoomParticipantIdentity
            {
                Room = RoomName(meetingId),
                Identity = userId.ToString(),
            });

            foreach (var track in info.Tracks)
            {
                var hit = (muteMic && track.Source == TrackSource.Microphone)
                       || (muteCam && track.Source == TrackSource.Camera);
                if (!hit || track.Muted) continue;

                await _roomService.MutePublishedTrack(new MuteRoomTrackRequest
                {
                    Room = RoomName(meetingId),
                    Identity = userId.ToString(),
                    TrackSid = track.Sid,
                    Muted = true,
                });
            }
        }
        catch (Exception)
        {
            // Nguoi do co the vua roi phong - quyen da ghi trong DB roi, lan
            // vao sau se lay theo token moi.
        }
    }

    public Task RemoveParticipantAsync(long meetingId, long userId) =>
        _roomService.RemoveParticipant(new RoomParticipantIdentity
        {
            Room = RoomName(meetingId),
            Identity = userId.ToString(),
        });

    // identity = userId (dang string) de cac endpoint dieu khien phong
    // (kick, mute...) map thang duoc ve user_id trong DB, khong can lookup
    // them. name = nickname hien thi trong phong.
    public string GenerateAccessToken(
        long meetingId, long userId, string nickname, string? email, TimeSpan ttl,
        bool micAllowed = true, bool camAllowed = true, bool shareAllowed = true)
    {
        var identity = new Dictionary<string, string> { ["userId"] = userId.ToString() };
        if (email is not null)
            identity["email"] = email;

        // Quyen phat phai nam ngay trong TOKEN chu khong doi goi
        // UpdateParticipant sau khi ho vao phong: giua hai thoi diem do co
        // mot khe du rong de publish mic/cam mot lan.
        var sources = new List<string>();
        if (micAllowed) sources.Add("microphone");
        if (camAllowed) sources.Add("camera");
        if (shareAllowed)
        {
            sources.Add("screen_share");
            sources.Add("screen_share_audio");
        }

        var grants = new VideoGrants
        {
            RoomJoin = true,
            Room = RoomName(meetingId),
            CanPublish = true,
            CanSubscribe = true,
            CanPublishData = true,
            CanPublishSources = sources,
        };

        var token = new AccessToken(_options.ApiKey, _options.ApiSecret)
            .WithIdentity(userId.ToString())
            .WithName(nickname)
            .WithGrants(grants)
            .WithAttributes(identity)
            .WithTtl(ttl);

        return token.ToJwt();
    }
}
