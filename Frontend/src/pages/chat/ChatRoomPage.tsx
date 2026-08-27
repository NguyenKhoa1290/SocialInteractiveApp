import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { chatApi } from "../../api/chatApi";
import type { StorageInfo, TopupRequestInfo, UploadTracker } from "../../api/chatApi";
import { keysApi } from "../../api/keysApi";
import { workspaceApi } from "../../api/workspaceApi";
import { friendApi } from "../../api/friendApi";
import { joinConversation, leaveConversation, onMessageDeleted, onMessageEdited, onMessageReceived } from "../../lib/chatHub";
import { useAuthStore } from "../../store/authStore";
import { useKeyStore } from "../../store/keyStore";
import { E2eeGate } from "../../components/E2eeGate";
import {
  encryptTextP2P,
  decryptTextP2P,
  encryptTextGroup,
  decryptTextGroup,
  editTextP2P,
  editTextGroup,
  recoverGroupSessionKey,
  conversationSearchKeyMaterial,
} from "../../lib/crypto/e2ee";
import { computeQueryTokens } from "../../lib/crypto/searchTokens";
import { publicKeyFromBase64 } from "../../lib/crypto/x25519";
import { extractApiError, apiErrorCode } from "../../lib/apiError";
import { ChatWorkspace } from "./ChatWorkspace";
import { ConversationList } from "./ConversationList";
import { ConversationInfo } from "./ConversationInfo";
import { Avatar } from "../../components/Avatar";
import { IconAccount, IconAttach, IconImage, IconMic, IconSend, IconVideo } from "./ComposerIcons";
import "./workspace.css";
import { meetingApi } from "../../api/mediaApi";
import type { Meeting } from "../../types/media";
import { FileMessageContent } from "./FileMessageContent";
import { SystemMessage } from "./SystemMessage";
import type { Message, MessageType } from "../../types/chat";
import type { ConversationDetail } from "../../api/chatApi";
import { UploadProgressBar, type UploadState } from "../../components/UploadProgressBar";
import { AlertDialog } from "../../components/AlertDialog";
import "./chat.css";

const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VOICE_MAX_BYTES = 25 * 1024 * 1024;

