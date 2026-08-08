namespace MediaService.Api.Models;

public class IptvChannelList
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;
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
