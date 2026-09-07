export interface FriendRequest {
  id: number;
  userId: number;
  nickname: string;
  displayName: string;
  createdAt: string;
  avatarUpdatedAt: string | null;
}

export interface Friend {
  userId: number;
  nickname: string;
  displayName: string;
  friendsSince: string;
  avatarUpdatedAt: string | null;
}
