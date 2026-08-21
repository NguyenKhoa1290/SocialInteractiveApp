import * as signalR from "@microsoft/signalr";
import { IDENTITY_API_URL } from "../config";
import { useAuthStore } from "../store/authStore";
import type { AppNotification } from "../types/notification";

// Kenh WebSocket rieng toi Identity Service - KHAC hub cua Chat Service
// (lib/chatHub.ts). Hai hub phuc vu hai viec khac nhau: chatHub la tin nhan
// cua phong dang mo, hub nay la thong bao cua ca he thong, den ca khi dang
// o man hinh khac.
let connection: signalR.HubConnection | null = null;
let starting: Promise<signalR.HubConnection> | null = null;

function getConnection(): Promise<signalR.HubConnection> {
  if (connection?.state === signalR.HubConnectionState.Connected) {
    return Promise.resolve(connection);
  }
  if (starting) return starting;

  const token = useAuthStore.getState().accessToken;
  connection = new signalR.HubConnectionBuilder()
    .withUrl(`${IDENTITY_API_URL}/hubs/notifications`, { accessTokenFactory: () => useAuthStore.getState().accessToken ?? token ?? "" })
    .withAutomaticReconnect()
    .build();

  starting = connection.start().then(() => connection!);
  return starting;
}

// Tra ve ham huy dang ky. Async vi phai chac chan connection ton tai truoc
// khi .on/.off - cung mau voi chatHub.ts.
export async function onNotification(handler: (n: AppNotification) => void) {
  const conn = await getConnection();
  conn.on("NotificationReceived", handler);
  return () => conn.off("NotificationReceived", handler);
}

// Goi luc dang xuat: khong dong thi connection cu van giu JWT cu va se tiep
// tuc nhan thong bao cua tai khoan vua thoat.
export async function stopNotificationHub() {
  const conn = connection;
  connection = null;
  starting = null;
  try {
    await conn?.stop();
  } catch {
    // dang ngat ket noi thi loi o day khong con y nghia gi
  }
}
