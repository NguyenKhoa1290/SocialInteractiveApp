namespace MediaService.Api.Models;

public enum PermissionType
{
    ShareScreen,
    MiniApp,
    FocusMode,
}

public class MeetingPermission
{
    public long Id { get; set; }
    public long MeetingId { get; set; }
    public long UserId { get; set; }
    public PermissionType PermissionType { get; set; }
    public long GrantedBy { get; set; }
    public DateTimeOffset GrantedAt { get; set; }

    public static PermissionType FromString(string s) => s switch
    {
        "share_screen" => PermissionType.ShareScreen,
        "mini_app" => PermissionType.MiniApp,
        "focus_mode" => PermissionType.FocusMode,
        _ => throw new ArgumentException($"Gia tri permission_type khong hop le: {s}"),
    };

    public static string ToStringValue(PermissionType p) => p switch
    {
        PermissionType.ShareScreen => "share_screen",
        PermissionType.MiniApp => "mini_app",
        PermissionType.FocusMode => "focus_mode",
        _ => throw new ArgumentOutOfRangeException(nameof(p)),
    };
}
