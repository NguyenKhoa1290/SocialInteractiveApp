import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Room,
  RoomEvent,
  Track,
  createLocalScreenTracks,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { meetingApi } from "../../api/mediaApi";
import { friendApi } from "../../api/friendApi";
import { userApi } from "../../api/userApi";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { ParticipantTile } from "./ParticipantTile";
import { IptvStage } from "./IptvStage";
import { IptvChannelPicker } from "./IptvChannelPicker";
import { TUY_CHON_MAC_DINH, type TuyChonPhat } from "./IptvPlayer";
import { IptvPlayerHost } from "./IptvPlayerHost";
import { MeetingSettingsDialog } from "./MeetingSettingsDialog";
import { MeetingPeopleDialog } from "./MeetingPeopleDialog";
import { MeetingChatDialog } from "./MeetingChatDialog";
import { MeetingAppsDialog } from "./MeetingAppsDialog";
import { apLaiAmLuongMic, quenAmLuongMic } from "./micGain";
import { chatApi } from "../../api/chatApi";
import { workspaceApi } from "../../api/workspaceApi";
import {
  IconCallEnd,
  IconCamera,
  IconChatBubble,
  IconMedia,
  IconMicrophone,
  IconPagerArrow,
  IconPeople,
  IconScreenShare,
} from "./MeetingIcons";
import { IconGear } from "../../components/RailIcons";
import { joinMeetingDiscussion, leaveMeetingDiscussion, onMeetingMessageReceived } from "../../lib/chatHub";
import type {
  MeetingParticipant,
  MeetingWithCallerStatus,
  PermissionType,
  PresentationState,
  RoomMetadata,
  WaitingParticipant,
} from "../../types/media";
import type { Friend } from "../../types/friend";

function parsePresentation(metadata: string | undefined): PresentationState | null {
  if (!metadata) return null;
  try {
    return (JSON.parse(metadata) as RoomMetadata).presentation ?? null;
  } catch {
    return null;
  }
}
import "./meeting.css";

// Nhip poll phong cho / danh sach nguoi trong phong. Media Service chua co
// tang WebSocket (xem ghi chu trong MeetingsEndpoints.cs), nen danh sach
// nguoi cho duyet va quyen mini_app chi cap nhat duoc bang poll.
const POLL_MS = 4000;

// Vua duoc nhan vao phong thi con phai bat tay WebRTC vai giay moi hien ra
// ben LiveKit - trong khoang do van hien ho trong danh sach.
const CONNECT_GRACE_MS = 20000;

// Hang doi TUAN TU HOA moi thao tac ket noi/ngat phong.
//
// Bug that: React StrictMode (dev) goi effect 2 LAN. Truoc day moi lan tao 1
// Room rieng va chay song song, gay 2 hau qua nghiem trong:
//  1. Ca 2 Room dung CUNG identity (= userId) nen LiveKit coi ban moi la
//     phien trung -> DUOI ban cu ra ("client leave request received",
//     "publisher data channel closed unexpectedly", sctpCauseCode 12).
//  2. Ca 2 cung doi camera -> ban thu hai luon nhan NotReadableError
//     ("Could not start video source") DU KHONG CO ung dung nao khac dung
//     camera. Day chinh la ly do camera "luon bao bi chiem du khong ai bat".
//
// Noi tiep qua 1 promise dung chung: viec ngat phong cu LUON chay xong TRUOC
// khi viec ket noi phong moi bat dau, nen chi co dung 1 Room song tai mot
// thoi diem va camera duoc nha hoan toan truoc khi doi lai.
let connectionChain: Promise<void> = Promise.resolve();

