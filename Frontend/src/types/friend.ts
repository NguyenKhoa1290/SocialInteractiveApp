export interface FriendRequest {
  id: number;
  userId: number;
  nickname: string;
  createdAt: string;
}

export interface Friend {
  userId: number;
  nickname: string;
  friendsSince: string;
}
