import * as signalR from "@microsoft/signalr";
import { CHAT_API_URL } from "../config";
import { useAuthStore } from "../store/authStore";
import type { Message } from "../types/chat";

let connection: signalR.HubConnection | null = null;
let starting: Promise<signalR.HubConnection> | null = null;
const CONNECT_WAIT_TIMEOUT_MS = 35_000;

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

// Khi nguoi dung mo/chuyen phong dung luc SignalR dang tu noi lai, khong
// duoc tra ve promise `start()` cu da resolve: invoke ngay tren connection
// Reconnecting se nem loi va ca trang chat bi coi la tai hong. Doi connection
// ve Connected; qua thoi gian nay UI van hien du lieu REST va bao loi realtime
// rieng, thay vi treo vo han.
async function doiKetNoiSanSang(conn: signalR.HubConnection) {
  const hetHan = Date.now() + CONNECT_WAIT_TIMEOUT_MS;
  while (connection === conn && Date.now() < hetHan) {
    if (conn.state === signalR.HubConnectionState.Connected) return conn;
    if (conn.state === signalR.HubConnectionState.Disconnected) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Kết nối thời gian thực chưa sẵn sàng");
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
  if (
    connection?.state === signalR.HubConnectionState.Connecting ||
    connection?.state === signalR.HubConnectionState.Reconnecting ||
    connection?.state === signalR.HubConnectionState.Disconnecting
  ) {
    return doiKetNoiSanSang(connection);
  }

  // Initial start that failed does not always raise `onclose`. Do not reuse a
  // disconnected object left behind by that attempt.
  if (connection?.state === signalR.HubConnectionState.Disconnected) connection = null;

  const conn = new signalR.HubConnectionBuilder()
    // SignalR goi factory lai khi reconnect. Phai doc token HIEN TAI tu store;
    // neu capture token luc tao hub thi sau lan refresh JWT, WebSocket van
    // reconnect bang token cu da het han va chi F5 moi cuu duoc.
    .withUrl(`${CHAT_API_URL}/hubs/chat`, {
      accessTokenFactory: () => useAuthStore.getState().accessToken ?? "",
    })
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

  const startPromise = conn
    .start()
    .then(async () => {
      await vaoLaiCacNhom(conn);
      return conn;
    })
    .catch((error) => {
      if (connection === conn) connection = null;
      throw error;
    });
  starting = startPromise;
  // `starting` chi dai dien cho lan start DANG CHAY. Giu promise da resolve
  // o day lam moi lan Reconnecting sau nay nhan lai connection chua san sang.
  void startPromise.finally(() => {
    if (starting === startPromise) starting = null;
  }).catch(() => {});
  return startPromise;
}

export async function joinConversation(conversationId: number) {
  // Ghi y dinh truoc khi doi ket noi: neu reconnect hoan tat trong luc dang
  // doi, callback onreconnected van biet can vao lai nhom nao.
  daVao.hoiThoai.add(conversationId);
  const conn = await getChatConnection();
  await conn.invoke("JoinConversation", conversationId);
}

export async function leaveConversation(conversationId: number) {
  daVao.hoiThoai.delete(conversationId);
  // Unmount khong duoc mo mot WebSocket moi chi de roi nhom. Connection moi
  // da khong co membership cu; connection dang reconnect se doc `daVao` khi
  // no san sang lai.
  const conn = connection;
  if (conn?.state !== signalR.HubConnectionState.Connected) return;
  try {
    await conn.invoke("LeaveConversation", conversationId);
  } catch {
    // Best effort: connection mat ngay luc unmount thi server tu don group
    // theo connection id.
  }
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
  daVao.cuocHop.set(meetingId, conversationId);
  const conn = await getChatConnection();
  await conn.invoke("JoinMeetingDiscussion", conversationId, meetingId);
}

export async function leaveMeetingDiscussion(meetingId: number) {
  daVao.cuocHop.delete(meetingId);
  const conn = connection;
  if (conn?.state !== signalR.HubConnectionState.Connected) return;
  try {
    await conn.invoke("LeaveMeetingDiscussion", meetingId);
  } catch {
    // Best effort, giong leaveConversation.
  }
}

export async function onMeetingMessageReceived(handler: (msg: Message) => void) {
  const conn = await getChatConnection();
  conn.on("MeetingMessageReceived", handler);
  return () => conn.off("MeetingMessageReceived", handler);
}

// Tach khoi su kien tin moi de man hinh phong hop khong tang so tin chua doc
// khi ai do chi sua mot tin nhan da ton tai.
export async function onMeetingMessageEdited(handler: (msg: Message) => void) {
  const conn = await getChatConnection();
  conn.on("MeetingMessageEdited", handler);
  return () => conn.off("MeetingMessageEdited", handler);
}
