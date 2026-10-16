using IdentityService.Api.Models;
using IdentityService.Api.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;

static void Check(bool result, string description)
{
    if (!result) throw new InvalidOperationException(description);
    Console.WriteLine($"PASS {description}");
}

var connection = Environment.GetEnvironmentVariable("USER_SEARCH_CHECK_DB") ??
    "Host=127.0.0.1;Port=5432;Database=user_search_checks;Username=postgres;Password=search-check-only";
if (new NpgsqlConnectionStringBuilder(connection).Database != "user_search_checks")
    throw new InvalidOperationException("Checks must use the isolated user_search_checks database");
await using var db = new SearchDb(new DbContextOptionsBuilder<SearchDb>().UseNpgsql(connection).Options);
await db.Database.EnsureCreatedAsync();
try
{
    db.Users.AddRange(
        new User { Id = 1, Nickname = "my_handle", DisplayName = "Trang myself" },
        new User { Id = 2, Nickname = "generated_000002", DisplayName = "Trang" },
        new User { Id = 3, Nickname = "generated_000003", DisplayName = "Đặng Khoa" },
        new User { Id = 4, Nickname = "trang_locked", DisplayName = "Trang locked", Status = UserStatus.Locked },
        new User { Id = 5, Nickname = "literal_percent", DisplayName = "100% Real" },
        new User { Id = 6, Nickname = "under_score", DisplayName = "Other person" },
        new User { Id = 7, Nickname = "slash\\name", DisplayName = "Backslash" },
        new User { Id = 8, Nickname = "generated_123", DisplayName = "Another match" },
        new User { Id = 123, Nickname = "khoa_handle", DisplayName = "Khoa" });
    db.Users.AddRange(Enumerable.Range(200, 25).Select(id => new User
    {
        Id = id, Nickname = $"suggestion_{id}", DisplayName = $"Suggested person {id}",
    }));
    await db.SaveChangesAsync();

    async Task<long[]> Find(string q) => await UserSearch.Apply(db.Users, 1, q).Select(u => u.Id).ToArrayAsync();
    Check((await Find("Trang")).SequenceEqual([2L]), "Display name matches independently from generated nickname; caller and locked accounts are excluded");
    Check((await Find("  tRaNg  ")).SequenceEqual([2L]), "Names match without case sensitivity and ignore surrounding spaces");
    Check((await Find("ĐẶNG")).SequenceEqual([3L]), "Vietnamese display names match with case-insensitive PostgreSQL search");
    Check((await Find("123")).First() == 123, "Exact user ID is ranked before partial nickname matches");
    Check((await Find("#123")).Contains(123), "User ID accepts a leading hash");
    Check((await Find("@khoa_handle")).SequenceEqual([123L]), "Nickname accepts a leading at sign");
    Check((await Find("2")).Contains(2), "Single-digit user IDs can be searched");
    Check((await Find("100%")).SequenceEqual([5L]), "Percent is treated as a literal character");
    Check((await Find("under_")).SequenceEqual([6L]), "Underscore is treated as a literal character");
    Check((await Find("slash\\")).SequenceEqual([7L]), "Backslash is treated as a literal character");
    Check((await Find("   ")).Length == 0 && (await Find("@")).Length == 0, "Empty queries do not list all users");
    Check((await Find("not-existing-person")).Length == 0, "Unknown names return no matches");
    Check((await Find("Suggested")).Length == 20, "Suggestions remain bounded to 20 users");
}
finally
{
    await db.Database.EnsureDeletedAsync();
}

sealed class SearchDb(DbContextOptions<SearchDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.Entity<User>().Ignore(u => u.OAuthLinks);
}
