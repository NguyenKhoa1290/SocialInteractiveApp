namespace IdentityService.Api.Endpoints;

public record SendFriendRequestRequest(long AddresseeId);

public record FriendRequestResponse(long Id, long UserId, string Nickname, DateTimeOffset CreatedAt);

public record FriendResponse(long UserId, string Nickname, DateTimeOffset FriendsSince);
