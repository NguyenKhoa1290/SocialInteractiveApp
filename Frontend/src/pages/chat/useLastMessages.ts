import { useEffect, useState } from "react";
import { chatApi } from "../../api/chatApi";
import { keysApi } from "../../api/keysApi";
import { useAuthStore } from "../../store/authStore";
import { useKeyStore } from "../../store/keyStore";
import { decryptTextGroup, decryptTextP2P } from "../../lib/crypto/e2ee";
import { publicKeyFromBase64 } from "../../lib/crypto/x25519";
import type { ConversationSummary, LastMessage } from "../../types/chat";

// Doan xem truoc duoi moi ten o danh sach hoi thoai.
//
// Tin nhan Text duoc MA HOA DAU CUOI nen server khong doc duoc de lam san
// doan xem truoc - viec giai ma bat buoc phai o client. Lam gon nhat co the:
//   * MOT request lay tin cuoi cua TAT CA hoi thoai (/conversations/last-messages)
//   * MOT request lay khoa cong khai cua tat ca nguoi gui lien quan (/keys/batch)
// Tuc hai vong khu hoi cho ca danh sach, khong phai hai vong moi hoi thoai.
//
// Chua mo khoa E2EE thi tra ve rong - noi goi tu lui ve hien thoi diem.

function moTa(m: LastMessage): string | null {
  if (m.isDeleted) return "Tin nhắn đã được thu hồi";
  switch (m.type) {
    case "image":
      return "Đã gửi một ảnh";
    case "video":
      return "Đã gửi một video";
    case "voice":
      return "Đã gửi một tin nhắn thoại";
    case "file":
      return "Đã gửi một tệp";
    case "system":
      return m.content ?? "Thông báo hệ thống";
    default:
      return null; // text - phai giai ma
  }
}

export function useLastMessages(items: ConversationSummary[] | null) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const privateKey = useKeyStore((s) => s.privateKey);
  const [preview, setPreview] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!items || items.length === 0) return;
    let huy = false;

    void (async () => {
      let last: LastMessage[];
      try {
        last = (await chatApi.lastMessages()).data;
      } catch {
        return; // khong lay duoc thi thoi, danh sach van dung
      }
      if (huy) return;

      // Cac tin KHONG phai Text thi mo ta duoc ngay, khong can khoa.
      const ngay: Record<number, string> = {};
      const canGiaiMa: LastMessage[] = [];
      for (const m of last) {
        const t = moTa(m);
        if (t !== null) ngay[m.conversationId] = t;
        else if (m.isEncrypted && m.content && m.contentNonce) canGiaiMa.push(m);
        else if (m.content) ngay[m.conversationId] = m.content;
      }
      if (Object.keys(ngay).length > 0) setPreview((p) => ({ ...p, ...ngay }));

      if (!privateKey || canGiaiMa.length === 0) return;

      // Khoa cong khai can dung: voi 1-1 la cua NGUOI KIA, voi nhom la cua
      // NGUOI GUI. Gom lai goi mot lan.
      const kieuCua = new Map(items.map((c) => [c.id, c]));
      const canKhoa = new Set<number>();
      for (const m of canGiaiMa) {
        const c = kieuCua.get(m.conversationId);
        if (!c) continue;
        if (c.type === "p2p") {
          if (c.otherUserId) canKhoa.add(c.otherUserId);
        } else if (m.senderId && m.senderId !== currentUserId) {
          canKhoa.add(m.senderId);
        } else if (m.senderId) {
          canKhoa.add(m.senderId); // tin cua chinh minh: van can khoa cua minh
        }
      }
      if (canKhoa.size === 0) return;

      let khoa: Map<number, Uint8Array>;
      try {
        const res = await keysApi.getPublicKeysBatch([...canKhoa]);
        khoa = new Map(res.data.map((k) => [k.userId, publicKeyFromBase64(k.publicKey)]));
      } catch {
        return;
      }
      if (huy) return;

      const cap = await Promise.all(
        canGiaiMa.map(async (m) => {
          const c = kieuCua.get(m.conversationId);
          if (!c) return null;
          try {
            if (c.type === "p2p") {
              const k = c.otherUserId ? khoa.get(c.otherUserId) : undefined;
              if (!k) return null;
              return [m.conversationId, await decryptTextP2P(privateKey, k, m.content!, m.contentNonce!)] as const;
            }
            // Nhom: can khoa phien rieng cua minh cho dung tin do. Vao nhom sau
            // khi tin duoc gui thi khong co - bo qua, khong hien gi con hon
            // hien "khong giai ma duoc" o danh sach.
            if (!m.senderId || !m.recipientEncryptedKey) return null;
            const k = khoa.get(m.senderId);
            if (!k) return null;
            return [
              m.conversationId,
              await decryptTextGroup(privateKey, k, m.content!, m.contentNonce!, m.recipientEncryptedKey),
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      if (huy) return;

      const xong = Object.fromEntries(cap.filter((x): x is readonly [number, string] => x !== null));
      if (Object.keys(xong).length > 0) setPreview((p) => ({ ...p, ...xong }));
    })();

    return () => {
      huy = true;
    };
  }, [items, privateKey, currentUserId]);

  return preview;
}
