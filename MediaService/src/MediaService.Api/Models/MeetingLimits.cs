namespace MediaService.Api.Models;

// Gioi han van hanh cua cum LiveKit hien tai. Dat o backend de client khong
// the tang han muc bang cach goi API truc tiep; LiveKit cung nhan cung gia tri
// nay khi tao phong moi.
public static class MeetingLimits
{
    public const int MaxParticipants = 50;
    public static readonly TimeSpan MaxDuration = TimeSpan.FromHours(10);

    // MaxParticipants trong DB la gia tri lich su (tung la 100, roi 30),
    // khong co setting rieng theo tung phong. Chinh sach toan he thong phai
    // ap dung ca cho phong da tao truoc khi nang han muc len 50.
    public static int EffectiveMaxParticipants(int _) => MaxParticipants;

    public static bool IsExpired(Meeting meeting, DateTimeOffset now) =>
        meeting.CreatedAt <= now - MaxDuration;
}
