using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Data;

// Schema da duoc tao san qua Tainguyen/infra/media-db-init.sql. DbContext nay
// chi map dung theo schema co san, KHONG dung EF Migrations - cung quy uoc
// voi cac service khac trong du an (xem IdentityDbContext.cs).
public class MediaDbContext(DbContextOptions<MediaDbContext> options) : DbContext(options)
{
    public DbSet<Meeting> Meetings => Set<Meeting>();
    public DbSet<MeetingParticipant> MeetingParticipants => Set<MeetingParticipant>();
    public DbSet<MeetingInvite> MeetingInvites => Set<MeetingInvite>();
    public DbSet<MeetingPermission> MeetingPermissions => Set<MeetingPermission>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Meeting>(entity =>
        {
            entity.ToTable("meetings");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.HostId).HasColumnName("host_id");
            entity.Property(m => m.WorkspaceId).HasColumnName("workspace_id");
            entity.Property(m => m.ConversationId).HasColumnName("conversation_id");
            entity.Property(m => m.Status)
                .HasColumnName("status")
                .HasConversion(
                    v => v == MeetingStatus.Active ? "active" : "ended",
                    v => v == "active" ? MeetingStatus.Active : MeetingStatus.Ended);
            entity.Property(m => m.MaxParticipants).HasColumnName("max_participants");
            entity.Property(m => m.IsTemporary).HasColumnName("is_temporary");
            entity.Property(m => m.RequiresApproval).HasColumnName("requires_approval");
            entity.Property(m => m.AllowCamera).HasColumnName("allow_camera");
            entity.Property(m => m.AllowMic).HasColumnName("allow_mic");
            entity.Property(m => m.AllowScreenShare).HasColumnName("allow_screen_share");
            entity.Property(m => m.AllowMiniApp).HasColumnName("allow_mini_app");
            entity.Property(m => m.CreatedAt).HasColumnName("created_at");
            entity.Property(m => m.EndedAt).HasColumnName("ended_at");

            entity.HasMany(m => m.Participants)
                .WithOne()
                .HasForeignKey(p => p.MeetingId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MeetingParticipant>(entity =>
        {
            entity.ToTable("meeting_participants");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.MeetingId).HasColumnName("meeting_id");
            entity.Property(p => p.UserId).HasColumnName("user_id");
            entity.Property(p => p.Role)
                .HasColumnName("role")
                .HasConversion(
                    v => v == ParticipantRole.Host ? "host" : "participant",
                    v => v == "host" ? ParticipantRole.Host : ParticipantRole.Participant);
            entity.Property(p => p.JoinedAt).HasColumnName("joined_at");
            entity.Property(p => p.LeftAt).HasColumnName("left_at");
        });

        modelBuilder.Entity<MeetingInvite>(entity =>
        {
            entity.ToTable("meeting_invites");
            entity.HasKey(i => i.Id);
            entity.Property(i => i.Id).HasColumnName("id");
            entity.Property(i => i.MeetingId).HasColumnName("meeting_id");
            entity.Property(i => i.InviteToken).HasColumnName("invite_token");
            entity.Property(i => i.InviteType)
                .HasColumnName("invite_type")
                .HasConversion(
                    v => v == InviteType.Link ? "link" : "direct",
                    v => v == "link" ? InviteType.Link : InviteType.Direct);
            entity.Property(i => i.CreatedBy).HasColumnName("created_by");
            entity.Property(i => i.InvitedUserId).HasColumnName("invited_user_id");
            entity.Property(i => i.ExpiresAt).HasColumnName("expires_at");
            entity.Property(i => i.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<MeetingPermission>(entity =>
        {
            entity.ToTable("meeting_permissions");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.MeetingId).HasColumnName("meeting_id");
            entity.Property(p => p.UserId).HasColumnName("user_id");
            entity.Property(p => p.PermissionType)
                .HasColumnName("permission_type")
                .HasConversion(
                    v => MediaService.Api.Models.MeetingPermission.ToStringValue(v),
                    v => MediaService.Api.Models.MeetingPermission.FromString(v));
            entity.Property(p => p.GrantedBy).HasColumnName("granted_by");
            entity.Property(p => p.GrantedAt).HasColumnName("granted_at");
        });
    }
}
