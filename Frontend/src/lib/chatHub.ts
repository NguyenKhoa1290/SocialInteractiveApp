import * as signalR from "@microsoft/signalr";
import { CHAT_API_URL } from "../config";
import { useAuthStore } from "../store/authStore";
import type { Message } from "../types/chat";

let connection: signalR.HubConnection | null = null;
let starting: Promise<signalR.HubConnection> | null = null;

// SignalR dung 1 connection dung chung cho ca app (khong tao moi moi lan
// vao 1 phong chat) - JWT truyen qua query string vi WebSocket handshake
// tren trinh duyet khong gui duoc Authorization header (gioi han chuan cua
// SignalR JS client, xem ChatService.Api/Program.cs OnMessageReceived).
export function getChatConnection(): Promise<signalR.HubConnection> {
  if (connection?.state === signalR.HubConnectionState.Connected) {
    return Promise.resolve(connection);
  }
  if (starting) return starting;

  const token = useAuthStore.getState().accessToken;
  connection = new signalR.HubConnectionBuilder()
    .withUrl(`${CHAT_API_URL}/hubs/chat`, { accessTokenFactory: () => token ?? "" })
    .withAutomaticReconnect()
    .build();

  starting = connection.start().then(() => connection!);
  return starting;
}

export async function joinConversation(conversationId: number) {
  const conn = await getChatConnection();
  await conn.invoke("JoinConversation", conversationId);
}

export async function leaveConversation(conversationId: number) {
  const conn = await getChatConnection();
  await conn.invoke("LeaveConversation", conversationId);
}

// Tra ve ham huy dang ky (async - dam bao connection da ton tai truoc khi
// .on/.off, tranh truong hop goi truoc khi getChatConnection() lan dau).
export async function onMessageReceived(handler: (msg: Message) => void) {
  const conn = await getChatConnection();
  conn.on("MessageReceived", handler);
  return () => conn.off("MessageReceived", handler);
}

export async function onMessageDeleted(handler: (messageId: number) => void) {
  const conn = await getChatConnection();
  conn.on("MessageDeleted", handler);
  return () => conn.off("MessageDeleted", handler);
}

// Thao luan cua cuoc hop dung group RIENG (khong phai group cua
// conversation) - khach vang lai nghe duoc thao luan nhung khong duoc nghe
// len luong chat chinh cua nhom. Xem ChatHub.MeetingGroupName.
export async function joinMeetingDiscussion(conversationId: number, meetingId: number) {
  const conn = await getChatConnection();
  await conn.invoke("JoinMeetingDiscussion", conversationId, meetingId);
}

export async function leaveMeetingDiscussion(meetingId: number) {
  const conn = await getChatConnection();
  await conn.invoke("LeaveMeetingDiscussion", meetingId);
}

export async function onMeetingMessageReceived(handler: (msg: Message) => void) {
  const conn = await getChatConnection();
  conn.on("MeetingMessageReceived", handler);
  return () => conn.off("MeetingMessageReceived", handler);
}
