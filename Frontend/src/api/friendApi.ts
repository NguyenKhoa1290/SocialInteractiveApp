import { identityHttp } from "./httpClient";
import type { Friend, FriendRequest } from "../types/friend";
import type { AuthUser } from "../types/auth";

export const friendApi = {
  searchUsers: (q: string) => identityHttp.get<AuthUser[]>("/users/search", { params: { q } }),

  sendRequest: (addresseeId: number) => identityHttp.post<FriendRequest | Friend>("/friends/requests", { addresseeId }),

  incoming: () => identityHttp.get<FriendRequest[]>("/friends/requests/incoming"),

  outgoing: () => identityHttp.get<FriendRequest[]>("/friends/requests/outgoing"),

  accept: (requestId: number) => identityHttp.post<Friend>(`/friends/requests/${requestId}/accept`),

  cancelOrReject: (requestId: number) => identityHttp.delete<void>(`/friends/requests/${requestId}`),

  list: () => identityHttp.get<Friend[]>("/friends"),

  remove: (userId: number) => identityHttp.delete<void>(`/friends/${userId}`),
};
