using IdentityService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IdentityService.Api.Data;

// Schema da duoc tao san qua Tainguyen/infra/identity-db-init.sql (kem CHECK constraint,
// index). DbContext nay chi map dung theo schema co san, KHONG dung EF Migrations de tao
// bang - tranh 2 nguon quan ly schema (SQL thuan + migrations) lech nhau.
public class IdentityDbContext(DbContextOptions<IdentityDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<OAuthLink> OAuthLinks => Set<OAuthLink>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id).HasColumnName("id");
            entity.Property(u => u.UserType)
                .HasColumnName("user_type")
                .HasConversion(
                    v => v == UserType.Guest ? "guest" : "registered",
                    v => v == "guest" ? UserType.Guest : UserType.Registered);
            entity.Property(u => u.Nickname).HasColumnName("nickname");
            entity.Property(u => u.Email).HasColumnName("email");
            entity.Property(u => u.PasswordHash).HasColumnName("password_hash");
            entity.Property(u => u.Status)
                .HasColumnName("status")
                .HasConversion(
                    v => v == UserStatus.Active ? "active" : "locked",
                    v => v == "active" ? UserStatus.Active : UserStatus.Locked);
            entity.Property(u => u.IsAdmin).HasColumnName("is_admin");
            entity.Property(u => u.CreatedAt).HasColumnName("created_at");
            entity.Property(u => u.LastActiveAt).HasColumnName("last_active_at");
        });

        modelBuilder.Entity<OAuthLink>(entity =>
        {
            entity.ToTable("oauth_links");
            entity.HasKey(o => o.Id);
            entity.Property(o => o.Id).HasColumnName("id");
            entity.Property(o => o.UserId).HasColumnName("user_id");
            entity.Property(o => o.Provider)
                .HasColumnName("provider")
                .HasConversion(
                    v => v == OAuthProvider.Google ? "google" : "facebook",
                    v => v == "google" ? OAuthProvider.Google : OAuthProvider.Facebook);
            entity.Property(o => o.ProviderUserId).HasColumnName("provider_user_id");
            entity.Property(o => o.LinkedAt).HasColumnName("linked_at");

            entity.HasOne(o => o.User)
                .WithMany(u => u.OAuthLinks)
                .HasForeignKey(o => o.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
