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
import { AddMemberDialog } from "./AddMemberDialog";
import { Avatar } from "../../components/Avatar";
import { IconAccount, IconAttach, IconImage, IconMic, IconSend, IconStorage, IconVideo } from "./ComposerIcons";
import { Modal } from "../../components/Modal";
import "./workspace.css";
import { meetingApi } from "../../api/mediaApi";
import type { Meeting } from "../../types/media";
import { FileMessageContent, UploadingMessage } from "./FileMessageContent";
import { SystemMessage } from "./SystemMessage";
import type { Message, MessageType } from "../../types/chat";
import type { ConversationDetail } from "../../api/chatApi";
import { type UploadState } from "../../components/UploadProgressBar";
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Tin dang duoc tra loi (null = khong tra loi ai). Khoi tin trich dan hien
  // ngay tren khung soan, bam X de bo.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  // Ham huy lan tai len dang chay - do handleFileSelect gan vao.
  const cancelUploadRef = useRef<(() => void) | null>(null);

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

  // O nhap CAO LEN theo so dong, dung nhu frame "Khung nhan tin khi go chu
  // dai" (Figma 111:380: khung 83 -> 189, o nhap 49 -> 173).
  //
  // Phai dat height='auto' TRUOC khi doc scrollHeight: neu khong, scrollHeight
  // van la chieu cao dang co nen o nhap chi phinh ra chu khong bao gio co lai
  // duoc khi xoa bot chu.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    // Bo goc thu lai khi da qua mot dong (Figma 111:380: bo 98 -> 22). Xet
    // theo CHIEU CAO THAT chu khong dem so ky tu - dem ky tu thi mot cau dai
    // van nam gon mot dong o man rong lai bi doi kieu oan.
    el.classList.toggle("tall", el.scrollHeight > 70);
  }, [textInput]);

  // Mot dong tom tat cua tin duoc trich dan.
  //
  // Tin Text da giai ma roi thi lay ban ro dang co; chua giai ma xong thi noi
  // that la dang giai ma, KHONG hien ma hoa - mot cuc base64 trong khoi trich
  // dan chi lam nguoi doc hoang mang.
  function tomTat(m: Message): string {
    if (m.isDeleted) return "Tin nhắn đã được thu hồi";
    switch (m.type) {
      case "image":
        return "Ảnh";
      case "video":
        return "Video";
      case "voice":
        return "Tin nhắn thoại";
      case "file":
        return "Tệp đính kèm";
      case "system":
        return "Thông báo hệ thống";
      default:
        return decrypted[m.id] ?? "Đang giải mã…";
    }
  }

  // Cuon toi tin goc khi bam vao khoi trich dan. Tin qua cu (chua nap toi)
  // thi khong co trong DOM - bao thay vi im lang khong phan hoi gi.
  function nhayToi(id: number) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      setError("Tin nhắn gốc chưa được tải lên màn hình, hãy cuộn lên trước");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("cw-flash");
    window.setTimeout(() => el.classList.remove("cw-flash"), 1200);
  }

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
        const { data: sent } = await chatApi.sendTextMessage(conversationId, content, contentNonce, undefined, searchTokens, replyTo?.id);
        sentMessageId = sent.id;
      } else {
        const recipients = [...publicKeys.entries()].map(([userId, publicKey]) => ({ userId, publicKey }));
        const { content, contentNonce, recipientKeys, searchTokens } = await encryptTextGroup(privateKey, recipients, plaintext);
        const { data: sent } = await chatApi.sendTextMessage(conversationId, content, contentNonce, recipientKeys, searchTokens, replyTo?.id);
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
      setReplyTo(null);
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

  // Xoa nhom: chi Truong nhom. Xoa la mat het tin nhan va tep cua ca nhom nen
  // phai hoi lai - day la thao tac khong the hoan tac.
  async function handleDeleteGroup() {
    if (!conversation?.workspaceId) return;
    if (!isLeader) {
      setError("Chỉ Trưởng nhóm mới xoá được nhóm");
      return;
    }
    if (!window.confirm("Xoá nhóm này? Toàn bộ tin nhắn và tệp sẽ mất vĩnh viễn.")) return;
    try {
      await workspaceApi.remove(conversation.workspaceId);
      navigate("/app/groups");
    } catch (err) {
      setError(extractApiError(err, "Không xoá được nhóm"));
    }
  }

  async function handleRemoveMember(userId: number) {
    if (!conversation?.workspaceId) return;
    if (!window.confirm("Xoá thành viên này khỏi nhóm?")) return;
    try {
      await workspaceApi.removeMember(conversation.workspaceId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(extractApiError(err, "Không xoá được thành viên"));
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
      // Nut "Huy" tren tin nhan dang tai len goi qua ref nay. Huy = bao server
      // bo lan tai len -> tra lai dung luong ngay, khong doi bo quet.
      cancelUploadRef.current = () => {
        void track?.abort();
        setUpload(null);
        setUploading(null);
      };
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
      cancelUploadRef.current = null;
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

  // Gui duoc tin nhan CHU hay chua. Gui TEP thi khong dinh gi toi dieu nay -
  // tep khong duoc ma hoa dau cuoi.
  const coTheGuiChu = privateKey !== null && publicKeys.size > 0;

  const tenHoiThoai =
    peer?.ten ??
    (conversation?.type === "group" ? `Nhóm ${conversation.workspaceId}` : `Người dùng ${peerUserId ?? ""}`);

  return (
    <ChatWorkspace
      hasActive
      list={
        <ConversationList
          kind={conversation?.type === "group" ? "group" : "p2p"}
          activeId={conversationId}
          onStartMeeting={activeMeeting ? handleJoinMeeting : handleStartMeeting}
          meetingBusy={startingMeeting}
        />
      }
      isGroup={conversation?.type === "group"}
      info={
        <ConversationInfo
          conversationId={conversationId}
          title={tenHoiThoai}
          peerUserId={peerUserId}
          peerAvatarUpdatedAt={peer?.anh}
          dangerLabel={conversation?.type === "group" ? "Xóa nhóm" : "Xóa bạn"}
          onDanger={conversation?.type === "group" ? handleDeleteGroup : undefined}
          // `members` la co bao "day la nhom" - chi nhom moi co danh sach
          // thanh vien trong ban thiet ke.
          members={conversation?.type === "group" ? members : undefined}
          mutedUserIds={mutedUserIds}
          isLeader={isLeader}
          currentUserId={currentUserId}
          onToggleMute={handleToggleMute}
          onRemoveMember={handleRemoveMember}
          onAddMember={() => setShowAddMember(true)}
        />
      }
      chat={
        <>
      {/* Dau khung chat (Figma node 122:1248, Frame 17).
          Hai trang thai: binh thuong hien TEN, bam kinh lup thi o "Tim kiem
          tin nhan" 503x37 CHIEM CHO cua ten, kem nut X de dong. */}
      <div className="cw-card cw-head">
        {showSearch ? (
          <form className="cw-head-search" onSubmit={handleSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
              <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm tin nhắn"
              aria-label="Tìm kiếm tin nhắn"
              autoFocus
            />
            <button
              type="button"
              className="cw-head-search-x"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
                setSearchResults(null);
              }}
              aria-label="Đóng tìm kiếm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </form>
        ) : (
          <>
            <Avatar userId={peerUserId ?? 0} nickname={tenHoiThoai} avatarUpdatedAt={peer?.anh} size={68} />
            <div className="cw-card-body">
              <p className="cw-card-name">{tenHoiThoai}</p>
            </div>
          </>
        )}

        <div className="cw-head-actions">
          {!activeMeeting ? (
            <button className="cw-pill" onClick={handleStartMeeting} disabled={startingMeeting}>
              {startingMeeting ? "Đang mở…" : "Khởi tạo cuộc họp"}
            </button>
          ) : (
            <button className="cw-pill" onClick={handleJoinMeeting}>
              Vào cuộc họp
            </button>
          )}

          <button className="cw-icon-btn" onClick={() => setShowSearch((v) => !v)} title="Tìm kiếm tin nhắn">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
              <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Chi nhom moi co han muc luu tru - chat 1-1 khong tinh dung luong. */}
          {conversation?.type === "group" && (
            <button className="cw-icon-btn" onClick={toggleAdmin} title="Dung lượng nhóm">
              <IconStorage />
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

      {/* Dung luong nhom o MOT POPUP RIENG - truoc day la mot bang nhet giua
          dau khung va danh sach tin nhan, day tin nhan xuong moi lan mo. Chi
          nhom moi co han muc; chat 1-1 khong tinh dung luong. */}
      {showAdmin && conversation?.type === "group" && (
        <Modal title="Dung lượng nhóm" onClose={() => setShowAdmin(false)}>
          {!storage ? (
            <p className="md-note">Đang tải…</p>
          ) : (
            <>
              <div className={`md-gauge${storage.isLocked ? " danger" : ""}`}>
                <span
                  style={{
                    width: `${Math.min(100, Math.round((storage.usedBytes / Math.max(1, storage.quotaBytes)) * 100))}%`,
                  }}
                />
              </div>
              <div className="md-row">
                <span>
                  Đã dùng {(storage.usedBytes / 1_073_741_824).toFixed(2)} GB /{" "}
                  {(storage.quotaBytes / 1_073_741_824).toFixed(2)} GB
                </span>
                <span>Gói {storage.plan}</span>
              </div>

              {storage.isLocked && (
                <p className="md-note" style={{ color: "var(--danger)" }}>
                  Nhóm đang bị khoá vì vượt hạn mức — thu hồi bớt tệp cũ hoặc nạp thêm để mở lại.
                </p>
              )}

              {isLeader ? (
                <div className="md-actions">
                  <button className="md-btn" disabled={requestingTopup} onClick={handleRequestTopup}>
                    {requestingTopup ? "Đang gửi…" : "Xin nạp thêm 1 GB"}
                  </button>
                  {storage.isLocked && (
                    <button
                      className="md-btn md-btn-ghost"
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
              ) : (
                <p className="md-note">Chỉ Trưởng nhóm mới xin nạp thêm được dung lượng.</p>
              )}

              {topupRequests.length > 0 && (
                <div>
                  <p className="md-note">Yêu cầu đã gửi:</p>
                  {topupRequests.map((r) => (
                    <div key={r.id} className="md-row">
                      <span>Nạp {r.amount} GB</span>
                      <span className="md-note">
                        {r.status === "pending"
                          ? "Đang chờ Admin duyệt"
                          : r.status === "approved"
                            ? "Đã duyệt"
                            : "Đã từ chối"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      <div className="cw-msgs">
        {/* Dang tim thi khung tin nhan hien KET QUA thay vi lich su - khong
            chen them mot bang nua day tin nhan xuong nhu ban truoc. */}
        {searchResults !== null && (
          <div className="cw-search-results">
            <p className="cw-search-count">
              {searching
                ? "Đang tìm…"
                : searchResults.length === 0
                  ? "Không tìm thấy tin nhắn nào"
                  : `${searchResults.length} kết quả`}
            </p>
            {searchResults.map((r) => (
              <div key={r.message.id} className="cw-search-item">
                <span className="cw-search-text">{r.text}</span>
                <span className="cw-search-date">
                  {new Date(r.message.createdAt).toLocaleString("vi-VN")}
                </span>
              </div>
            ))}
          </div>
        )}

        {searchResults === null && messages.map((m) => {
          const cuaMinh = m.senderId === currentUserId;
          const suaDuoc = cuaMinh && m.type === "text" && !m.isDeleted;
          const thuHoiDuoc = cuaMinh && !m.isDeleted;
          const truongNhomXoaDuoc = isLeader && !cuaMinh && !m.isDeleted;
          return (
            <div key={m.id} id={`msg-${m.id}`} className={`cw-row${cuaMinh ? " mine" : ""}`}>
              <div className="cw-bubble-wrap">
                {m.senderDisplayName && !cuaMinh && <p className="cw-sender">{m.senderDisplayName}</p>}

                {/* Khoi trich dan tin duoc tra loi. Tim trong danh sach dang
                    co; tin qua cu (chua nap toi) thi hien chu chung thay vi
                    goi them mot request cho MOI tin co tra loi. */}
                {m.replyToId != null &&
                  (() => {
                    const goc = messages.find((x) => x.id === m.replyToId);
                    return (
                      <button
                        type="button"
                        className="cw-quote"
                        onClick={() => nhayToi(m.replyToId!)}
                        title="Tới tin nhắn gốc"
                      >
                        <span className="cw-quote-who">
                          {goc?.senderDisplayName ?? (goc?.senderId === currentUserId ? "Bạn" : "Tin nhắn")}
                        </span>
                        <span className="cw-quote-text">{goc ? tomTat(goc) : "Tin nhắn cũ"}</span>
                      </button>
                    );
                  })()}

                {m.isDeleted ? (
                  <div className="cw-bubble cw-bubble-deleted">Tin nhắn đã được thu hồi</div>
                ) : editingId === m.id ? (
                  <div className="cw-bubble">
                    <input className="ws-input" style={{ marginBottom: 6 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="cw-act" onClick={() => handleSaveEdit(m)}>
                        Lưu
                      </button>
                      <button className="cw-act" onClick={() => setEditingId(null)}>
                        Huỷ
                      </button>
                    </div>
                  </div>
                ) : m.type === "text" ? (
                  <div className="cw-bubble">
                    {decrypted[m.id] ?? "Đang giải mã…"}
                    {m.isEdited && <span className="chat-msg-edited"> (đã sửa)</span>}
                  </div>
                ) : m.type === "system" ? (
                  <SystemMessage
                    content={m.content}
                    conversationId={conversationId}
                    activeMeetingId={activeMeeting?.id ?? null}
                    onJoin={handleJoinMeeting}
                  />
                ) : m.fileId ? (
                  // KHONG boc trong .cw-bubble: anh va the tep co khuon rieng
                  // trong thiet ke (khung anh vien #85AEB0, the tep 442x92) -
                  // long them mot nen mau nua thi thanh hai lop long nhau.
                  <FileMessageContent fileId={m.fileId} type={m.type} />
                ) : (
                  <div className="cw-bubble">[{m.type}]</div>
                )}
              </div>

              {/* Chip hanh dong ben canh bong bong (Figma 111:391): 52x17, nen
                  #D2EFE6, vien #85AEB0. Chi hien khi re chuot vao hang - de
                  hien thuong truc thi moi tin deu keo theo hai cai nut. */}
              {!m.isDeleted && editingId !== m.id && (
                <div className="cw-acts cw-more">
                  <button className="cw-act" onClick={() => setReplyTo(m)}>
                    Trả lời
                  </button>
                  {suaDuoc && (
                    <button className="cw-act" onClick={() => startEdit(m)}>
                      Sửa
                    </button>
                  )}
                  {thuHoiDuoc && (
                    <button className="cw-act" onClick={() => handleRecall(m.id)}>
                      Thu hồi
                    </button>
                  )}
                  {truongNhomXoaDuoc && (
                    <button className="cw-act" onClick={() => handleLeaderDelete(m.id)}>
                      Xoá
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* Tep dang tai len hien nhu MOT TIN NHAN trong mach hoi thoai
            (Figma node 111:533) chu khong phai mot thanh rieng o duoi - kem
            nut "Huy" de dung giua chung, bam la tra lai dung luong ngay. */}
        {searchResults === null && upload && (
          <div className="cw-row mine">
            <div className="cw-bubble-wrap">
              <UploadingMessage
                name={upload.name}
                loaded={upload.loaded}
                total={upload.total}
                onCancel={() => cancelUploadRef.current?.()}
              />
            </div>
          </div>
        )}

        {searchResults === null && <div ref={bottomRef} />}
      </div>

      {error && <p className="chat-error">{error}</p>}
      {uploading && !upload && <p className="chat-text-note">Đang gửi {uploading}…</p>}

      {conversation?.type === "group" && currentUserId && mutedUserIds.has(currentUserId) ? (
        <p className="chat-text-note">Bạn đang bị cấm chat trong nhóm này.</p>
      ) : (
        <>
          {/* Man nhap mat khau ma hoa da chuyen len AppShell duoi dang popup,
              hoi ngay sau khi dang nhap. O day chi con khung soan tin. */}
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
          {/* Dang tra loi ai: hien ngay tren khung soan, bam X de bo. */}
          {replyTo && (
            <div className="cw-reply-bar">
              <span className="cw-reply-label">Đang trả lời</span>
              <span className="cw-reply-text">{tomTat(replyTo)}</span>
              <button
                type="button"
                className="cw-reply-x"
                onClick={() => setReplyTo(null)}
                aria-label="Bỏ trả lời"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}

          <form
            className="cw-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendText(e);
            }}
          >
            <textarea
              ref={composerRef}
              className="cw-composer-input"
              placeholder={coTheGuiChu ? "Nhập tin nhắn" : "Cần mở khoá E2EE để gửi tin nhắn chữ"}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              rows={1}
              disabled={!coTheGuiChu}
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

            <button className="cw-send" type="submit" disabled={sendingText || textInput.trim() === "" || !coTheGuiChu} title="Gửi">
              <IconSend />
            </button>
          </form>
        </>
      )}

      {showAddMember && conversation?.workspaceId && (
        <AddMemberDialog
          workspaceId={conversation.workspaceId}
          members={members}
          onClose={() => setShowAddMember(false)}
          onAdded={(m) => setMembers((prev) => (prev.some((x) => x.userId === m.userId) ? prev : [...prev, m]))}
        />
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