export function MeetingRoomPage() {
  const { id } = useParams();
  const meetingId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const nickname = useAuthStore((s) => s.user?.nickname);

  // Token LiveKit co the da duoc trang truoc (tao hop / vao bang link) lay
  // san va truyen qua router state - dung lai de khoi goi thua 1 vong.
  const initialToken = (location.state as
    | { livekitToken?: string; livekitUrl?: string; inviteLink?: string; linkDaChep?: boolean }
    | null) ?? null;

  const roomRef = useRef<Room | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const [version, setVersion] = useState(0); // ep render lai tile khi LiveKit ban su kien
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "left" | "ended">("connecting");
  const [error, setError] = useState<string | null>(null);
  // Canh bao KHONG chi mang (vd khong mo duoc camera) - phong van dung
  // duoc, khac han "error" la truong hop hong han khong vao duoc phong.
  const [notice, setNotice] = useState<string | null>(null);

  const [meeting, setMeeting] = useState<MeetingWithCallerStatus | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [waiting, setWaiting] = useState<WaitingParticipant[]>([]);
  // Phong hop tuy chinh duoc tao kem link ngay tu cu bam o danh sach ban be,
  // nen link co san tu day - khong bat host phai bam "Tao link" lan nua.
  const [inviteLink, setInviteLink] = useState<string | null>(initialToken?.inviteLink ?? null);
  const [dangDoiDuyet, setDangDoiDuyet] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<number>>(new Set());
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  // Popup chon kenh - CHI nguoi trinh bay mo. Kenh dang chieu KHONG nam o
  // day ma nam trong presentation (trang thai chung cua phong), nen doi bo
  // cuc hay dong popup deu khong lam mat no.
  const [showIptvPicker, setShowIptvPicker] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showApps, setShowApps] = useState(false);
  // Lua chon phat IPTV cua RIENG may nay (do phan giai, luong tieng, khoa
  // giai ma). Moi nguoi trong phong tu tai luong rieng nen ai xem o muc nao
  // la viec cua nguoi do - khong gui len server.
  const [tuyChonPhat, setTuyChonPhat] = useState<TuyChonPhat>(TUY_CHON_MAC_DINH);
  // "Che do tiet kiem du lieu" trong popup Cai dat: KHONG tai video cua ai ve
  // may nay ca. Thay cho nut "tat camera nguoi nay cho do mang" theo tung
  // nguoi cua ban cu - ban thiet ke gop lai thanh mot cong tac chung.
  const [tietKiem, setTietKiem] = useState(() => localStorage.getItem("meet-tiet-kiem") === "1");
  // Ten + anh cua nhom so huu cuoc hop, chi de dat dau popup nhan tin. Media
  // Service khong biet nhung thu nay nen phai hoi Chat roi hoi WorkSpace.
  const [nhomCuaHop, setNhomCuaHop] = useState<{ id: number; ten: string; anh: string | null } | null>(null);
  // userId -> moc doi anh dai dien. Media Service khong luu thu nay (no chi
  // biet userId + nickname cua nguoi trong phong), ma thieu no thi avatarUrl()
  // tra null va o nao cung chi hien duoc chu cai dau.
  const [anhCua, setAnhCua] = useState<Record<number, string | null>>({});
  // So tin nhan den TRONG LUC panel thao luan dang dong - cham do tren nut
  // chat o thanh doc (Figma goi frame do la "khi co thong bao").
  const [chuaDocChat, setChuaDocChat] = useState(0);

  // Vao phong la TAT san mic va camera - nguoi dung tu bat khi muon noi.
  // Ngoai chuyen te nhi, no con bo luon canh trinh duyet hoi quyen thiet bi
  // ngay giay dau tien va canh tranh camera voi tab cu khi F5
  // (NotReadableError), vi khong con ai doi mo thiet bi luc vao phong.
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Ai dang trinh bay - doc tu metadata cua phong LiveKit. KHONG poll REST:
  // LiveKit tu ban RoomMetadataChanged cho ca phong, va nguoi vao muon doc
  // duoc ngay tu room.metadata luc ket noi.
  const [presentation, setPresentation] = useState<PresentationState | null>(null);
  // CUC BO cho rieng nguoi dung nay - khong gui len server, khong ai khac
  // bi anh huong. Ghim ai thi nguoi do len khung trung tam o MAN HINH CUA
  // TOI thoi.
  const [pinnedUserId, setPinnedUserId] = useState<number | null>(null);
  // Nguoi dung tu chon xem dang luoi du dang co nguoi trinh chieu - focus
  // mode la TU DONG chu khong bat buoc.
  const [gridOverride, setGridOverride] = useState(false);
  // UC-34 1d/1e - deu la thao tac CLIENT-SIDE theo dung dac ta, moi nguoi tu
  // chinh cho rieng minh, khong ai khac bi anh huong va khong luu len server.
  const [volumes, setVolumes] = useState<Record<number, number>>({});

  // Phan trang luoi. Ly do khong phai tham my ma la BAT BUOC ky thuat: phong
  // 100 nguoi ma render het thi moi may phai giai ma ~99 luong video cung
  // luc - trinh duyet dung truoc khi kip lo tien. Chi o nao DANG HIEN moi
  // duoc subscribe; phan con lai huy dang ky nen LiveKit khong gui toi day.
  const [page, setPage] = useState(0);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Dong ho o thanh tren dem THOI GIAN DA HOP, khong phai gio treo tuong.
  // Moc la luc cuoc hop mo (meeting.createdAt) chu khong phai luc toi vao:
  // ai vao muon cung phai thay cuoc hop da chay bao lau roi.
  const [nhipGiay, setNhipGiay] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNhipGiay(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const daHop = (() => {
    if (!meeting?.createdAt) return "00:00:00";
    const giay = Math.max(0, Math.floor((nhipGiay - new Date(meeting.createdAt).getTime()) / 1000));
    const hai = (n: number) => String(n).padStart(2, "0");
    return `${hai(Math.floor(giay / 3600))}:${hai(Math.floor(giay / 60) % 60)}:${hai(giay % 60)}`;
  })();

  const isHost = meeting !== null && currentUserId === meeting.hostId;

  // Bao mot lan luc vao phong. Dat o day chu khong o trang truoc: bam xong la
  // roi trang do ngay, thong bao hien ben do thi khong ai kip doc.
  useEffect(() => {
    // Bao trong CA HAI truong hop. Neu chep hong (trinh duyet chan quyen,
    // hoac trang khong duoc focus) ma im lang thi nguoi dung vua bam mot cai
    // ra thang phong hop, khong biet co link nao ton tai - luong "ba cu bam"
    // chet ngay o day.
    if (initialToken?.linkDaChep) {
      setNotice("Đã chép link mời vào clipboard - dán cho người bạn muốn mời là họ vào thẳng.");
    } else if (initialToken?.inviteLink) {
      setNotice("Chưa chép được link tự động - mở “Người tham gia” để lấy link mời.");
    }
    // Chi chay mot lan luc mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bat/tat phong cho giua chung. Cap nhat tai cho thay vi doi vong poll sau:
  // host vua bam thi phai thay ngay minh vua bat cai gi.
  // LUU Y - hai danh sach, dung sai cho la sinh loi:
  //
  //   participants        = bang meeting_participants tu API. La SO SACH:
  //                         dung de tra ten, tra quyen, biet ai co ho so
  //                         trong cuoc hop nay.
  //   presentParticipants = trong so do, ai DANG THUC SU ket noi. La cai
  //                         MAT NGUOI DUNG NHIN THAY.
  //
  // Hai cai lech nhau vi backend co y doi 60 giay truoc khi ghi nhan mot
  // nguoi da roi (de khong duoi nham nguoi dang F5 hay dang noi lai mang -
  // xem ParticipantReconciler.cs). Doi thi dung cho SO SACH, nhung khong the
  // bat nguoi xem cho: o video cua ho da bien mat ngay roi, danh sach van
  // con ten thi trong nhu he thong dem sai.
  //
  // Nen giao dien bam theo LiveKit - cung dung nguon voi cac o video, nen
  // hai cho khong bao gio le nhau nua.
  const myPermissions = participants.find((p) => p.userId === currentUserId)?.permissions ?? [];
  const liveUserIds = new Set<number>();
  if (room) {
    // Chinh minh khong nam trong remoteParticipants.
    if (currentUserId != null) liveUserIds.add(currentUserId);
    for (const rp of remotes) liveUserIds.add(Number(rp.identity));
  }

  const presentParticipants =
    status === "connected" && room
      ? participants.filter(
          (p) =>
            liveUserIds.has(p.userId) ||
            // Vua duoc duyet vao, chua kip noi LiveKit (mat vai giay). Khong
            // chua cho nay thi chu phong bam Duyet xong lai thay nguoi do
            // bien mat mot lat roi hien lai - trong nhu loi.
            Date.now() - new Date(p.joinedAt).getTime() < CONNECT_GRACE_MS,
        )
      : participants;

  // Hai tang chong len nhau, doc giong het ben server (xem
  // ParticipantsEndpoints.LoadPublishFlagsAsync): MAC DINH CUA PHONG truoc,
  // rieng tung nguoi de bep len tren. Chu phong luon duoc phep.
  //
  // Mo ung dung thi KHONG cap le tung nguoi nua - la quyet dinh cua ca phong,
  // dung theo ban thiet ke 140:645.
  const canUseMiniApp = isHost || (meeting?.allowMiniApp ?? false);
  const canShareScreen =
    isHost || ((meeting?.allowScreenShare ?? true) && !myPermissions.includes("no_screen_share"));
  // Mac dinh ai cung bat duoc mic/camera - chu phong THU quyen thi moi co
  // hang trong meeting_permissions. Day chi la de hien dung giao dien; cho
  // chan that su la LiveKit (xem LiveKitService.ApplyPublishPermissionsAsync),
  // vi an nut chi ngan nguoi dung binh thuong.
  const micAllowed = isHost || ((meeting?.allowMic ?? true) && !myPermissions.includes("no_mic"));
  const camAllowed = isHost || ((meeting?.allowCamera ?? true) && !myPermissions.includes("no_camera"));

  // --- Ket noi phong -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let created: Room | null = null;

    async function connect() {
      // Lan chay bi StrictMode huy da duoc danh dau cancelled TRUOC khi
      // toi luot no trong hang doi -> bo qua han, khong tao Room, khong
      // dong toi camera.
      if (cancelled) return;
      try {
        let token = initialToken?.livekitToken ?? null;
        let url = initialToken?.livekitUrl ?? null;

        if (!token) {
          // Tai lai trang / vao thang bang URL: xin lai token. Uu tien
          // /join (thanh vien nhom + host luon vao lai duoc); neu that bai
          // thi thu doc token dang cho trong Redis qua GET /meetings/{id}
          // (truong hop vua duoc host duyet tu phong cho - token chi doc
          // duoc DUNG 1 LAN).
          try {
            const res = await meetingApi.joinInChat(meetingId, nickname);
            token = res.data.livekitToken;
            url = res.data.livekitUrl;
          } catch {
            const res = await meetingApi.get(meetingId);
            if (res.data.callerStatus === "approved" && res.data.livekitToken) {
              token = res.data.livekitToken;
              url = res.data.livekitUrl;
            }
          }
        }

        if (!token || !url) {
          if (!cancelled) {
            setStatus("error");
            setError("Không lấy được quyền vào phòng họp. Bạn cần được mời hoặc là thành viên của nhóm.");
          }
          return;
        }

        const r = new Room({ adaptiveStream: true, dynacast: true });
        created = r;

        const bump = () => setVersion((v) => v + 1);
        const syncRemotes = () => {
          setRemotes([...r.remoteParticipants.values()]);
          bump();
        };

        r.on(RoomEvent.ParticipantConnected, syncRemotes)
          .on(RoomEvent.ParticipantDisconnected, syncRemotes)
          .on(RoomEvent.TrackSubscribed, syncRemotes)
          .on(RoomEvent.TrackUnsubscribed, syncRemotes)
          .on(RoomEvent.TrackMuted, bump)
          .on(RoomEvent.TrackUnmuted, bump)
          .on(RoomEvent.LocalTrackPublished, bump)
          .on(RoomEvent.LocalTrackUnpublished, bump)
          .on(RoomEvent.RoomMetadataChanged, (metadata) => {
            setPresentation(parsePresentation(metadata));
          })
          .on(RoomEvent.Disconnected, () => {
            if (!cancelled) setStatus("left");
          });

        await r.connect(url, token);
        if (cancelled) {
          await r.disconnect();
          return;
        }

        // Bat mic va cam RIENG BIET (khong dung enableCameraAndMicrophone):
        // ham gop that bai nguyen khoi, nen camera dang bi ung dung khac
        // chiem (NotReadableError) se lam mat LUON ca mic du mic hoan toan
        // ranh - loi that gap khi test. Tu choi quyen/thiet bi ban deu
        // khong duoc coi la loi ket noi: van vao phong duoc, chi bao ro cho
        // nguoi dung biet cai gi khong bat duoc.
        // Thu lai 1 lan sau 700ms neu that bai: khi tai lai trang, ban
        // trang CU chua kip nha camera/mic thi ban MOI da doi -> Chrome nem
        // NotReadableError du khong he co ung dung nao khac dung thiet bi.
        // KHONG bat mic/camera o day. Truoc day co, va no keo theo ba phien
        // toai: trinh duyet hoi quyen thiet bi ngay giay dau tien, tab cu
        // chua kip nha camera khi F5 nen bao NotReadableError, va ai vao hop
        // cung phat tieng phong minh ra ca phong. Nguoi dung tu bam bat -
        // xem toggleDevice, no bao loi tu te khi thiet bi bi chiem.

        roomRef.current = r;
        setRoom(r);
        setRemotes([...r.remoteParticipants.values()]);
        // Nguoi vao MUON: doc ngay trang thai trinh bay dang co san trong
        // metadata, khong phai cho su kien tiep theo moi biet.
        setPresentation(parsePresentation(r.metadata));
        setStatus("connected");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(extractApiError(err, "Không kết nối được tới phòng họp"));
        }
      }
    }

    // Noi vao hang doi thay vi chay ngay: dam bao lan ket noi nay chi bat
    // dau sau khi lan truoc da NGAT XONG HAN (da nha camera/mic).
    connectionChain = connectionChain.then(connect).catch(() => {});

    return () => {
      cancelled = true;
      roomRef.current = null;
      // Ngat phong cung phai xep hang - neu goi truc tiep o day, no se chay
      // TRONG LUC connect() cua chinh lan nay con dang do (Room chua kip gan
      // vao `created`), khien phong cu khong bao gio duoc dong tu te va van
      // giu camera.
      connectionChain = connectionChain
        .then(async () => {
          await created?.disconnect();
          created = null;
        })
        .catch(() => {});
    };
  }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Poll trang thai phia server ----------------------------------------
  const refresh = useCallback(async () => {
    try {
      const [meetingRes, peopleRes] = await Promise.all([
        meetingApi.get(meetingId),
        meetingApi.listParticipants(meetingId),
      ]);
      setMeeting(meetingRes.data);
      setParticipants(peopleRes.data);

      // Cuoc hop da bi ket thuc (host bam "Ket thuc cho tat ca", hoac phong
      // da tan). Truoc day khong kiem tra: man hinh cu dung yen, hien
      // "Nguoi tham gia (0)" va moi thao tac deu that bai 404 ma khong noi
      // ly do - nguoi dung khong hieu chuyen gi dang xay ra.
      if (meetingRes.data.status === "ended") {
        await roomRef.current?.disconnect();
        setStatus("ended");
        return;
      }

      if (meetingRes.data.hostId === currentUserId) {
        const waitRes = await meetingApi.listWaitingRoom(meetingId);
        setWaiting(waitRes.data);
      }
    } catch {
      // loi tam thoi khi poll khong nen lam hong phong dang goi
    }
  }, [meetingId, currentUserId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // KHONG goi /leave khi trang dong (truoc day co, da go bo).
  //
  // Bug that da gap: handler `pagehide` chay ca khi TAI LAI TRANG (F5, Vite
  // tu reload sau khi sua code, dieu huong). No goi /leave -> set left_at ->
  // trigger trg_close_meeting_if_empty thay phong rong -> KET THUC LUON cuoc
  // hop. Hau qua: nguoi dung F5 mot cai la ca cuoc hop chet, quay lai thi
  // "Nguoi tham gia (0)" va khong tao duoc link moi (phong da ended).
  // Tai lai trang KHONG PHAI la roi phong.
  //
  // No con gay them loi camera: trang cu chua kip nha camera thi trang moi
  // da doi -> NotReadableError.
  //
  // Doi lai, "roi phong" chi con duoc ghi nhan khi nguoi dung BAM NUT roi
  // phong / bi kick / host ket thuc. Truong hop dong tab thang thi dua vao
  // LiveKit: no tu don phong rong sau EmptyTimeout roi GET /meetings/active
  // se tu danh dau cuoc hop la ended (xem MeetingsEndpoints.cs).

  // Bi thu quyen ngay khi dang bat: LiveKit da tat track ben server roi,
  // nhung state cua nut o day van dang "dang bat" - phai keo ve cho khop,
  // neu khong nguoi dung tuong minh van dang noi.
  useEffect(() => {
    if (!room) return;
    if (!micAllowed && micOn) {
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      setMicOn(false);
      setNotice("Chủ phòng vừa thu quyền bật micro của bạn.");
    }
    if (!camAllowed && camOn) {
      void room.localParticipant.setCameraEnabled(false).catch(() => {});
      setCamOn(false);
      setNotice("Chủ phòng vừa thu quyền bật camera của bạn.");
    }
  }, [room, micAllowed, camAllowed, micOn, camOn]);

  // --- Dieu khien --------------------------------------------------------
  // Bat/tat thiet bi CO THE that bai that su (NotReadableError khi camera
  // dang bi ung dung khac giu, NotAllowedError khi bi tu choi quyen). Truoc
  // day khong bat loi nen loi roi tu do thanh unhandled rejection: nguoi
  // dung bam nut va KHONG THAY GI XAY RA, khong biet tai sao.
  async function toggleDevice(kind: "mic" | "cam") {
    if (!room) return;
    // Bao ngay thay vi de LiveKit tu choi am tham - nguoi dung bam nut ma
    // khong thay gi xay ra la kho chiu nhat.
    if ((kind === "mic" && !micAllowed) || (kind === "cam" && !camAllowed)) {
      setNotice(`Chủ phòng đã thu quyền bật ${kind === "mic" ? "micro" : "camera"} của bạn.`);
      return;
    }
    const next = kind === "mic" ? !micOn : !camOn;
    setNotice(null);
    try {
      if (kind === "mic") {
        await room.localParticipant.setMicrophoneEnabled(next);
        setMicOn(next);
        // Track mic vua duoc tao xong - gio moi gan duoc bo khuech dai neu
        // nguoi dung da keo thanh "Am luong micro cua ban" tu truoc.
        if (next) await apLaiAmLuongMic(room);
      } else {
        await room.localParticipant.setCameraEnabled(next);
        setCamOn(next);
      }
      setVersion((v) => v + 1);
    } catch (err) {
      const name = (err as Error)?.name;
      const device = kind === "mic" ? "micro" : "camera";
      setNotice(
        name === "NotAllowedError"
          ? `Trình duyệt đang chặn quyền ${device}. Bấm vào biểu tượng khoá trên thanh địa chỉ để cấp quyền.`
          : `Không mở được ${device} - thiết bị đang bị ứng dụng khác (Zoom/Teams/OBS…) hoặc một tab khác chiếm dụng. Đóng ứng dụng đó rồi thử lại.`,
      );
    }
  }

  const toggleMic = () => toggleDevice("mic");
  const toggleCam = () => toggleDevice("cam");

  async function toggleShare() {
    if (!room) return;
    setNotice(null);
    if (sharing) {
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch {
        // dung trinh chieu that bai thi coi nhu da dung o phia UI
      }
      // Nha suat trinh bay de nguoi khac dung duoc.
      try {
        await meetingApi.stopPresentation(meetingId);
      } catch {
        // khong nha duoc thi host van go duoc ho
      }
      setSharing(false);
      setVersion((v) => v + 1);
      return;
    }

    // Mo hop chon man hinh va gianh suat trinh bay CUNG LUC, khong noi tiep.
    //
    // Ban cu goi API truoc roi moi mo hop chon -> nguoi dung nhin nut dong
    // bang vai giay truoc khi thay bat cu thu gi (do that: hon 3 giay, vi
    // moi loi goi LiveKit Cloud tu server nha ton ~1250ms). Chay song song
    // thi hop chon hien ra ngay, va viec gianh suat xong tu luc nao khong ai
    // biet - nguoi dung con dang chon cua so.
    //
    // Con mot ly do nua quan trong hon toc do: getDisplayMedia YEU CAU
    // "transient user activation". Goi no sau mot await dai la dat cuoc vao
    // viec quyen do chua het han - de vo o trinh duyet khac.
    const claim = meetingApi.startPresentation(meetingId, "screen");
    // Bat loi ngay de tranh unhandled rejection neu nhanh duoi thoat truoc.
    claim.catch(() => {});

    let tracks;
    try {
      // audio: true = keo ca TIENG cua cua so dang chia se (tab Chrome,
      // hoac ca may tren Windows). Trinh duyet chi kem am thanh khi nguoi
      // dung tich o "Chia se am thanh" trong hop chon - khong tich thi chi co
      // track hinh, va publishTrack ben duoi van chay dung.
      //
      // Token LiveKit da co san screen_share_audio trong danh sach nguon duoc
      // phep (xem LiveKitService.GenerateAccessToken), nen khong phai xin
      // them quyen gi.
      tracks = await createLocalScreenTracks({ audio: true });
    } catch {
      // Nguoi dung bam Huy o hop chon man hinh - khong phai loi. Tra lai
      // suat vua gianh, neu khong ca phong se ket o focus mode voi mot man
      // hinh trong.
      claim.then(() => meetingApi.stopPresentation(meetingId).catch(() => {})).catch(() => {});
      return;
    }

    try {
      // Chi mot nguoi duoc trinh bay mot luc (giong Teams). Nguoi khac dang
      // trinh bay -> 409, khong de len nguoi ta.
      await claim;
    } catch (err) {
      // Thua cuoc: da chon man hinh roi nhung khong duoc phep - phai dong
      // track lai, neu khong camera/man hinh van sang den bao dang chia se.
      tracks.forEach((t) => t.stop());
      setNotice(extractApiError(err, "Không bắt đầu trình chiếu được"));
      return;
    }

    try {
      await Promise.all(tracks.map((t) => room.localParticipant.publishTrack(t)));
      setSharing(true);
      setVersion((v) => v + 1);
    } catch {
      tracks.forEach((t) => t.stop());
      await meetingApi.stopPresentation(meetingId).catch(() => {});
    }
  }

  // Dung trinh bay - nguoi dang trinh bay tu dung, hoac Chu phong go ket khi
  // nguoi kia mat mang ma khong kip tat.
  // Mo Mini App = gianh suat trinh bay TRUOC (ca phong vao focus mode), roi
  // mo popup chon kenh. Chua chon kenh thi khung giua hien "Dang cho gan
  // link kenh" - o may nguoi khac cung vay.
  async function handleOpenMiniApp() {
    setNotice(null);
    try {
      await meetingApi.startPresentation(meetingId, "mini_app", { appId: "iptv" });
      setShowIptvPicker(true);
    } catch (err) {
      setNotice(extractApiError(err, "Không mở được Mini App"));
    }
  }

  // Chon kenh = cap nhat lai chinh suat trinh bay dang giu (server cho phep
  // nguoi dang trinh bay ghi de chinh minh). Nho vay kenh di theo duong phat
  // san co toi moi nguoi trong phong, khong can them kenh dong bo nao.
  async function handlePickChannel(channelId: number, channelName: string) {
    setShowIptvPicker(false);
    try {
      await meetingApi.startPresentation(meetingId, "mini_app", { appId: "iptv", channelId, channelName });
    } catch (err) {
      setNotice(extractApiError(err, "Không đổi được kênh"));
    }
  }


  async function handleStopPresentation() {
    try {
      if (sharing) {
        await roomRef.current?.localParticipant.setScreenShareEnabled(false).catch(() => {});
        setSharing(false);
      }
      await meetingApi.stopPresentation(meetingId);
      setPresentation(null);
    } catch (err) {
      setNotice(extractApiError(err, "Không dừng trình bày được"));
    }
  }

  async function handleLeave() {
    quenAmLuongMic();
    await roomRef.current?.disconnect();
    try {
      await meetingApi.leave(meetingId);
    } catch {
      // van roi phong o phia client du server tra loi
    }
    navigate(-1);
  }

  async function handleEnd() {
    if (!confirm("Kết thúc cuộc họp cho tất cả mọi người?")) return;
    try {
      await meetingApi.end(meetingId);
      await roomRef.current?.disconnect();
      navigate(-1);
    } catch (err) {
      setError(extractApiError(err, "Không kết thúc được cuộc họp"));
    }
  }

  // UC-32 "moi ban be": loi moi type=direct khoa dung 1 nguoi (nguoi khac
  // cam link cung khong vao duoc) va KHONG phai qua phong cho, vi chu phong
  // da chu dong chon dung nguoi. Ban duoc moi nhan link ngay trong khung
  // chat 1-1 - xem InvitesEndpoints.cs ben Media Service.
  async function handleInviteFriend(friend: Friend) {
    setInvitingId(friend.userId);
    setError(null);
    try {
      await meetingApi.createInvite(meetingId, "direct", friend.userId);
      setInvitedIds((prev) => new Set(prev).add(friend.userId));
      setNotice(`Đã gửi lời mời tới ${friend.nickname}`);
    } catch (err) {
      setError(extractApiError(err, "Không mời được bạn này"));
    } finally {
      setInvitingId(null);
    }
  }



  async function handleApprove(userId: number) {
    try {
      await meetingApi.approveWaiting(meetingId, userId);
      await refresh();
    } catch (err) {
      setError(extractApiError(err, "Không duyệt được"));
    }
  }

  async function handleDeny(userId: number) {
    try {
      await meetingApi.denyWaiting(meetingId, userId);
      await refresh();
    } catch (err) {
      setError(extractApiError(err, "Không từ chối được"));
    }
  }

  async function handleKick(userId: number) {
    if (!confirm("Mời người này ra khỏi phòng?")) return;
    try {
      await meetingApi.kick(meetingId, userId);
      await refresh();
    } catch (err) {
      setError(extractApiError(err, "Không mời ra được"));
    }
  }

  // Chi con 2 quyen co duong dung that. `focus_mode` van con trong schema
  // nhung khong endpoint nao kiem tra nua - ghim la thao tac cuc bo cua
  // tung nguoi, khong can cap phep.
  // Dung chung cho ca quyen CAP (share_screen, mini_app) lan quyen THU
  // (no_mic, no_camera): ca hai deu la "co hang thi xoa, khong co thi them",
  // chi khac nghia cua viec co hang. Xem types/media.ts.
  async function handleTogglePermission(p: MeetingParticipant, perm: PermissionType) {
    try {
      if (p.permissions.includes(perm)) await meetingApi.revokePermission(meetingId, p.userId, perm);
      else await meetingApi.grantPermission(meetingId, p.userId, perm);
      await refresh();
    } catch (err) {
      setError(extractApiError(err, "Không đổi được quyền"));
    }
  }

  // Hai nut do o dau danh sach thanh vien. Tat MOT LAN, khong thu quyen -
  // moi nguoi bat lai duoc ngay sau do. Muon cam han thi dung cong tac cua
  // phong o trang "Cai dat phong".
  async function handleMuteAll(mic: boolean, camera: boolean) {
    try {
      await meetingApi.muteAll(meetingId, mic, camera);
      setNotice(mic ? "Đã tắt mic của mọi người." : "Đã tắt camera của mọi người.");
    } catch (err) {
      setError(extractApiError(err, "Không tắt được"));
    }
  }

  async function handleDoiCaiDatPhong(patch: {
    requiresApproval?: boolean;
    allowCamera?: boolean;
    allowMic?: boolean;
    allowScreenShare?: boolean;
    allowMiniApp?: boolean;
  }) {
    setDangDoiDuyet(true);
    try {
      const { data } = await meetingApi.update(meetingId, patch);
      // Ghep vao ban dang giu chu khong thay han: `meeting` con co
      // callerStatus/livekitToken ma PATCH khong tra ve.
      setMeeting((truoc) => (truoc ? { ...truoc, ...data } : truoc));
    } catch (err) {
      setError(extractApiError(err, "Không đổi được cài đặt phòng"));
    } finally {
      setDangDoiDuyet(false);
    }
  }

  // Ban thiet ke gop "tao link" va "chep link" thanh mot nut. Chua co link
  // thi tao roi chep luon - khong bat nguoi dung bam hai lan.
  async function handleLayVaChepLink() {
    let link = inviteLink;
    if (!link) {
      try {
        const res = await meetingApi.createInvite(meetingId, "link");
        link = `${window.location.origin}/meetings/join/${res.data.inviteToken}`;
        setInviteLink(link);
      } catch (err) {
        setError(extractApiError(err, "Không tạo được link mời"));
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Đã chép link mời.");
    } catch {
      // Trinh duyet tu choi quyen ghi clipboard - hien thang link ra de chep tay.
      setNotice(`Trình duyệt không cho chép tự động - link mời: ${link}`);
    }
  }

  // --- Render ------------------------------------------------------------
  // LUU Y: cac nhanh thoat som (loi / da roi / da ket thuc) nam o CUOI, ngay
  // truoc return chinh - KHONG dat o day. Truoc day chung dung o day, nen
  // moi useEffect ben duoi deu bi bo qua khi status doi sang "left"/"ended":
  // React thay so hook giam giua hai lan render va nem loi "Rendered fewer
  // hooks than expected". Moi hook phai chay o MOI duong render.
  const nameOf = (p: Participant) => {
    const id = Number(p.identity);
    return participants.find((x) => x.userId === id)?.nickname ?? (p.name || p.identity);
  };

  const nameOfUserId = (userId: number) =>
    participants.find((x) => x.userId === userId)?.nickname ?? (userId === currentUserId ? (nickname ?? "Bạn") : `#${userId}`);

  // Nguoi dang trinh bay man hinh (de dua track cua ho len khung trung tam).
  // identity ben LiveKit = userId dang chuoi, xem LiveKitService.cs.
  const findParticipant = (userId: number | null | undefined): Participant | undefined => {
    if (userId == null) return undefined;
    if (userId === currentUserId) return room?.localParticipant;
    return remotes.find((p) => Number(p.identity) === userId);
  };

  // Ai len khung trung tam, theo thu tu uu tien:
  //   1. Luot TRINH BAY dang dien ra (chia se man hinh, hoac Mini App)
  //   2. Nguoi TOI tu ghim
  //
  // Trinh bay DUNG TREN ghim, khong phai nguoc lai. Truoc day ghim thang, va
  // do la cho hong: dang phat IPTV ma bam vao mot o thi khung trinh bay bien
  // mat - the <video> bi go khoi bo cuc, luong dut. Gio suot luot trinh bay
  // ghim bi tat han (xem onGhim ben duoi) va con so ghim cu bi xoa khi luot
  // moi bat dau, nen hai thu khong bao gio tranh cho nhau.
  //
  // Ghim va viec thoat che do tap trung deu la trang thai CUC BO cua tung
  // nguoi - khong gui len server, khong anh huong ai khac.
  const coTrinhBay = presentation !== null;
  const pinnedParticipant = coTrinhBay ? undefined : findParticipant(pinnedUserId);
  const autoFocusParticipant =
    presentation?.kind === "screen" && !gridOverride ? findParticipant(presentation.userId) : undefined;

  const stageParticipant = autoFocusParticipant ?? pinnedParticipant;
  // Khung lon dang chieu MAN HINH hay khuon mat? Ghim mot nguoi la muon xem
  // NGUOI do; focus tu dong khi ai do trinh chieu la muon xem MAN HINH.
  const stageIsScreen = Boolean(autoFocusParticipant);
  const showAppStage = presentation?.kind === "mini_app" && !gridOverride;
  const inFocusLayout = Boolean(stageParticipant) || showAppStage;

  // Chu cua khung lon: nguoi dang chia se man hinh, hoac nguoi minh ghim.
  const stageUserId = stageIsScreen ? (presentation?.userId ?? null) : pinnedUserId;

  // Moi LUOT TRINH BAY MOI thi tra lai che do tu dong. Viec bam "Xem dang
  // luoi" chi ap dung cho luot dang dien ra, khong phai tat focus mode vinh
  // vien: neu khong, thoat mot lan la nhung lan sau nguoi khac trinh chieu
  // minh cung khong duoc dua vao khung trinh bay nua.
  const presentationKey = presentation
    ? `${presentation.userId}:${presentation.kind}:${presentation.startedAt}`
    : null;
  useEffect(() => {
    setGridOverride(false);
    // Xoa luon con so ghim cu. Ghim bi tat trong luc trinh bay, nhung nguoi
    // dung co the da ghim ai do TRUOC khi luot nay bat dau - de lai thi vua
    // het trinh bay la khung lon nhay sang mot nguoi ho khong con nho la
    // minh da ghim.
    setPinnedUserId(null);
  }, [presentationKey]);

  // UC-34 1d: chinh am luong CUA NGUOI KHAC o phia minh. LiveKit ap thang
  // vao track audio dang phat cua nguoi do, khong dung <audio volume> nen
  // van dung khi track duoc gan/thao lai.
  function handleVolume(userId: number, volume: number) {
    setVolumes((prev) => ({ ...prev, [userId]: volume }));
    const p = remotes.find((x) => Number(x.identity) === userId);
    p?.setVolume(volume);
  }

  // Ap lai am luong da chinh moi khi danh sach nguoi trong phong doi. Can
  // thiet vi khi mot nguoi thoat roi vao lai, LiveKit tao doi tuong
  // RemoteParticipant MOI -> am luong ve mac dinh 1, trong khi thanh truot
  // cua minh van hien muc cu (nhin 50% ma nghe 100%).
  useEffect(() => {
    for (const p of remotes) {
      const v = volumes[Number(p.identity)];
      if (v !== undefined) p.setVolume(v);
    }
  }, [remotes, volumes]);

  // Tu bo ghim khi nguoi bi ghim roi phong - neu khong, khung trung tam ket
  // o mot o trong mai cho toi khi nguoi dung tu bam bo.
  useEffect(() => {
    if (pinnedUserId === null) return;
    if (pinnedUserId === currentUserId) return; // chinh minh thi luon con day
    const stillHere = remotes.some((p) => Number(p.identity) === pinnedUserId);
    if (!stillHere) setPinnedUserId(null);
  }, [remotes, pinnedUserId, currentUserId]);

  // --- Phan trang luoi ----------------------------------------------------

  // Ngoai o cua tung nguoi con co O AO: man hinh dang chia se, va Mini App
  // IPTV. Truoc day o dang luoi thi ca hai deu BIEN MAT - man hinh chia se
  // thi chiem luon o cua nguoi trinh bay (nen ca phong khong con thay mat
  // ho), con IPTV thi khong hien o dau ca.
  type Tile =
    | { kind: "participant"; key: string; participant: Participant; isLocal: boolean; userId: number }
    | { kind: "screen"; key: string; participant: Participant; isLocal: boolean; userId: number }
    | { kind: "iptv"; key: string };

  const allTiles: Tile[] = [];
  if (room)
    allTiles.push({ kind: "participant", key: "local", participant: room.localParticipant, isLocal: true, userId: currentUserId ?? -1 });
  for (const p of remotes)
    allTiles.push({ kind: "participant", key: p.sid, participant: p, isLocal: false, userId: Number(p.identity) });

  // O man hinh dua vao TRACK co that chu khong phai trang thai trinh bay -
  // track moi la thu dang thuc su phat, trang thai co the lech mot nhip.
  const screenSharers: { participant: Participant; isLocal: boolean; userId: number }[] = [];
  if (room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track)
    screenSharers.push({ participant: room.localParticipant, isLocal: true, userId: currentUserId ?? -1 });
  for (const p of remotes)
    if (p.getTrackPublication(Track.Source.ScreenShare)?.track)
      screenSharers.push({ participant: p, isLocal: false, userId: Number(p.identity) });
  for (const sh of screenSharers)
    allTiles.push({ kind: "screen", key: `screen-${sh.userId}`, ...sh });

  if (presentation?.kind === "mini_app") allTiles.push({ kind: "iptv", key: "iptv" });

  // Thu dang o khung lon thi khong lap lai o cot ben canh. Luu y CHI loai o
  // dung loai: nguoi dang trinh chieu van giu o CAMERA cua ho trong luoi,
  // chi o MAN HINH cua ho moi bi loai (vi no dang o khung lon).
  const gridTiles = allTiles.filter((t) => {
    if (showAppStage && t.kind === "iptv") return false;
    if (!stageParticipant) return true;
    if (stageIsScreen) return !(t.kind === "screen" && t.participant === stageParticipant);
    return !(t.kind === "participant" && t.participant === stageParticipant);
  });

  // So o moi trang lay tu thiet ke: luoi thuong 3x3 = 9 (frame 116:773),
  // focus mode la dai bon o duoi khung lon (frame 118:1080). Man hinh hep
  // thi it hon nua.
  const perPage = inFocusLayout ? (isNarrow ? 2 : 5) : isNarrow ? 4 : 9;
  const totalPages = Math.max(1, Math.ceil(gridTiles.length / perPage));
  const safePage = Math.min(page, totalPages - 1);
  const visibleTiles = gridTiles.slice(safePage * perPage, safePage * perPage + perPage);

  // Doi giua luoi va focus mode thi so o moi trang doi theo, chi so trang cu
  // khong con y nghia - ve trang dau cho de hieu.
  useEffect(() => {
    setPage(0);
  }, [inFocusLayout]);

  // Nguoi roi phong co the lam trang hien tai bien mat.
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  // Bo cuc luoi doi theo SO O, dung nhu cac frame rieng trong thiet ke:
  //   1 -> mot o to     2 -> hai cot      3 -> hai tren, mot duoi canh giua
  //   4 -> luoi 2x2     >=5 -> luoi 3 cot, o co ty le 440x256
  // Lay theo TONG so o chu khong phai so o dang hien: neu khong, trang cuoi
  // cua mot phong dong (con 3 o) se phong to len roi trang truoc lai thu
  // nho - lat trang mot cai la ca man nhay kich thuoc.
  const kieuLuoi =
    gridTiles.length <= 1
      ? "mroom-grid-1"
      : gridTiles.length === 2
        ? "mroom-grid-2"
        : gridTiles.length === 3
          ? "mroom-grid-3"
          : gridTiles.length === 4
            ? "mroom-grid-4"
            : "mroom-grid-nhieu";

  const visibleKey = visibleTiles
    .filter((t) => t.kind === "participant" && !t.isLocal)
    .map((t) => (t as { userId: number }).userId)
    .join(",");

  // Rieng cho o MAN HINH - tach khoi visibleKey vi mot nguoi co the co o
  // camera dang an ma o man hinh dang hien, hoac nguoc lai.
  const visibleScreenKey = visibleTiles
    .filter((t) => t.kind === "screen" && !t.isLocal)
    .map((t) => (t as { userId: number }).userId)
    .join(",");

  // Day moi la phan tiet kiem that: o nao khong hien thi thi HUY DANG KY
  // camera cua nguoi do, LiveKit ngung gui luong toi may nay. An bang CSS
  // thi video van tai ve, dung mat muc dich.
  //
  // Ba nguon quyet dinh, ket hop lai:
  //   - dang o khung lon  -> luon giu
  //   - dang o trang hien tai -> giu
  //   - dang bat che do tiet kiem du lieu -> BO HET, thang moi thu tren
  // KHONG dung toi audio - van phai nghe duoc moi nguoi du o cua ho khong
  // hien. Man hinh chia se nay da co o RIENG nen cung duoc tinh y het nhu
  // camera: khong hien thi thi khong tai ve. Truoc day man hinh luon duoc
  // tai bat ke co ai nhin hay khong, ma no la luong ton bang thong nhat.
  useEffect(() => {
    if (!room) return;
    const visible = new Set(visibleKey ? visibleKey.split(",").map(Number) : []);
    const visibleScreens = new Set(visibleScreenKey ? visibleScreenKey.split(",").map(Number) : []);

    for (const p of remotes) {
      const uid = Number(p.identity);

      // Khung lon dang chieu MAN HINH thi khong can giu camera cua nguoi do
      // - o camera cua ho (neu co hien) da nam trong visible roi.
      const onStageAsCamera = p === stageParticipant && !stageIsScreen;
      const wantCam = (onStageAsCamera || visible.has(uid)) && !tietKiem;
      const camPub = p.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
      if (camPub && camPub.isSubscribed !== wantCam) camPub.setSubscribed(wantCam);

      const onStageAsScreen = p === stageParticipant && stageIsScreen;
      const wantScreen = onStageAsScreen || visibleScreens.has(uid);
      const screenPub = p.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
      if (screenPub && screenPub.isSubscribed !== wantScreen) screenPub.setSubscribed(wantScreen);
    }
  }, [room, remotes, visibleKey, visibleScreenKey, tietKiem, stageParticipant, stageIsScreen]);

  // Dem tin nhan chua doc cho cham do tren nut chat.
  //
  // Phai NGHE O DAY chu khong o trong MeetingDiscussion: panel do bi thao ra
  // khi dong, ma tin den luc panel dong moi la tin can dem. Vi trang nay giu
  // viec vao/roi nhom SignalR, MeetingDiscussion trong phong duoc goi voi
  // tuVaoNhom={false} - hai ben cung goi thi luc panel dong se roi nhom va
  // trang mat luon duong nghe.
  const chatDangMoRef = useRef(false);
  chatDangMoRef.current = showDiscussion;
  useEffect(() => {
    const convId = meeting?.conversationId;
    if (convId == null) return;
    let huy = false;
    let boNghe: (() => void) | undefined;
    void (async () => {
      try {
        await joinMeetingDiscussion(convId, meetingId);
        const off = await onMeetingMessageReceived((msg) => {
          if (chatDangMoRef.current) return;
          if (msg.senderId === currentUserId) return;
          setChuaDocChat((n) => n + 1);
        });
        if (huy) off();
        else boNghe = off;
      } catch {
        // Mat cham do con hon chan ca phong hop lai vi mot con so nho.
      }
    })();
    return () => {
      huy = true;
      boNghe?.();
      leaveMeetingDiscussion(meetingId).catch(() => {});
    };
  }, [meeting?.conversationId, meetingId, currentUserId]);

  useEffect(() => {
    if (showDiscussion) setChuaDocChat(0);
  }, [showDiscussion]);

  useEffect(() => {
    localStorage.setItem("meet-tiet-kiem", tietKiem ? "1" : "0");
  }, [tietKiem]);

  // Ten nhom cho dau popup nhan tin. Chi hoi khi that su can (nguoi dung mo
  // panel chat) va chi mot lan: Media Service khong tra workspaceId, nen phai
  // di vong Chat -> WorkSpace.
  useEffect(() => {
    const convId = meeting?.conversationId;
    if (!showDiscussion || convId == null || meeting?.isTemporary || nhomCuaHop) return;
    let huy = false;
    void (async () => {
      try {
        const { data: conv } = await chatApi.getConversation(convId);
        if (huy || conv.workspaceId == null) return;
        const { data: ws } = await workspaceApi.get(conv.workspaceId);
        if (!huy) setNhomCuaHop({ id: ws.id, ten: ws.name, anh: ws.avatarUpdatedAt });
      } catch {
        // Khong lay duoc ten nhom thi dau popup lui ve "Cuoc hop #n".
      }
    })();
    return () => {
      huy = true;
    };
  }, [showDiscussion, meeting?.conversationId, meeting?.isTemporary, nhomCuaHop]);

  // Hoi Identity ve anh dai dien cua nhung nguoi trong phong. Chi hoi NHUNG
  // NGUOI CHUA CO trong bang, va ghi ca nguoi khong tra ve (null) de khong
  // hoi lai vong sau - danh sach nguoi trong phong duoc poll 4 giay mot lan.
  useEffect(() => {
    const thieu = participants.map((p) => p.userId).filter((id) => !(id in anhCua));
    if (thieu.length === 0) return;
    let huy = false;
    userApi
      .byIds(thieu)
      .then((r) => {
        if (huy) return;
        setAnhCua((truoc) => {
          const moi = { ...truoc };
          for (const id of thieu) moi[id] = null;
          for (const u of r.data) moi[u.id] = u.avatarUpdatedAt;
          return moi;
        });
      })
      .catch(() => {
        // Khong lay duoc thi o hien chu cai dau - khong dang de bao loi giua
        // cuoc hop.
      });
    return () => {
      huy = true;
    };
  }, [participants, anhCua]);

  // Danh sach ban be chi can khi chu phong that su mo bang dieu khien de
  // moi - tai san luc vao phong la mot request thua cho phan lon phien hop.
  useEffect(() => {
    if (!showPeople || !isHost || friends.length > 0) return;
    friendApi
      .list()
      .then((res) => setFriends(res.data))
      .catch(() => {
        // Khong moi duoc ban be thi van con duong tao link - khong dang de
        // dung mot bao loi do chen ngang cuoc hop.
      });
  }, [showPeople, isHost, friends.length]);

  const renderTile = (t: Tile) => {
    if (t.kind === "iptv")
      return (
        <div key={t.key} className="meet-tile meet-tile-app">
          <IptvStage compact />
        </div>
      );

    return (
      <ParticipantTile
        key={t.key}
        participant={t.participant}
        isLocal={t.isLocal}
        version={version}
        source={t.kind === "screen" ? "screen" : "camera"}
        userId={t.userId}
        avatarUpdatedAt={anhCua[t.userId]}
        // Thiet ke dat vong tron CO DINH: 122 o luoi thuong (moi frame theo so
        // nguoi deu ve 122 du o to nho khac han nhau), 61 o dai nho cua focus
        // mode (frame 118:1080).
        avatarSize={inFocusLayout ? 61 : 122}
        label={
          t.kind === "screen"
            ? `Màn hình của ${t.isLocal ? (nickname ?? "bạn") : nameOf(t.participant)}`
            : t.isLocal
              ? (nickname ?? "Bạn")
              : nameOf(t.participant)
        }
        videoHidden={t.kind === "participant" && !t.isLocal && tietKiem}
        // Ghim la lua chon xem RIENG cua toi - khong gui len server, khong ai
        // khac bi anh huong, nen khong can quyen gi. O man hinh chia se thi
        // khong ghim: khung do da tu len giua roi.
        //
        // Va CHI ghim duoc o che do luoi binh thuong: dang co nguoi chia se
        // man hinh hay dang phat IPTV thi khung lon la cua luot trinh bay,
        // ghim vao do se day noi dung dang chieu ra ngoai.
        onGhim={
          t.kind === "participant" && !coTrinhBay
            ? () => setPinnedUserId((truoc) => (truoc === t.userId ? null : t.userId))
            : undefined
        }
        dangGhim={t.kind === "participant" && pinnedUserId === t.userId}
      />
    );
  };

  // Cot lat trang - Figma "Frame 60" ben trai thanh doc: mot cot cao mo,
  // so trang o dinh, hai mui ten o giua.
  // Khoi giua thanh tren: dang chieu gi, va nhung nut di kem. null = khong
  // co gi de bao. Ghim va trinh bay dung chung mot cho vi khong bao gio xay
  // ra cung luc - dang trinh bay thi ghim bi tat (xem stageParticipant).
  const bangChieu: { chu: string; nut: { chu: string; bam: () => void }[] } | null = presentation
    ? {
        chu: `${presentation.nickname} đang phát ${presentation.kind === "screen" ? "màn hình" : "nội dung"}`,
        nut: [
          ...(presentation.userId === currentUserId || isHost
            ? [{ chu: "Dừng", bam: () => void handleStopPresentation() }]
            : []),
          { chu: gridOverride ? "Dạng khung" : "Dạng lưới", bam: () => setGridOverride((v) => !v) },
        ],
      }
    : pinnedUserId !== null
      ? {
          chu: `Bạn đang ghim ${nameOfUserId(pinnedUserId)}`,
          nut: [{ chu: "Bỏ ghim", bam: () => setPinnedUserId(null) }],
        }
      : null;

  // Mot nut Mini App, HAI popup - tuy dang co app chay hay khong:
  //   chua chay -> "Danh sach app" de chon app ma khoi tao
  //   dang chay -> thang vao trang dieu khien cua app do (Figma 149:1321),
  //                khong bat nguoi dung di lai qua danh sach app moi lan chi
  //                muon keo am luong hay doi do phan giai.
  const dangChayMiniApp = presentation?.kind === "mini_app";

  function moPanel(ten: "chat" | "nguoi" | "caidat" | "app") {
    setShowDiscussion(ten === "chat" ? !showDiscussion : false);
    setShowPeople(ten === "nguoi" ? !showPeople : false);
    setShowSettings(ten === "caidat" ? !showSettings : false);
    setShowApps(ten === "app" && !dangChayMiniApp ? !showApps : false);
    setShowIptvPicker(ten === "app" && dangChayMiniApp ? !showIptvPicker : false);
  }

  const pager = totalPages > 1 && (
    <div className="mroom-pager">
      <span className="mroom-pager-so">
        {safePage + 1}/{totalPages}
      </span>
      <div className="mroom-pager-nut">
        <button
          disabled={safePage === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          aria-label="Trang trước"
          title="Trang trước"
        >
          <IconPagerArrow />
        </button>
        <button
          className="mroom-pager-phai"
          disabled={safePage >= totalPages - 1}
          onClick={() => setPage((p) => p + 1)}
          aria-label="Trang sau"
          title="Trang sau"
        >
          <IconPagerArrow />
        </button>
      </div>
    </div>
  );

  // Thoat som - dat SAU toan bo hook o tren (xem ghi chu o muc Render).
  if (status === "error") {
    return (
      <div className="meet-page meet-center">
        <p className="meet-error">{error}</p>
        <button onClick={() => navigate(-1)}>Quay lại</button>
      </div>
    );
  }

  if (status === "left") {
    return (
      <div className="meet-page meet-center">
        <p>Bạn đã rời cuộc họp.</p>
        <button onClick={() => navigate(-1)}>Quay lại</button>
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className="meet-page meet-center">
        <p>Cuộc họp này đã kết thúc.</p>
        <p className="meet-note">Quay lại phòng chat và bấm “Gọi video” để mở cuộc họp mới.</p>
        <button onClick={() => navigate(-1)}>Quay lại</button>
      </div>
    );
  }

  return (
    // Trinh phat IPTV song o day chu khong o trong bo cuc: doi focus mode <->
    // luoi thi no chi DOI CHO, khong bi thao ra dung lai. Xem IptvPlayerHost.
    <IptvPlayerHost
      meetingId={meetingId}
      channelId={presentation?.kind === "mini_app" ? (presentation.channelId ?? null) : null}
      channelUrl={presentation?.kind === "mini_app" ? (presentation.channelUrl ?? null) : null}
      tuyChon={tuyChonPhat}
    >
    <div className="mroom">
      {/* Thanh tren - Figma "Frame 57": cao 96, nen #293546. Dong ho trai,
          ten cuoc hop giua, nut do "Roi khoi" phai.

          "Roi khoi" o day chi dua RIENG TOI ra khoi phong. Viec ket thuc ca
          cuoc hop nam o nut tron do dau thanh doc va chi chu phong thay. */}
      <header className={`mroom-top${bangChieu ? " mroom-top-chieu" : ""}`}>
        <span className="mroom-clock" title="Thời gian đã họp">
          {daHop}
        </span>
        <span className="mroom-title">Cuộc họp #{meetingId}</span>

        {/* Khoi "dang phat noi dung" nam NGAY TREN THANH TREN, dung theo
            frame 149:1735 - truoc day no la mot dai xam rieng an mat mot
            khoanh cua khung trinh bay. */}
        {bangChieu && (
          <span className="mroom-chieu">
            <span className="mroom-chieu-chu">{bangChieu.chu}</span>
            {bangChieu.nut.map((n) => (
              <button key={n.chu} type="button" className="mroom-pill" onClick={n.bam}>
                {n.chu}
              </button>
            ))}
          </span>
        )}

        <button className="mroom-leave" onClick={handleLeave}>
          Rời khỏi
        </button>
      </header>

      {error && <p className="meet-error">{error}</p>}
      {notice && (
        <p className="meet-notice">
          {notice}{" "}
          <button onClick={() => setNotice(null)} className="meet-notice-close">
            Đóng
          </button>
        </p>
      )}

      {status === "connecting" ? (
        <div className="mroom-center">
          <p>Đang kết nối phòng họp…</p>
        </div>
      ) : (
        <div className="mroom-body">
          <div className="meet-stage-wrap">

            {/* FOCUS MODE: khung lon ben trai, cot o nho co phan trang ben
                phai (giong Teams). Man hinh hep thi cot nay tu xuong duoi
                thanh mot dai ngang - xem meeting.css. */}
            {inFocusLayout ? (
              /* Focus mode (frame 118:1080): khung lon chiem gan het man,
                 moi nguoi thu thanh MOT DAI NGANG ben duoi, cot lat trang
                 nam ngay ben phai dai do. */
              <div className="mroom-focus">
                {stageParticipant && (
                  <div className="meet-stage">
                    <ParticipantTile
                      participant={stageParticipant}
                      isLocal={stageParticipant === room?.localParticipant}
                      version={version}
                      source={stageIsScreen ? "screen" : "camera"}
                      userId={stageUserId}
                      avatarUpdatedAt={anhCua[stageUserId ?? -1]}
                      label={
                        stageIsScreen
                          ? `Màn hình của ${presentation?.nickname ?? ""}`
                          : nameOfUserId(stageUserId!)
                      }
                      stage
                    />
                  </div>
                )}

                {showAppStage && (
                  <div className="meet-stage meet-stage-app">
                    <IptvStage />
                  </div>
                )}

                {gridTiles.length > 0 && (
                  <div className="mroom-dai">
                    <div className="meet-grid mroom-grid-dai">{visibleTiles.map(renderTile)}</div>
                    {pager}
                  </div>
                )}
              </div>
            ) : (
              <div className="mroom-luoi-hang">
                <div className={`meet-grid ${kieuLuoi}`}>{visibleTiles.map(renderTile)}</div>
                {pager}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nguoi XEM cung mo duoc popup nay khi dang co app chay: do phan giai,
          luong tieng va am luong deu la lua chon cua rieng may ho. Chi rieng
          "Dung phat"/"Chuyen kenh" moi doi hoi dang trinh bay - xem
          dieuKhienDuoc. */}
      {showIptvPicker && (canUseMiniApp || dangChayMiniApp) && (
        <IptvChannelPicker
          meetingId={meetingId}
          dangPhat={dangChayMiniApp ? (presentation?.channelName ?? null) : null}
          dieuKhienDuoc={presentation?.userId === currentUserId || isHost}
          tuyChon={tuyChonPhat}
          onDoiTuyChon={setTuyChonPhat}
          onPick={handlePickChannel}
          onDungPhat={() => {
            setShowIptvPicker(false);
            void handleStopPresentation();
          }}
          // "Phat lai" = dung mot vong Hls moi cho cung kenh do. Doi
          // khoaClearKey qua lai mot khoang trang la du de effect dung trinh
          // phat len lai, khong phai them mot duong rieng.
          onPhatLai={() =>
            setTuyChonPhat((t) => ({ ...t, khoaClearKey: t.khoaClearKey.endsWith(" ") ? t.khoaClearKey.trimEnd() : t.khoaClearKey + " " }))
          }
          onClose={() => setShowIptvPicker(false)}
        />
      )}

      {/* Thanh doc ben phai - Figma "Frame 60": rong 137, nen #293546, tam
          nut tron 66px vien #85AEB0. Thu tu lay dung tu thiet ke: ket thuc,
          camera, mic, chat, nguoi tham gia, chia se man hinh, media, cai dat. */}
      <nav className="mroom-rail" aria-label="Điều khiển cuộc họp">
        {isHost && (
          <button className="mroom-btn mroom-btn-ket" onClick={handleEnd} title="Kết thúc cho tất cả">
            <IconCallEnd />
          </button>
        )}

        <button
          className={`mroom-btn${camOn ? " mroom-btn-bat" : ""}`}
          onClick={toggleCam}
          disabled={!camAllowed}
          title={
            !camAllowed
              ? "Chủ phòng đã thu quyền bật camera của bạn"
              : camOn
                ? "Tắt camera"
                : "Bật camera"
          }
        >
          <IconCamera off={!camOn} />
        </button>

        <button
          className={`mroom-btn${micOn ? " mroom-btn-bat" : ""}`}
          onClick={toggleMic}
          disabled={!micAllowed}
          title={
            !micAllowed ? "Chủ phòng đã thu quyền bật micro của bạn" : micOn ? "Tắt mic" : "Bật mic"
          }
        >
          <IconMicrophone off={!micOn} />
        </button>

        <button
          className={`mroom-btn${showDiscussion ? " mroom-btn-bat" : ""}`}
          onClick={() => moPanel("chat")}
          title="Thảo luận"
        >
          <IconChatBubble />
          {chuaDocChat > 0 && <span className="mroom-cham">{chuaDocChat > 99 ? "99+" : chuaDocChat}</span>}
        </button>

        <button
          className={`mroom-btn${showPeople ? " mroom-btn-bat" : ""}`}
          onClick={() => moPanel("nguoi")}
          title={`Người tham gia (${presentParticipants.length})`}
        >
          <IconPeople />
          {waiting.length > 0 && <span className="mroom-cham">{waiting.length}</span>}
        </button>

        {canShareScreen && (
          <button
            className={`mroom-btn${sharing ? " mroom-btn-bat" : ""}`}
            onClick={toggleShare}
            title={sharing ? "Dừng trình chiếu" : "Trình chiếu màn hình"}
          >
            <IconScreenShare />
          </button>
        )}

        {/* LUON hien, ke ca khi chua duoc phep: popup se noi ro vi sao va
            chi cho o dau ma bat. An nut di thi nguoi dung chi thay mot cho
            trong va khong biet minh dang thieu gi. */}
        <button
          className={`mroom-btn${showApps || showIptvPicker ? " mroom-btn-bat" : ""}`}
          onClick={() => moPanel("app")}
          title="Ứng dụng trong cuộc họp"
        >
          <IconMedia />
        </button>

        <button
          className={`mroom-btn${showSettings ? " mroom-btn-bat" : ""}`}
          onClick={() => moPanel("caidat")}
          title="Cài đặt"
        >
          <IconGear size={32} />
        </button>
      </nav>

      {/* Ba popup cua phong hop. Chung DE LEN khung hop chu khong chen no hep
          lai, va doc quyen nhau - xem moPanel(). Nen SANG de len phong toi la
          co y trong ban thiet ke, moi frame popup deu ve vay. */}
      {showSettings && (
        <MeetingSettingsDialog
          room={room}
          tietKiem={tietKiem}
          doiTietKiem={setTietKiem}
          // Nut dung nam O DAY chu khong o thanh doc: chu du an chot vay.
          // `dungDuoc` gom ca truong hop chu phong go ket cho nguoi khac dang
          // trinh bay ma mat mang khong kip tat.
          dangChieu={
            presentation
              ? presentation.kind === "screen"
                ? "man hình"
                : "Mini App"
              : null
          }
          tenNguoiChieu={presentation?.nickname ?? ""}
          dungDuoc={!!presentation && (presentation.userId === currentUserId || isHost)}
          onDungChieu={handleStopPresentation}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showPeople && (
        <MeetingPeopleDialog
          meeting={meeting}
          participants={presentParticipants}
          waiting={waiting}
          friends={friends}
          currentUserId={currentUserId}
          isHost={isHost}
          anhCua={anhCua}
          volumes={volumes}
          inviteLink={inviteLink}
          invitingId={invitingId}
          invitedIds={invitedIds}
          dangDoiDuyet={dangDoiDuyet}
          onClose={() => setShowPeople(false)}
          onVolume={handleVolume}
          onTogglePermission={handleTogglePermission}
          onKick={handleKick}
          onApprove={handleApprove}
          onDeny={handleDeny}
          onInviteFriend={handleInviteFriend}
          onCopyInviteLink={handleLayVaChepLink}
          onMuteAll={handleMuteAll}
          onDoiCaiDatPhong={handleDoiCaiDatPhong}
        />
      )}

      {showDiscussion && (
        <MeetingChatDialog
          conversationId={meeting?.conversationId ?? null}
          meetingId={meetingId}
          laPhongTam={meeting?.isTemporary ?? false}
          tenNhom={nhomCuaHop?.ten ?? null}
          workspaceId={nhomCuaHop?.id ?? null}
          anhNhom={nhomCuaHop?.anh ?? null}
          tenChuPhong={nameOfUserId(meeting?.hostId ?? -1)}
          chuPhongId={meeting?.hostId ?? -1}
          anhChuPhong={anhCua[meeting?.hostId ?? -1] ?? null}
          onClose={() => setShowDiscussion(false)}
        />
      )}

      {showApps && (
        <MeetingAppsDialog
          moDuoc={canUseMiniApp}
          onOpenIptv={() => {
            setShowApps(false);
            handleOpenMiniApp();
          }}
          onClose={() => setShowApps(false)}
        />
      )}
    </div>
    </IptvPlayerHost>
  );
}