export function ChatRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const conversationId = Number(id);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const privateKey = useKeyStore((s) => s.privateKey);

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [decrypted, setDecrypted] = useState<Record<number, string>>({});
  // P2P: chi 1 nguoi con lai. Group: toan bo thanh vien DA dang ky public
  // key (thanh vien chua thiet lap E2EE se bi loai khoi fan-out, khong
  // nhan duoc tin Text - xem missingKeyCount).
  const [publicKeys, setPublicKeys] = useState<Map<number, Uint8Array>>(new Map());
  const [missingKeyCount, setMissingKeyCount] = useState(0);
  const [isLeader, setIsLeader] = useState(false);
  const [mutedUserIds, setMutedUserIds] = useState<Set<number>>(new Set());
  const [members, setMembers] = useState<{ userId: number; nickname: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<MessageType | null>(null);
  // Tien do tai len. Tach khoi `uploading` vi hai thu tra loi hai cau hoi
  // khac nhau: `uploading` khoa cac nut lai, con cai nay ve thanh tien do.
  const [upload, setUpload] = useState<UploadState | null>(null);
  // Loi ve dung luong nhom thi chan ngang bat doc, khong do vao dong loi nho
  // o giua trang: no co con so va co viec phai lam theo.
  const [quotaAlert, setQuotaAlert] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [sendingText, setSendingText] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ message: Message; text: string }[] | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [topupRequests, setTopupRequests] = useState<TopupRequestInfo[]>([]);
  const [requestingTopup, setRequestingTopup] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [startingMeeting, setStartingMeeting] = useState(false);
  // Cac cuoc hop DA CO thao luan (lay tu Chat Service, khong phai Media) -
  // de xem lai noi dung sau khi hop xong.
  const [pastMeetingIds, setPastMeetingIds] = useState<number[]>([]);
  // Ten + anh cua doi phuong / cua nhom, de dau khung chat va panel thong tin
  // khong phai hien "Nguoi dung 42". Chat Service khong resolve ten (xem
  // ConversationSummaryResponse) nen phai tu doi chieu nhu ChatListPage.
  const [peer, setPeer] = useState<{ ten: string; anh: string | null } | null>(null);

  // Nguoi doi dien trong chat 1-1 (nhom thi khong co) - dung cho anh dai dien
  // o dau khung va o panel thong tin ben phai.
  const peerUserId =
    conversation?.type === "p2p"
      ? conversation.participantAId === currentUserId
        ? conversation.participantBId
        : conversation.participantAId
      : null;

  const bottomRef = useRef<HTMLDivElement>(null);

  // Dung ref (khong phai state) de doc dung "conversation.type" ben trong
  // handler onMessageReceived - handler duoc dang ky 1 LAN duy nhat luc
  // effect mount (dependency chi co conversationId), neu doc truc tiep bien
  // state "conversation" se bi "dong bang" gia tri cu (null) mai mai do
  // closure, dan toi khong phan biet duoc P2P/Group trong handler.
  const conversationTypeRef = useRef<"p2p" | "group" | null>(null);
  useEffect(() => {
    conversationTypeRef.current = conversation?.type ?? null;
  }, [conversation]);

  // Cung ly do closure nhu tren: handler onMessageEdited can biet tin nhan
  // dang co trong danh sach co kem khoa rieng cua minh khong.
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Do cuoc hop dang mo cua hoi thoai nay. Tin nhan he thong ma Media
  // Service tao ("X da mo cuoc hop") chi la CHU, khong kem meetingId, nen
  // phai hoi rieng. Poll vi Media Service chua co tang WebSocket rieng va
  // cuoc hop co the duoc mo tu thiet bi/nguoi khac bat ky luc nao.
  useEffect(() => {
    let cancelled = false;

    async function pollMeeting() {
      try {
        const res = await meetingApi.getActiveForConversation(conversationId);
        if (cancelled) return;
        // 204 No Content -> axios tra data la chuoi rong, khong phai object.
        setActiveMeeting(res.data && typeof res.data === "object" ? res.data : null);
      } catch {
        // khong hoi duoc Media Service thi coi nhu khong co cuoc hop -
        // khong duoc lam hong man hinh chat vi mot service phu
      }
    }

    chatApi
      .listMeetingDiscussions(conversationId)
      .then((res) => {
        if (!cancelled) setPastMeetingIds(res.data.map((d) => d.meetingId));
      })
      .catch(() => {
        // khong co thao luan nao / loi tam thoi - khong lam hong man hinh chat
      });

    pollMeeting();
    const timer = setInterval(pollMeeting, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId]);

  // Nap ten hien thi cua hoi thoai. Chay sau khi da co `conversation` vi phai
  // biet la 1-1 hay nhom moi biet tra o dau.
  useEffect(() => {
    if (!conversation) return;
    let huy = false;
    void (async () => {
      try {
        if (conversation.type === "group") {
          const { data } = await workspaceApi.get(conversation.workspaceId!);
          if (!huy) setPeer({ ten: data.name, anh: null });
        } else if (peerUserId) {
          const { data } = await friendApi.list();
          const b = data.find((f) => f.userId === peerUserId);
          if (!huy && b) setPeer({ ten: b.nickname, anh: b.avatarUpdatedAt });
        }
      } catch {
        // Khong lay duoc ten thi vẫn hien duong lui ("Nguoi dung 42") - khong
        // dang chen mot bao loi vao ca man hinh vi mot cai ten.
      }
    })();
    return () => {
      huy = true;
    };
  }, [conversation, peerUserId]);

  async function handleStartMeeting() {
    setStartingMeeting(true);
    setError(null);
    try {
      const res = await meetingApi.create("in_chat", conversationId);
      const join = await meetingApi.joinInChat(res.data.id);
      navigate(`/meetings/${res.data.id}`, {
        state: { livekitToken: join.data.livekitToken, livekitUrl: join.data.livekitUrl },
      });
    } catch (err) {
      setError(extractApiError(err, "Không mở được cuộc họp"));
    } finally {
      setStartingMeeting(false);
    }
  }

  async function handleJoinMeeting() {
    if (!activeMeeting) return;
    setError(null);
    try {
      const join = await meetingApi.joinInChat(activeMeeting.id);
      navigate(`/meetings/${activeMeeting.id}`, {
        state: { livekitToken: join.data.livekitToken, livekitUrl: join.data.livekitUrl },
      });
    } catch (err) {
      setError(extractApiError(err, "Không tham gia được cuộc họp"));
    }
  }

  useEffect(() => {
    let unsubReceived: (() => void) | undefined;
    let unsubDeleted: (() => void) | undefined;
    let unsubEdited: (() => void) | undefined;
    let cancelled = false;

    async function setup() {
      try {
        const [convRes, msgRes] = await Promise.all([
          chatApi.getConversation(conversationId),
          chatApi.getMessages(conversationId),
        ]);
        if (cancelled) return;
        setConversation(convRes.data);
        setMessages([...msgRes.data].reverse());

        // GET messages la nguon du lieu QUYEN (khong phai broadcast tam
        // thoi) - neu 1 tin Text Group da qua GET ma van khong co
        // recipientEncryptedKey, nghia la khoa THAT SU khong ton tai (tin
        // rac tu truoc khi fan-out hoan chinh, hoac loi luc gui) - se
        // KHONG BAO GIO co du lieu de giai ma, phai bao terminal state ngay,
        // tranh treo mai "Dang giai ma..." (bug nguoi dung bao gap phai).
        const orphaned = msgRes.data.filter((m) => m.type === "text" && !m.isDeleted && !m.recipientEncryptedKey && convRes.data.type === "group");
        if (orphaned.length > 0) {
          setDecrypted((prev) => ({
            ...prev,
            ...Object.fromEntries(orphaned.map((m) => [m.id, "(tin nhắn cũ, không có khoá để giải mã)"])),
          }));
        }

        await joinConversation(conversationId);
        unsubReceived = await onMessageReceived((msg) => {
          if (msg.conversationId !== conversationId) return;

          // Broadcast tin Text Group qua SignalR CO CHU Y bo trong
          // recipientEncryptedKey (1 payload dung chung cho ca nhom, khong
          // the nhet rieng khoa tung nguoi vao do - xem ConversationEndpoints.cs).
          // P2P KHONG dung recipientEncryptedKey nen khong can xu ly rieng.
          if (conversationTypeRef.current === "group" && msg.type === "text" && !msg.recipientEncryptedKey) {
            if (msg.senderId === currentUserId) {
              // Tin cua CHINH MINH vua gui - da co san plaintext + cache
              // dung qua duong toi uu luc gui (xem handleSendText), BO QUA
              // ban echo thieu khoa nay (tranh race condition ghi de).
              return;
            }
            chatApi.getMessages(conversationId).then((res) => setMessages([...res.data].reverse()));
            return;
          }
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        });
        unsubDeleted = await onMessageDeleted((messageId) => {
          setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, isDeleted: true } : m)));
        });
        unsubEdited = await onMessageEdited((msg) => {
          if (msg.conversationId !== conversationId) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msg.id
                ? {
                    ...msg,
                    // Ban broadcast CO CHU Y bo trong recipientEncryptedKey
                    // (1 payload dung chung cho ca nhom - giong nhanh
                    // MessageReceived o tren). Sua tin KHONG doi khoa phien,
                    // nen khoa cu dang giu trong state van giai ma duoc ban
                    // moi -> giu lai thay vi phai goi lai server.
                    recipientEncryptedKey: msg.recipientEncryptedKey ?? m.recipientEncryptedKey,
                  }
                : m,
            ),
          );
          // Xoa ban ro cu di thi effect giai ma moi chiu chay lai cho tin
          // nay (dieu kien cua no la "id chua co trong decrypted").
          //
          // Chi xoa khi CHAC CHAN co du lieu de giai ma lai. Tin Group ma
          // minh khong co khoa rieng (vao nhom sau khi tin duoc gui) dang
          // hien dong "khong co khoa de giai ma" - xoa di thi no ket vinh
          // vien o "Dang giai ma..." vi effect se bo qua chinh tin do.
          //
          // Phai doc khoa tu STATE CUC BO chu KHONG phai tu msg: ban
          // broadcast cua Group luon bi server luoc recipientEncryptedKey
          // (mot payload chung cho ca nhom), nen xet theo msg thi moi tin
          // nhom deu bi coi la "khong giai ma duoc".
          const known = messagesRef.current.find((m) => m.id === msg.id);
          const canDecrypt =
            conversationTypeRef.current === "p2p" ||
            !!(msg.recipientEncryptedKey ?? known?.recipientEncryptedKey);
          if (!canDecrypt) return;
          setDecrypted((prev) => {
            if (!(msg.id in prev)) return prev;
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        });
      } catch (err) {
        if (!cancelled) setError(extractApiError(err, "Không tải được cuộc trò chuyện"));
      }
    }
    setup();

    return () => {
      cancelled = true;
      leaveConversation(conversationId);
      unsubReceived?.();
      unsubDeleted?.();
      unsubEdited?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Lay public key can thiet de ma hoa/giai ma Text: P2P chi 1 nguoi con
  // lai; Group can CA workspace (fan-out) + vai tro cua minh (mute/xoa tin
  // chi Truong nhom) + danh sach dang bi mute.
  useEffect(() => {
    if (!conversation) return;

    async function loadP2PKey() {
      const otherId = conversation!.participantAId === currentUserId ? conversation!.participantBId : conversation!.participantAId;
      if (!otherId) return;
      try {
        const res = await keysApi.getPublicKey(otherId);
        setPublicKeys(new Map([[otherId, publicKeyFromBase64(res.data.publicKey)]]));
      } catch {
        setMissingKeyCount(1);
      }
    }

    async function loadGroupKeys() {
      if (!conversation!.workspaceId) return;
      const [membersRes, mutedRes] = await Promise.all([
        workspaceApi.listMembers(conversation!.workspaceId),
        chatApi.listMutedMembers(conversationId),
      ]);
      setMembers(membersRes.data.map((m) => ({ userId: m.userId, nickname: m.nickname })));
      setMutedUserIds(new Set(mutedRes.data));
      setIsLeader(membersRes.data.some((m) => m.userId === currentUserId && m.role === "leader"));

      const memberIds = membersRes.data.map((m) => m.userId);
      const keysRes = await keysApi.getPublicKeysBatch(memberIds);
      const map = new Map<number, Uint8Array>();
      for (const k of keysRes.data) map.set(k.userId, publicKeyFromBase64(k.publicKey));
      setPublicKeys(map);
      setMissingKeyCount(memberIds.length - map.size);
    }

    if (conversation.type === "p2p") loadP2PKey();
    else loadGroupKeys();
  }, [conversation, currentUserId, conversationId]);

  // Giai ma cac tin nhan Text moi xuat hien (tin cu tu GET + tin realtime).
  useEffect(() => {
    if (!privateKey || publicKeys.size === 0 || !conversation) return;
    // Voi Group, tin thieu recipientEncryptedKey CHUA san sang de giai ma
    // that su (dang cho refetch tra ve dung ban rieng cho minh) - bo qua
    // hoan toan thay vi thu giai ma va ghi nham "khong giai ma duoc".
    const toDecrypt = messages.filter(
      (m) =>
        m.type === "text" &&
        !m.isDeleted &&
        m.content &&
        m.contentNonce &&
        !(m.id in decrypted) &&
        (conversation.type === "p2p" || m.recipientEncryptedKey),
    );
    if (toDecrypt.length === 0) return;

    Promise.all(
      toDecrypt.map(async (m) => {
        try {
          let text: string;
          if (conversation.type === "p2p") {
            const otherId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
            const theirKey = otherId ? publicKeys.get(otherId) : undefined;
            if (!theirKey) throw new Error("missing key");
            text = await decryptTextP2P(privateKey, theirKey, m.content!, m.contentNonce!);
          } else {
            if (!m.senderId || !m.recipientEncryptedKey) throw new Error("missing key");
            const senderKey = publicKeys.get(m.senderId);
            if (!senderKey) throw new Error("missing key");
            text = await decryptTextGroup(privateKey, senderKey, m.content!, m.contentNonce!, m.recipientEncryptedKey);
          }
          return [m.id, text] as const;
        } catch {
          return [m.id, "(không giải mã được)"] as const;
        }
      }),
    ).then((pairs) => setDecrypted((prev) => ({ ...prev, ...Object.fromEntries(pairs) })));
  }, [messages, privateKey, publicKeys, decrypted, conversation, currentUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSendText(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim() || !privateKey || !conversation || publicKeys.size === 0) return;
    setSendingText(true);
    setError(null);
    const plaintext = textInput.trim();
    try {
      let sentMessageId: number;
      if (conversation.type === "p2p") {
        const otherId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
        const theirKey = otherId ? publicKeys.get(otherId) : undefined;
        if (!theirKey) throw new Error("missing key");
        const { content, contentNonce, searchTokens } = await encryptTextP2P(privateKey, theirKey, plaintext);
        const { data: sent } = await chatApi.sendTextMessage(conversationId, content, contentNonce, undefined, searchTokens);
        sentMessageId = sent.id;
      } else {
        const recipients = [...publicKeys.entries()].map(([userId, publicKey]) => ({ userId, publicKey }));
        const { content, contentNonce, recipientKeys, searchTokens } = await encryptTextGroup(privateKey, recipients, plaintext);
        const { data: sent } = await chatApi.sendTextMessage(conversationId, content, contentNonce, recipientKeys, searchTokens);
        sentMessageId = sent.id;
      }

      // Da co plaintext + khoa cua CHINH MINH ngay tai cho luc vua ma hoa -
      // hien luon, khong doi round-trip qua realtime/GET.
      setDecrypted((prev) => ({ ...prev, [sentMessageId]: plaintext }));
      setMessages((prev) =>
        prev.some((m) => m.id === sentMessageId)
          ? prev
          : [
              ...prev,
              {
                id: sentMessageId,
                conversationId,
                senderId: currentUserId ?? null,
                senderDisplayName: null,
                type: "text",
                content: null,
                fileId: null,
                isDeleted: false,
                createdAt: new Date().toISOString(),
                isEncrypted: true,
                contentNonce: null,
                recipientEncryptedKey: null,
                isEdited: false,
                editedAt: null,
              },
            ],
      );
      setTextInput("");
    } catch (err) {
      setError(extractApiError(err, "Gửi tin nhắn thất bại"));
    } finally {
      setSendingText(false);
    }
  }

  function startEdit(m: Message) {
    setEditingId(m.id);
    setEditText(decrypted[m.id] ?? "");
  }

  async function handleSaveEdit(m: Message) {
    if (!privateKey || !conversation || !editText.trim()) return;
    setError(null);
    try {
      let content: string, contentNonce: string, searchTokens: string[];
      if (conversation.type === "p2p") {
        const otherId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
        const theirKey = otherId ? publicKeys.get(otherId) : undefined;
        if (!theirKey) throw new Error("missing key");
        ({ content, contentNonce, searchTokens } = await editTextP2P(privateKey, theirKey, editText.trim()));
      } else {
        if (!m.recipientEncryptedKey || !currentUserId) throw new Error("missing key");
        const myPub = publicKeys.get(currentUserId);
        if (!myPub) throw new Error("missing key");
        const sessionKey = await recoverGroupSessionKey(privateKey, myPub, m.recipientEncryptedKey);
        const recipients = [...publicKeys.entries()].map(([userId, publicKey]) => ({ userId, publicKey }));
        ({ content, contentNonce, searchTokens } = await editTextGroup(privateKey, recipients, sessionKey, editText.trim()));
      }
      await chatApi.editTextMessage(conversationId, m.id, content, contentNonce, searchTokens);
      setDecrypted((prev) => ({ ...prev, [m.id]: editText.trim() }));
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isEdited: true } : x)));
      setEditingId(null);
    } catch (err) {
      setError(extractApiError(err, "Không sửa được tin nhắn (có thể đã quá 15 phút)"));
    }
  }

  async function handleRecall(messageId: number) {
    try {
      await chatApi.recallMessage(conversationId, messageId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, isDeleted: true } : m)));
    } catch (err) {
      setError(extractApiError(err, "Không thu hồi được"));
    }
  }

  // Truong nhom xoa tin nhan bat ky, khac "Thu hoi" (tu-recall, co gioi han
  // thoi gian, chi nguoi gui) - xoa nay khong gioi han thoi gian, ap dung
  // cho MOI tin nhan trong nhom (UC-28).
  async function handleLeaderDelete(messageId: number) {
    try {
      await chatApi.deleteMessage(conversationId, messageId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, isDeleted: true } : m)));
    } catch (err) {
      setError(extractApiError(err, "Không xoá được tin nhắn"));
    }
  }

  async function handleToggleMute(userId: number) {
    try {
      if (mutedUserIds.has(userId)) {
        await chatApi.unmuteMember(conversationId, userId);
        setMutedUserIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      } else {
        await chatApi.muteMember(conversationId, userId);
        setMutedUserIds((prev) => new Set(prev).add(userId));
      }
    } catch (err) {
      setError(extractApiError(err, "Không thực hiện được"));
    }
  }

  async function loadStorage() {
    try {
      const [storageRes, requestsRes] = await Promise.all([
        chatApi.getStorage(conversationId),
        chatApi.listStorageTopupRequests(conversationId),
      ]);
      setStorage(storageRes.data);
      setTopupRequests(requestsRes.data);
    } catch (err) {
      setError(extractApiError(err, "Không tải được thông tin dung lượng"));
    }
  }

  function toggleAdmin() {
    setShowAdmin((v) => !v);
    if (!showAdmin && conversation?.type === "group") loadStorage();
  }

  // Nap dung luong giờ phải qua Admin duyệt (khong tu cong truc tiep nua,
  // xem chatApi.ts) - Truong nhom chi gui YEU CAU, cho hien pending.
  async function handleRequestTopup() {
    setRequestingTopup(true);
    setError(null);
    try {
      await chatApi.requestStorageTopup(conversationId, 1);
      const { data } = await chatApi.listStorageTopupRequests(conversationId);
      setTopupRequests(data);
    } catch (err) {
      setError(extractApiError(err, "Không gửi được yêu cầu"));
    } finally {
      setRequestingTopup(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!privateKey || !conversation || !searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const found = new Map<number, Message>();

      if (conversation.type === "p2p") {
        const otherId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
        const theirKey = otherId ? publicKeys.get(otherId) : undefined;
        if (!theirKey) throw new Error("missing key");
        const tokens = await computeQueryTokens(conversationSearchKeyMaterial(privateKey, theirKey), searchQuery.trim());
        const { data } = await chatApi.searchMessages(conversationId, { tokens });
        for (const m of data) found.set(m.id, m);
      } else {
        // Moi tin Group dung khoa on dinh RIENG theo tung cap (nguoi gui,
        // minh) - phai thu voi tat ca thanh vien co the la nguoi gui (xem
        // ghi chu o encryptTextGroup).
        for (const theirKey of publicKeys.values()) {
          const tokens = await computeQueryTokens(conversationSearchKeyMaterial(privateKey, theirKey), searchQuery.trim());
          if (tokens.length === 0) continue;
          const { data } = await chatApi.searchMessages(conversationId, { tokens });
          for (const m of data) found.set(m.id, m);
        }
      }

      const results = await Promise.all(
        [...found.values()].map(async (m) => {
          try {
            let text: string;
            if (conversation.type === "p2p") {
              const otherId = conversation.participantAId === currentUserId ? conversation.participantBId : conversation.participantAId;
              const theirKey = otherId ? publicKeys.get(otherId) : undefined;
              text = await decryptTextP2P(privateKey, theirKey!, m.content!, m.contentNonce!);
            } else {
              const senderKey = m.senderId ? publicKeys.get(m.senderId) : undefined;
              if (!senderKey || !m.recipientEncryptedKey) throw new Error("missing key");
              text = await decryptTextGroup(privateKey, senderKey, m.content!, m.contentNonce!, m.recipientEncryptedKey);
            }
            return { message: m, text };
          } catch {
            return { message: m, text: "(không giải mã được)" };
          }
        }),
      );
      setSearchResults(results.sort((a, b) => (a.message.createdAt < b.message.createdAt ? 1 : -1)));
    } catch (err) {
      setError(extractApiError(err, "Tìm kiếm thất bại"));
    } finally {
      setSearching(false);
    }
  }

  async function handleFileSelect(type: MessageType, file: File) {
    setError(null);

    if (type === "video" && file.size > VIDEO_MAX_BYTES) {
      setError("Video vượt quá 50MB (chưa hỗ trợ tự nén)");
      return;
    }
    if (type === "voice" && file.size > VOICE_MAX_BYTES) {
      setError("Voice vượt quá 25MB");
      return;
    }
    if (type === "file" && conversation?.type === "p2p") {
      setError("Chat 1-1 không hỗ trợ gửi File");
      return;
    }

    setUploading(type);
    setUpload({ name: file.name, loaded: 0, total: file.size });

    // Phien theo doi phai phu CA BA buoc, khong chi buoc tai len: server tru
    // dung luong ngay tu luc cap URL, nen bat cu buoc nao dut giua chung deu
    // de lai mot cho da giu ma khong ai tra. Xem chatApi.trackUpload.
    let track: UploadTracker | null = null;
    try {
      const { data: slot } = await chatApi.requestUploadUrl(
        conversationId,
        type as "image" | "video" | "voice" | "file",
        file.size,
        undefined,
        file.name,
      );
      track = chatApi.trackUpload(slot);
      await chatApi.uploadFile(
        slot,
        file,
        (loaded, total) => setUpload({ name: file.name, loaded, total }),
        track,
      );
      // Tep lon duoc tai len theo nhieu phan - chua ghep thi object CHUA ton
      // tai tren kho, nen buoc nay bat buoc truoc khi gan vao tin nhan.
      if (slot.uploadId) await chatApi.completeUpload(slot.fileId, slot.uploadId);
      await chatApi.sendFileMessage(conversationId, type as Exclude<MessageType, "text" | "system">, slot.fileId);
    } catch (err) {
      // Bao huy ngay: dung luong duoc tra lai trong tich tac thay vi doi bo
      // quet ben server phat hien. track van null khi chinh buoc xin URL
      // hong - luc do chua co gi de tra.
      if (track) void track.abort();

      const code = apiErrorCode(err);
      const message = extractApiError(err, "Gửi file thất bại");
      // Server tra kem con so (tep to bao nhieu, nhom con trong bao nhieu)
      // nen dung thang message do lam noi dung popup.
      if (code === "storage_quota_exceeded" || code === "storage_locked") setQuotaAlert(message);
      else setError(message);
    } finally {
      track?.stop();
      setUploading(null);
      setUpload(null);
    }
  }

  function pickFile(type: MessageType, accept: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleFileSelect(type, file);
    };
    input.click();
  }

  const storageNearExpiry =
    storage?.expiresAt && new Date(storage.expiresAt).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;

  const tenHoiThoai =
    peer?.ten ??
    (conversation?.type === "group" ? `Nhóm ${conversation.workspaceId}` : `Người dùng ${peerUserId ?? ""}`);

  return (
    <ChatWorkspace
      hasActive
      list={
        <ConversationList
          activeId={conversationId}
          onStartMeeting={activeMeeting ? handleJoinMeeting : handleStartMeeting}
          meetingBusy={startingMeeting}
        />
      }
      info={
        <ConversationInfo
          conversationId={conversationId}
          title={tenHoiThoai}
          peerUserId={peerUserId}
          peerAvatarUpdatedAt={peer?.anh}
          dangerLabel={conversation?.type === "group" ? "Rời nhóm" : "Xóa bạn"}
        />
      }
      chat={
        <>
      {/* Dau khung chat: dung khuon the 442x92 nhu hang danh sach. */}
      <div className="cw-card cw-head">
        <Avatar userId={peerUserId ?? 0} nickname={tenHoiThoai} avatarUpdatedAt={peer?.anh} size={68} />
        <div className="cw-card-body">
          <p className="cw-card-name">{tenHoiThoai}</p>
        </div>
        <div className="cw-head-actions">
          <button className="cw-icon-btn" onClick={() => setShowSearch((v) => !v)} title="Tìm trong hội thoại">
            🔍
          </button>
          {conversation?.type === "group" && (
            <button className="cw-icon-btn" onClick={toggleAdmin} title={isLeader ? "Quản trị & Dung lượng" : "Dung lượng"}>
              ⚙️
            </button>
          )}
          <button className="cw-icon-btn" title="Thông tin">
            <IconAccount />
          </button>
        </div>
      </div>

      {/* The cuoc hop - thay cho banner chu don thuan truoc day. Gom ca 2
          hanh dong: vao hop, va xem luong thao luan rieng cua cuoc hop do. */}
      {activeMeeting && (
        <div className="chat-meeting-card">
          <div className="chat-meeting-head">
            <strong>📹 Cuộc họp đang diễn ra</strong>
            <span className="chat-meeting-time">
              Mở lúc {new Date(activeMeeting.createdAt).toLocaleTimeString("vi-VN")}
            </span>
          </div>
          <div className="chat-meeting-actions">
            <button onClick={handleJoinMeeting}>Gia nhập</button>
            <Link to={`/app/chat/${conversationId}/meetings/${activeMeeting.id}`} className="chat-meeting-link">
              Xem thảo luận
            </Link>
          </div>
        </div>
      )}

      {/* Cuoc hop DA KET THUC van con thao luan de xem lai - thanh vien nhom
          van nhan tiep duoc trong do (khach vang lai thi mat quyen). */}
      {!activeMeeting && pastMeetingIds.length > 0 && (
        <div className="chat-meeting-card chat-meeting-past">
          <div className="chat-meeting-head">
            <strong>Thảo luận của các cuộc họp trước</strong>
          </div>
          <div className="chat-meeting-actions">
            {pastMeetingIds.map((mid) => (
              <Link key={mid} to={`/app/chat/${conversationId}/meetings/${mid}`} className="chat-meeting-link">
                Cuộc họp #{mid}
              </Link>
            ))}
          </div>
        </div>
      )}

      {storage?.isLocked && (
        <p className="chat-banner-danger">Nhóm đã bị khoá vì vượt hạn mức lưu trữ — Trưởng nhóm cần nạp thêm/mở khoá.</p>
      )}
      {!storage?.isLocked && storageNearExpiry && (
        <p className="chat-banner-warning">
          Dung lượng nhóm sắp hết hạn ({new Date(storage!.expiresAt!).toLocaleString("vi-VN")}).
        </p>
      )}

      {showSearch && (
        <div className="chat-panel">
          <form onSubmit={handleSearch} className="chat-text-form">
            <input
              className="ws-input"
              style={{ marginBottom: 0 }}
              placeholder="Tìm trong hội thoại này..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="ws-btn-primary" disabled={searching} type="submit">
              Tìm
            </button>
          </form>
          {searchResults !== null && (
            <div className="chat-search-results">
              {searchResults.length === 0 && <p className="chat-text-note">Không tìm thấy kết quả</p>}
              {searchResults.map((r) => (
                <div key={r.message.id} className="chat-search-result-item">
                  <span>{r.text}</span>
                  <span className="chat-search-result-date">{new Date(r.message.createdAt).toLocaleString("vi-VN")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAdmin && conversation?.type === "group" && (
        <div className="chat-panel">
          {storage && (
            <div className="chat-storage-info">
              <p>
                Đã dùng {(storage.usedBytes / 1_073_741_824).toFixed(2)} GB / {(storage.quotaBytes / 1_073_741_824).toFixed(2)} GB (
                {storage.plan})
              </p>
              {isLeader && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="ws-btn-secondary" disabled={requestingTopup} onClick={handleRequestTopup}>
                    Yêu cầu nạp thêm 1GB (chờ Admin duyệt)
                  </button>
                  {storage.isLocked && (
                    <button
                      className="ws-btn-secondary"
                      onClick={async () => {
                        try {
                          const { data } = await chatApi.unlockStorage(conversationId, null);
                          setStorage(data);
                        } catch (err) {
                          setError(extractApiError(err, "Không mở khoá được"));
                        }
                      }}
                    >
                      Mở khoá
                    </button>
                  )}
                </div>
              )}
              {topupRequests.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {topupRequests.map((r) => (
                    <div key={r.id} className="chat-search-result-item">
                      <span>Yêu cầu nạp {r.amount} GB</span>
                      <span className="chat-search-result-date">
                        {r.status === "pending" ? "Đang chờ Admin duyệt" : r.status === "approved" ? "Đã duyệt" : "Đã từ chối"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {isLeader && (
            <div className="chat-member-mute-list">
              <h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Cấm chat thành viên</h3>
              {members
                .filter((m) => m.userId !== currentUserId)
                .map((m) => (
                  <div key={m.userId} className="ws-member-row">
                    <span>{m.nickname}</span>
                    <button className="ws-btn-secondary" onClick={() => handleToggleMute(m.userId)}>
                      {mutedUserIds.has(m.userId) ? "Gỡ mute" : "Mute"}
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="cw-msgs">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble-row ${m.senderId === currentUserId ? "mine" : ""}`}>
            <div className="chat-bubble">
              {m.senderDisplayName && <div className="chat-bubble-sender">{m.senderDisplayName}</div>}
              {m.isDeleted ? (
                <em className="chat-msg-deleted">Tin nhắn đã bị xoá</em>
              ) : editingId === m.id ? (
                <div className="chat-edit-form">
                  <input className="ws-input" style={{ marginBottom: 6 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="ws-btn-primary" onClick={() => handleSaveEdit(m)}>
                      Lưu
                    </button>
                    <button className="ws-btn-secondary" onClick={() => setEditingId(null)}>
                      Huỷ
                    </button>
                  </div>
                </div>
              ) : m.type === "text" ? (
                <span>{decrypted[m.id] ?? "Đang giải mã..."}</span>
              ) : m.type === "system" ? (
                <SystemMessage
                  content={m.content}
                  conversationId={conversationId}
                  activeMeetingId={activeMeeting?.id ?? null}
                  onJoin={handleJoinMeeting}
                />
              ) : m.fileId ? (
                <FileMessageContent fileId={m.fileId} type={m.type} />
              ) : (
                <span>[{m.type}]</span>
              )}
              {m.isEdited && !m.isDeleted && <span className="chat-msg-edited"> (đã sửa)</span>}
              {!m.isDeleted && editingId !== m.id && (
                <div className="chat-msg-actions">
                  {m.senderId === currentUserId && (
                    <button className="chat-recall-btn" onClick={() => handleRecall(m.id)}>
                      Thu hồi
                    </button>
                  )}
                  {m.senderId === currentUserId && m.type === "text" && (
                    <button className="chat-recall-btn" onClick={() => startEdit(m)}>
                      Sửa
                    </button>
                  )}
                  {isLeader && m.senderId !== currentUserId && (
                    <button className="chat-recall-btn" onClick={() => handleLeaderDelete(m.id)}>
                      Xoá (Trưởng nhóm)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Dat TREN thanh soan tin chu khong nhet vao trong: thanh do la flex
          hang ngang, chen them vao se bop cac nut lai. */}
      {upload && <UploadProgressBar state={upload} />}

      {error && <p className="chat-error">{error}</p>}
      {uploading && !upload && <p className="chat-text-note">Đang gửi {uploading}…</p>}

      {conversation?.type === "group" && currentUserId && mutedUserIds.has(currentUserId) ? (
        <p className="chat-text-note">Bạn đang bị cấm chat trong nhóm này.</p>
      ) : (
        <E2eeGate>
          {publicKeys.size === 0 && (
            <p className="chat-text-note">
              {conversation?.type === "p2p"
                ? "Người này chưa thiết lập E2EE, chưa gửi được tin nhắn Text."
                : "Chưa có thành viên nào (kể cả bạn) thiết lập E2EE trong nhóm này."}
            </p>
          )}
          {missingKeyCount > 0 && conversation?.type === "group" && (
            <p className="chat-text-note">{missingKeyCount} thành viên chưa thiết lập E2EE sẽ không nhận được tin nhắn Text.</p>
          )}

          {/* MOT khung duy nhat chua ca o nhap lan cac nut dinh kem, dung nhu
              ban thiet ke - truoc day la hai thanh roi nhau xep chong len.

              Cac nut dinh kem BIEN MAT khi dang go: thiet ke ve o nhap gian tu
              455 ra 761 khi co chu, tuc nhuong cho cho viec dang lam. */}
          <form
            className="cw-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendText(e);
            }}
          >
            <textarea
              className={`cw-composer-input${textInput.length > 60 ? " tall" : ""}`}
              placeholder="Nhập tin nhắn"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              rows={1}
              disabled={publicKeys.size === 0}
              onKeyDown={(e) => {
                // Enter gui, Shift+Enter xuong dong - quy uoc quen thuoc cua
                // moi ung dung nhan tin. Khong co no thi Enter chi xuong dong
                // va nguoi dung phai voi chuot ra nut gui sau moi cau.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (textInput.trim() && !sendingText) {
                    void handleSendText(e as unknown as React.FormEvent);
                  }
                }
              }}
            />

            {textInput.trim() === "" && (
              <div className="cw-attach">
                <button type="button" className="cw-icon-btn" disabled={!!uploading} onClick={() => pickFile("voice", "audio/*")} title="Ghi âm">
                  <IconMic />
                </button>
                <button type="button" className="cw-icon-btn" disabled={!!uploading} onClick={() => pickFile("image", "image/*")} title="Ảnh">
                  <IconImage />
                </button>
                <button type="button" className="cw-icon-btn" disabled={!!uploading} onClick={() => pickFile("video", "video/*")} title="Video">
                  <IconVideo />
                </button>
                {conversation?.type === "group" && (
                  <button type="button" className="cw-icon-btn" disabled={!!uploading} onClick={() => pickFile("file", "*/*")} title="Tệp">
                    <IconAttach />
                  </button>
                )}
              </div>
            )}

            <button className="cw-send" type="submit" disabled={sendingText || textInput.trim() === ""} title="Gửi">
              <IconSend />
            </button>
          </form>
        </E2eeGate>
      )}

      {quotaAlert && (
        <AlertDialog
          title="Không đủ dung lượng nhóm"
          message={quotaAlert}
          onClose={() => setQuotaAlert(null)}
        />
      )}
        </>
      }
    />
  );
}
