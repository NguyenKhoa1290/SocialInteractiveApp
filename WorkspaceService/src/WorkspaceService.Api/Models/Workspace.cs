namespace WorkspaceService.Api.Models;

public class Workspace
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }

    // Anh nhom luu thang trong DB - xem ghi chu o workspace-db-init.sql.
    // AvatarBytes co the nang toi 256KB nen KHONG duoc keo theo trong cac
    // truy van danh sach; cho nao chi can biet "co anh khong / anh doi luc
    // nao" thi chieu rieng AvatarUpdatedAt.
    public byte[]? AvatarBytes { get; set; }
    public string? AvatarMime { get; set; }
    public DateTimeOffset? AvatarUpdatedAt { get; set; }

    public long CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<WorkspaceMember> Members { get; set; } = [];
}
