import * as signalR from "@microsoft/signalr";
import { CHAT_API_URL } from "../config";
import { useAuthStore } from "../store/authStore";
import type { Message } from "../types/chat";

let connection: signalR.HubConnection | null = null;
let starting: Promise<signalR.HubConnection> | null = null;

// Cac nhom SignalR dang o trong.
//
// LOI THAT DA GAP: SignalR cap CONNECTION ID MOI sau moi lan noi lai, ma o
// phia server nhom gan theo connection id - noi lai xong la ROI HET cac nhom
// va khong ai bao gi ca. Trieu chung: dang chat binh thuong, mang chap mot
// cai, tu do tin nhan cua nguoi khac khong toi nua cho toi khi tai lai trang;
// khung chat van hien, van gui duoc, chi khong nhan. Da bat duoc trong luc
// kiem cham do tin chua doc cua phong hop: nhat ky trinh duyet ghi
// "Connection disconnected ... 1006" roi "WebSocket connected" ngay sau, va
// tu do khong con su kien nao.
//
// Giu lai danh sach de vao lai sau khi noi lai - ca khi noi lai tai cho lan
// khi phai dung han mot connection moi.
const daVao = {
  hoiThoai: new Set<number>(),
  // meetingId -> conversationId (JoinMeetingDiscussion can ca hai so)
  cuocHop: new Map<number, number>(),
};

async function vaoLaiCacNhom(conn: signalR.HubConnection) {
  for (const id of daVao.hoiThoai) {
    try {
      await conn.invoke("JoinConversation", id);
    } catch {
      // Vao lai hong thi thoi - lan noi lai sau se thu tiep. Nem loi o day
      // chi lam chet luon nhung nhom con lai trong vong lap.
    }
  }
  for (const [meetingId, conversationId] of daVao.cuocHop) {
    try {
      await conn.invoke("JoinMeetingDiscussion", conversationId, meetingId);
    } catch {
      // nhu tren
    }
  }
}

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
  const conn = new signalR.HubConnectionBuilder()
    .withUrl(`${CHAT_API_URL}/hubs/chat`, { accessTokenFactory: () => token ?? "" })
    // Chinh sach mac dinh thu 4 lan (0, 2, 10, 30 giay) roi BO HAN. Mot tab
    // chat hay mot phong hop mo ca buoi ma mang chap chon vai lan la mat tin
    // VINH VIEN, khong bao gi. Thu mai, gian dan toi 30 giay roi giu nhip do.
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (ctx) => [0, 2000, 5000, 10000, 20000][ctx.previousRetryCount] ?? 30000,
    })
    .build();
  connection = conn;

  conn.onreconnected(() => {
    void vaoLaiCacNhom(conn);
  });

  // Dong han: quen connection di de lan goi sau dung lai tu dau thay vi nhan
  // ve mot connection da chet. Danh sach nhom GIU NGUYEN - connection moi se
  // vao lai dung nhung nhom do.
  conn.onclose(() => {
    if (connection === conn) {
      connection = null;
      starting = null;
    }
  });

  starting = conn.start().then(async () => {
    await vaoLaiCacNhom(conn);
    return conn;
  });
  return starting;
}

export async function joinConversation(conversationId: number) {
  const conn = await getChatConnection();
  daVao.hoiThoai.add(conversationId);
  await conn.invoke("JoinConversation", conversationId);
}

export async function leaveConversation(conversationId: number) {
  daVao.hoiThoai.delete(conversationId);
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

// Chat Service van broadcast "MessageEdited" sau moi lan sua (xem
// ConversationEndpoints.cs, nhanh MapPatch) nhung truoc day KHONG AI o phia
// client nghe ca - nguoi sua thay noi dung moi ngay (tu cap nhat state cuc
// bo), con nhung nguoi khac trong phong van doc ban cu cho toi khi tai lai
// trang. Voi tin da ma hoa thi cang te: ho giu ciphertext cu trong khi
// server da co ban moi.
export async function onMessageEdited(handler: (msg: Message) => void) {
  const conn = await getChatConnection();
  conn.on("MessageEdited", handler);
  return () => conn.off("MessageEdited", handler);
}

// Thao luan cua cuoc hop dung group RIENG (khong phai group cua
// conversation) - khach vang lai nghe duoc thao luan nhung khong duoc nghe
// len luong chat chinh cua nhom. Xem ChatHub.MeetingGroupName.
export async function joinMeetingDiscussion(conversationId: number, meetingId: number) {
  const conn = await getChatConnection();
  daVao.cuocHop.set(meetingId, conversationId);
  await conn.invoke("JoinMeetingDiscussion", conversationId, meetingId);
}

export async function leaveMeetingDiscussion(meetingId: number) {
  daVao.cuocHop.delete(meetingId);
  const conn = await getChatConnection();
  await conn.invoke("LeaveMeetingDiscussion", meetingId);
}

export async function onMeetingMessageReceived(handler: (msg: Message) => void) {
  const conn = await getChatConnection();
  conn.on("MeetingMessageReceived", handler);
  return () => conn.off("MeetingMessageReceived", handler);
}
