namespace IdentityService.Api.Models;

public enum FriendshipStatus
{
    Pending,
    Accepted
}

// Ban be - tu thiet ke (khong co trong tai lieu goc, xem
// Tainguyen/infra/identity-db-init.sql). 1 dong = 1 cap quan he; huong
// requester/addressee chi co y nghia luc con Pending (ai la nguoi gui loi
// moi) - khi da Accepted thi quan he la 2 chieu binh dang.
public class Friendship
{
    public long Id { get; set; }
    public long RequesterId { get; set; }
    public long AddresseeId { get; set; }
    public FriendshipStatus Status { get; set; } = FriendshipStatus.Pending;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RespondedAt { get; set; }
}
