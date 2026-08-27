namespace IdentityService.Api.Endpoints;

public record SendFriendRequestRequest(long AddresseeId);

// AvatarUpdatedAt di kem de danh sach ban be ve duoc anh dai dien ngay tu
// lan tai dau - neu khong, client phai goi them mot request cho MOI nguoi ban
// chi de biet ho co anh hay khong.
public record FriendRequestResponse(
    long Id, long UserId, string Nickname, DateTimeOffset CreatedAt, DateTimeOffset? AvatarUpdatedAt);

public record FriendResponse(
    long UserId, string Nickname, DateTimeOffset FriendsSince, DateTimeOffset? AvatarUpdatedAt);
