namespace MediaService.Api.Models;

public enum PermissionType
{
    ShareScreen,
    MiniApp,
    FocusMode,

    // CHU Y - hai loai nay NGUOC nghia voi ba loai tren.
    //
    // share_screen / mini_app / focus_mode: CO hang = duoc phep. Mac dinh
    // khong ai co, chu phong cap them.
    //
    // no_mic / no_camera: CO hang = BI CAM. Mac dinh AI CUNG duoc bat mic va
    // camera - do la thu co ban nhat cua mot cuoc hop - nen thu quyen moi la
    // thao tac can ghi lai, khong phai cap quyen.
    //
    // Ghi chung mot bang vi GET /participants da tra ve mang permissions san
    // roi; tach bang rieng chi de Frontend phai goi them mot API nua.
    NoMic,
    NoCamera,

    // Them sau, khi "Cai dat phong" ra doi (Figma 140:645). Chia se man hinh
    // gio cung mac dinh CO (meetings.allow_screen_share) nen cam mot nguoi
    // moi la thao tac dang ghi - giong mic va camera. ShareScreen o tren van
    // giu de doc duoc du lieu cu, chi khong con duong nao ghi them.
    NoScreenShare,

    // DONG CHU PHONG. CO hang = duoc phep (cung nghia voi ba loai dau).
    //
    // Khac han moi loai tren o chuc nang: day khong phai mot tinh nang le ma
    // la TOAN BO quyen cua chu phong - duyet phong cho, duoi nguoi, cap/thu
    // quyen, ket thuc cuoc hop, sua cai dat phong. Ba viec chu phong THAT van
    // giu rieng: phong/thu chinh quyen nay, va khong ai duoi hay khoa mic
    // duoc chu phong that.
    //
    // Nam trong bang nay chu khong phai o meeting_participants.role vi hang
    // participant sinh moi moi lan vao phong - dong chu roi mang ra vao lai
    // se mat chuc. Hang permission thi song theo CA CUOC HOP.
    //
    // Cung la duong ke vi thu nhat khi chu phong roi di: xem HostSuccession.
    CoHost,
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
        "no_mic" => PermissionType.NoMic,
        "no_camera" => PermissionType.NoCamera,
        "no_screen_share" => PermissionType.NoScreenShare,
        "co_host" => PermissionType.CoHost,
        _ => throw new ArgumentException($"Gia tri permission_type khong hop le: {s}"),
    };

    public static string ToStringValue(PermissionType p) => p switch
    {
        PermissionType.ShareScreen => "share_screen",
        PermissionType.MiniApp => "mini_app",
        PermissionType.FocusMode => "focus_mode",
        PermissionType.NoMic => "no_mic",
        PermissionType.NoCamera => "no_camera",
        PermissionType.NoScreenShare => "no_screen_share",
        PermissionType.CoHost => "co_host",
        _ => throw new ArgumentOutOfRangeException(nameof(p)),
    };
}
