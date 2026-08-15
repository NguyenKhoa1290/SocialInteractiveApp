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

public record MeetingInviteMessage(long MeetingId, long InvitedUserId, long InvitedBy, string InviteToken);

// UC-31 buoc 4 "Publish su kien TAO PHONG qua RabbitMQ -> Identity Services
// -> day push notification". Hang doi RIENG voi meeting-invite vi doi tuong
// nhan khac han nhau: moi truc tiep la gui cho DUNG 1 nguoi da chon, con
// tao phong la su kien can bao cho CA NHOM cua hoi thoai.
//
// Media Service khong biet nhom co nhung ai (khong co ban sao
// workspace_members) nen chi gui kem ConversationId - ben consumer tu tra
// ra danh sach nguoi nhan. ConversationId = null nghia la cuoc hop doc lap
// (mode=standalone), khong co nhom nao de bao.
public record MeetingCreatedMessage(long MeetingId, long HostId, long? ConversationId, DateTimeOffset CreatedAt);

// Publish thong bao moi hop qua RabbitMQ (UC-32, tich hop trong OpenAPI
// spec muc 7.4). Giong pattern MemberNotificationPublisher cua WorkSpace
// Service: publish truoc, CHUA co consumer ben Identity Service (chua co
// UI/co che push-notification chung cho toan he thong) - chuan bi san hang
// doi de dung sau, khong chan luong nghiep vu chinh neu RabbitMQ loi.
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

    public async Task PublishAsync(long meetingId, long invitedUserId, long invitedBy, string inviteToken)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new MeetingInviteMessage(meetingId, invitedUserId, invitedBy, inviteToken)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.MeetingInviteQueue, body: body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong publish duoc thong bao moi hop cho user {UserId}", invitedUserId);
        }
    }

    public async Task PublishMeetingCreatedAsync(long meetingId, long hostId, long? conversationId, DateTimeOffset createdAt)
    {
        try
        {
            var channel = await EnsureChannelAsync();
            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new MeetingCreatedMessage(meetingId, hostId, conversationId, createdAt)));
            await channel.BasicPublishAsync(exchange: "", routingKey: _options.MeetingCreatedQueue, body: body);
        }
        catch (Exception ex)
        {
            // Khong duoc lam hong viec mo cuoc hop chi vi RabbitMQ loi -
            // phong da tao xong roi, thong bao chi la viec phu.
            _logger.LogWarning(ex, "Khong publish duoc su kien tao phong hop {MeetingId}", meetingId);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel is not null) await _channel.CloseAsync();
        if (_connection is not null) await _connection.CloseAsync();
    }
}
