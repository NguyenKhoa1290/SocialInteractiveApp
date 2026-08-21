using System.Text;
using System.Text.Json;
using RabbitMQ.Client;

namespace MediaService.Api.Services;

public class RabbitMqOptions
{
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string Username { get; set; } = "guest";
    public string Password { get; set; } = "guest";
    public string MeetingInviteQueue { get; set; } = "media.meeting-invite";
    public string MeetingCreatedQueue { get; set; } = "media.meeting-created";
}

// InviterNickname do BEN NAY dien san (doc tu claim trong JWT) de Identity
// Service khong phai goi nguoc lai chi de lay mot cai ten.
public record MeetingInviteMessage(long MeetingId, long InvitedUserId, long InvitedBy, string InviteToken, string? InviterNickname);

// RecipientUserIds do Chat Service tinh san (Media khong co ban sao thanh
// vien nhom) va DA loai nguoi dang mo san man hinh chat do - xem
// /internal/conversations/{id}/notify-recipients.
public record MeetingCreatedMessage(long MeetingId, long HostId, long ConversationId, string? HostNickname, List<long> RecipientUserIds);

// UC-32: publish thong bao moi hop -> Identity Service, noi dong vai tro dau
// moi notification cua ca he thong (roadmap muc 1 va bang Publisher ->
// Consumer muc 8.1). Identity luu thong bao roi day tiep xuong nguoi duoc moi
// qua WebSocket - xem NotificationConsumerService.cs ben do.
//
// Hai hang doi, hai doi tuong nhan khac han nhau:
//   media.meeting-invite  -> moi TRUC TIEP mot nguoi ban (UC-32)
//   media.meeting-created -> bao cho CA NHOM khi mo hop trong nhom (UC-31)
//
// Hang doi thu hai tung bi bo di voi ly do "nhom da co tin nhan he thong
// roi". Ly do do KHONG dung: tin nhan trong nhom chi toi duoc nguoi DANG MO
// nhom do, ai dang o man hinh khac thi khong biet gi ca. Nen no quay lai,
// nhung lan nay nguoi dang mo san phong chat bi loai khoi danh sach nhan
// (ho da thay the "Cuoc hop dang dien ra" truoc mat) - khong bao trung.
public class MeetingInviteNotificationPublisher : IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<MeetingInviteNotificationPublisher> _logger;
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public MeetingInviteNotificationPublisher(RabbitMqOptions options, ILogger<MeetingInviteNotificationPublisher> logger)
    {
        _options = options;
        _logger = logger;
    }

    private async Task<IChannel> EnsureChannelAsync()
    {
        if (_channel is { IsOpen: true })
            return _channel;

        await _initLock.WaitAsync();
        try
        {
            if (_channel is { IsOpen: true })
                return _channel;

            var factory = new ConnectionFactory
            {
                HostName = _options.HostName,
                Port = _options.Port,
                UserName = _options.Username,
                Password = _options.Password,
                AutomaticRecoveryEnabled = true,
                NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
            };

            _connection = await factory.CreateConnectionAsync();
            _channel = await _connection.CreateChannelAsync();
            await _channel.QueueDeclareAsync(_options.MeetingInviteQueue, durable: true, exclusive: false, autoDelete: false);
            await _channel.QueueDeclareAsync(_options.MeetingCreatedQueue, durable: true, exclusive: false, autoDelete: false);
            return _channel;
        }
        finally
        {
            _initLock.Release();
        }
    }

    // Nuot loi co chu y: loi moi da duoc luu vao CSDL va inviteToken da tra ve
    // cho nguoi goi roi. RabbitMQ hong thi cung khong duoc phep lam hong ca
    // thao tac moi - cung nhat la nguoi duoc moi khong thay chuong bao, con
    // link van dung.
    public async Task PublishAsync(long meetingId, long invitedUserId, long invitedBy, string inviteToken, string? inviterNickname)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new MeetingInviteMessage(meetingId, invitedUserId, invitedBy, inviteToken, inviterNickname)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.MeetingInviteQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc thong bao moi hop {MeetingId} toi user {InvitedUserId}", meetingId, invitedUserId);
        }
    }

    // UC-31 buoc 4. Chi goi khi mode=in_chat: cuoc hop doc lap (standalone)
    // khong gan voi nhom nao thi khong co ai de bao.
    public async Task PublishMeetingCreatedAsync(long meetingId, long hostId, long conversationId, string? hostNickname, List<long> recipientUserIds)
    {
        if (recipientUserIds.Count == 0)
            return;

        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new MeetingCreatedMessage(meetingId, hostId, conversationId, hostNickname, recipientUserIds)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.MeetingCreatedQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc thong bao mo cuoc hop {MeetingId}", meetingId);
        }
    }

    public async ValueTask DisposeAsync()
    {
        try { if (_channel is not null) await _channel.CloseAsync(); } catch { }
        try { if (_connection is not null) await _connection.CloseAsync(); } catch { }
        GC.SuppressFinalize(this);
    }
}
