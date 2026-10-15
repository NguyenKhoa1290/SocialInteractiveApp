namespace MediaService.Api.Services;

public record MeetingServerOption(string Id, string Name, bool Available, string? Reason);
public record MeetingServerRejection(string Error, string Message, int StatusCode);

// Public hosting is retired. Home hosting must be explicitly enabled after
// both signaling and media connectivity have been verified by the operator.
public class MeetingServerPolicy(IConfiguration configuration)
{
    public bool HomeAvailable => configuration.GetValue<bool>("LiveKit:HomeEnabled");

    public MeetingServerOption[] GetServers() =>
    [
        new("public", "Server công khai", false, "VPS đã hết hạn"),
        new("home", "Server nhà", HomeAvailable,
            HomeAvailable ? null : "Server nhà chưa sẵn sàng. Vui lòng thử lại sau."),
    ];

    public MeetingServerRejection? ValidateSelection(string? server) => (server ?? "home") switch
    {
        "public" => new("server_unavailable", "Server công khai đã khóa do VPS hết hạn.", 503),
        "home" when !HomeAvailable => new("server_unavailable", "Server nhà chưa sẵn sàng. Vui lòng thử lại sau.", 503),
        "home" => null,
        _ => new("invalid_server", "Server cuộc họp không hợp lệ.", 400),
    };
}
