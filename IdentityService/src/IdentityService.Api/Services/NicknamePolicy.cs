using System.Text.RegularExpressions;

namespace IdentityService.Api.Services;

// `nickname` la handle cong khai, khong phai ten hien thi. Quy tac ASCII
// tranh viec nguoi xau dung ky tu Unicode gan giong de mao danh (@NАМ so voi
// @NAM), dong thoi giu duoc viec tim kiem va @mention don gian.
public static partial class NicknamePolicy
{
    public const int MaxDisplayNameLength = 50;
    public const int MaxNicknameLength = 24;

    [GeneratedRegex("^[A-Z][A-Z0-9_]{2,23}$", RegexOptions.CultureInvariant)]
    private static partial Regex ValidNickname();

    public static bool TryNormalizeNickname(string? value, out string nickname)
    {
        nickname = value?.Trim().ToUpperInvariant() ?? string.Empty;
        return ValidNickname().IsMatch(nickname);
    }

    public static bool TryNormalizeDisplayName(string? value, out string displayName)
    {
        displayName = value?.Trim() ?? string.Empty;
        return displayName.Length is > 0 and <= MaxDisplayNameLength
            && !displayName.Any(char.IsControl);
    }

    // 19 ky tu hexadecimal = 76 bit ngau nhien. Xac suat trung thuc te bang
    // khong; unique index trong Postgres van la lop bao ve cuoi cung.
    public static string CreateGeneratedNickname() => $"USER_{Guid.NewGuid():N}"[..MaxNicknameLength].ToUpperInvariant();
}
