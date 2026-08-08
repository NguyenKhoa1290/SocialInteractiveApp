using Microsoft.EntityFrameworkCore;
using WorkspaceService.Api.Models;

namespace WorkspaceService.Api.Data;

// Schema da tao san qua Tainguyen/infra/workspace-db-init.sql (kem trigger
// cascade_delete_workspace_on_leader_leave) - DbContext nay chi map dung
// theo schema co san, KHONG dung EF Migrations.
public class WorkspaceDbContext(DbContextOptions<WorkspaceDbContext> options) : DbContext(options)
{
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Workspace>(entity =>
        {
            entity.ToTable("workspaces");
            entity.HasKey(w => w.Id);
            entity.Property(w => w.Id).HasColumnName("id");
            entity.Property(w => w.Name).HasColumnName("name");
            entity.Property(w => w.AvatarUrl).HasColumnName("avatar_url");
            entity.Property(w => w.CreatedBy).HasColumnName("created_by");
            entity.Property(w => w.CreatedAt).HasColumnName("created_at");
            entity.Property(w => w.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<WorkspaceMember>(entity =>
        {
            entity.ToTable("workspace_members");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.WorkspaceId).HasColumnName("workspace_id");
            entity.Property(m => m.UserId).HasColumnName("user_id");
            entity.Property(m => m.Role)
                .HasColumnName("role")
                .HasConversion(v => WorkspaceMember.RoleToString(v), v => WorkspaceMember.RoleFromString(v));
            entity.Property(m => m.InvitedBy).HasColumnName("invited_by");
            entity.Property(m => m.JoinedAt).HasColumnName("joined_at");

            entity.HasOne(m => m.Workspace)
                .WithMany(w => w.Members)
                .HasForeignKey(m => m.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
