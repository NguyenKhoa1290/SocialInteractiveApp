export interface FriendRequest {
  id: number;
  userId: number;
  nickname: string;
  createdAt: string;
  avatarUpdatedAt: string | null;
}

export interface Friend {
  userId: number;
  nickname: string;
  friendsSince: string;
  avatarUpdatedAt: string | null;
}
