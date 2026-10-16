using System.Globalization;
using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Services;

public static class UserSearch
{
    public static IQueryable<User> Apply(IQueryable<User> users, long callerId, string query)
    {
        var term = query.Trim().TrimStart('@', '#').Trim();
        if (term.Length == 0) return users.Where(_ => false);

        var id = long.TryParse(term, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : -1;
        // %, _ va backslash la ky tu nguoi dung tim, khong phai wildcard SQL.
        var pattern = "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
        return users
            .Where(u => u.Id != callerId && u.Status == UserStatus.Active &&
                (u.Id == id || EF.Functions.ILike(u.Nickname, pattern, "\\") ||
                 EF.Functions.ILike(u.DisplayName, pattern, "\\")))
            .OrderByDescending(u => u.Id == id)
            .ThenBy(u => u.DisplayName)
            .ThenBy(u => u.Nickname)
            .ThenBy(u => u.Id)
            .Take(20);
    }
}
