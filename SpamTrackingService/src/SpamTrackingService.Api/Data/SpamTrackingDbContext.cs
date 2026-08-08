using Microsoft.EntityFrameworkCore;
using SpamTrackingService.Api.Models;

namespace SpamTrackingService.Api.Data;

// Schema da tao san qua Tainguyen/infra/spamtracking-db-init.sql - DbContext
// nay chi map dung theo schema co san, KHONG dung EF Migrations.
public class SpamTrackingDbContext(DbContextOptions<SpamTrackingDbContext> options) : DbContext(options)
{
    public DbSet<Violation> Violations => Set<Violation>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Violation>(entity =>
        {
            entity.ToTable("violations");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Id).HasColumnName("id");
            entity.Property(v => v.UserId).HasColumnName("user_id");
            entity.Property(v => v.DetectedAt).HasColumnName("detected_at");
            entity.Property(v => v.Reason).HasColumnName("reason");
            entity.Property(v => v.AccountStatus)
                .HasColumnName("account_status")
                .HasConversion(v => Violation.StatusToString(v), v => Violation.StatusFromString(v));
            entity.Property(v => v.Score).HasColumnName("score");
        });
    }
}
