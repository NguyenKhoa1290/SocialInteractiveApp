namespace MediaService.Api.Models;

public class IptvChannelList
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;

    // Playlist dung chung do admin dat san - xem ghi chu o miniapp-db-init.sql.
    public bool IsShared { get; set; }

    // Link M3U da nhap playlist nay. Co gia tri = tu dong nhap lai moi 10
    // phut (PlaylistRefreshService). NULL = playlist go tay, khong dong vao.
    public string? SourceUrl { get; set; }
    public bool AutoGroups { get; set; } = true;
    public DateTimeOffset? RefreshedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

public class IptvChannelGroup
{
    public long Id { get; set; }
    public long ListId { get; set; }
    public string GroupName { get; set; } = string.Empty;
}

public class IptvChannel
{
    public long Id { get; set; }
    public long GroupId { get; set; }
    public string ChannelName { get; set; } = string.Empty;
    public string StreamUrl { get; set; } = string.Empty;
    public string? AudioTrack { get; set; }
}
