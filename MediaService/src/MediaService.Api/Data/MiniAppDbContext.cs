using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Data;

// CSDL rieng cho phan Mini App (Phase 6) - dung Postgres KHAC voi Media DB
// ("database per service"), dung theo Tainguyen/infra/miniapp-db-init.sql.
public class MiniAppDbContext(DbContextOptions<MiniAppDbContext> options) : DbContext(options)
{
    public DbSet<IptvChannelList> IptvChannelLists => Set<IptvChannelList>();
    public DbSet<IptvChannelGroup> IptvChannelGroups => Set<IptvChannelGroup>();
    public DbSet<IptvChannel> IptvChannels => Set<IptvChannel>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<IptvChannelList>(entity =>
        {
            entity.ToTable("iptv_channel_lists");
            entity.HasKey(l => l.Id);
            entity.Property(l => l.Id).HasColumnName("id");
            entity.Property(l => l.UserId).HasColumnName("user_id");
            entity.Property(l => l.Name).HasColumnName("name");
            entity.Property(l => l.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<IptvChannelGroup>(entity =>
        {
            entity.ToTable("iptv_channel_groups");
            entity.HasKey(g => g.Id);
            entity.Property(g => g.Id).HasColumnName("id");
            entity.Property(g => g.ListId).HasColumnName("list_id");
            entity.Property(g => g.GroupName).HasColumnName("group_name");
        });

        modelBuilder.Entity<IptvChannel>(entity =>
        {
            entity.ToTable("iptv_channels");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.GroupId).HasColumnName("group_id");
            entity.Property(c => c.ChannelName).HasColumnName("channel_name");
            entity.Property(c => c.StreamUrl).HasColumnName("stream_url");
            entity.Property(c => c.AudioTrack).HasColumnName("audio_track");
        });
    }
}
