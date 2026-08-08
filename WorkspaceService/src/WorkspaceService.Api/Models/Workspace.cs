namespace WorkspaceService.Api.Models;

public class Workspace
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public long CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<WorkspaceMember> Members { get; set; } = [];
}
