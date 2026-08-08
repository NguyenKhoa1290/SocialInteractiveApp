using ChatService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatService.Api.Data;

// Schema da tao san qua Tainguyen/infra/chat-db-init.sql (kem trigger
// sync_storage_used) - DbContext nay chi map dung theo schema co san, KHONG
// dung EF Migrations.
public class ChatDbContext(DbContextOptions<ChatDbContext> options) : DbContext(options)
{
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<FileAttachment> Files => Set<FileAttachment>();
    public DbSet<MutedMember> MutedMembers => Set<MutedMember>();
    public DbSet<GroupChatSettings> GroupChatSettings => Set<GroupChatSettings>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Conversation>(entity =>
        {
            entity.ToTable("conversations");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.Type)
                .HasColumnName("type")
                .HasConversion(v => Conversation.TypeToString(v), v => Conversation.TypeFromString(v));
            entity.Property(c => c.WorkspaceId).HasColumnName("workspace_id");
            entity.Property(c => c.ParticipantAId).HasColumnName("participant_a_id");
            entity.Property(c => c.ParticipantBId).HasColumnName("participant_b_id");
            entity.Property(c => c.LastMessageAt).HasColumnName("last_message_at");
            entity.Property(c => c.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<Message>(entity =>
        {
            entity.ToTable("messages");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.ConversationId).HasColumnName("conversation_id");
            entity.Property(m => m.SenderId).HasColumnName("sender_id");
            entity.Property(m => m.Type)
                .HasColumnName("type")
                .HasConversion(v => Message.TypeToString(v), v => Message.TypeFromString(v));
            entity.Property(m => m.Content).HasColumnName("content");
            entity.Property(m => m.IsDeleted).HasColumnName("is_deleted");
            entity.Property(m => m.CreatedAt).HasColumnName("created_at");

            entity.HasOne(m => m.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(m => m.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<FileAttachment>(entity =>
        {
            entity.ToTable("files");
            entity.HasKey(f => f.Id);
            entity.Property(f => f.Id).HasColumnName("id");
            entity.Property(f => f.ConversationId).HasColumnName("conversation_id");
            entity.Property(f => f.MessageId).HasColumnName("message_id");
            entity.Property(f => f.UploadedBy).HasColumnName("uploaded_by");
            entity.Property(f => f.ObjectKey).HasColumnName("object_key");
            entity.Property(f => f.FileType)
                .HasColumnName("file_type")
                .HasConversion(v => FileAttachment.TypeToString(v), v => FileAttachment.TypeFromString(v));
            entity.Property(f => f.SizeBytes).HasColumnName("size_bytes");
            entity.Property(f => f.UploadedAt).HasColumnName("uploaded_at");
        });

        modelBuilder.Entity<MutedMember>(entity =>
        {
            entity.ToTable("muted_members");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id).HasColumnName("id");
            entity.Property(m => m.ConversationId).HasColumnName("conversation_id");
            entity.Property(m => m.UserId).HasColumnName("user_id");
            entity.Property(m => m.MutedBy).HasColumnName("muted_by");
            entity.Property(m => m.MutedAt).HasColumnName("muted_at");
        });

        modelBuilder.Entity<GroupChatSettings>(entity =>
        {
            entity.ToTable("group_chat_settings");
            entity.HasKey(g => g.ConversationId);
            entity.Property(g => g.ConversationId).HasColumnName("conversation_id");
            entity.Property(g => g.Plan)
                .HasColumnName("plan")
                .HasConversion(v => Models.GroupChatSettings.PlanToString(v), v => Models.GroupChatSettings.PlanFromString(v));
            entity.Property(g => g.StorageQuotaBytes).HasColumnName("storage_quota_bytes");
            entity.Property(g => g.StorageUsedBytes).HasColumnName("storage_used_bytes");
            entity.Property(g => g.IsLocked).HasColumnName("is_locked");
            entity.Property(g => g.StorageExpiresAt).HasColumnName("storage_expires_at");
            entity.Property(g => g.UpdatedAt).HasColumnName("updated_at");
            entity.Property(g => g.LastWarningStage).HasColumnName("last_warning_stage");
        });
    }
}
