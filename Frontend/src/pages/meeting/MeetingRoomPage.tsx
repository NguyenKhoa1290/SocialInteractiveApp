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
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { ParticipantTile } from "./ParticipantTile";
import { DevicePicker } from "./DevicePicker";
import { IptvPanel } from "./IptvPanel";
import { MeetingDiscussion } from "./MeetingDiscussion";
import type {
  MeetingParticipant,
  MeetingWithCallerStatus,
  PresentationState,
  RoomMetadata,
  WaitingParticipant,
} from "../../types/media";

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
  const initialToken = (location.state as { livekitToken?: string; livekitUrl?: string } | null) ?? null;

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
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const [showIptv, setShowIptv] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(false);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
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
  const [hiddenVideos, setHiddenVideos] = useState<Set<number>>(new Set());

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

  const isHost = meeting !== null && currentUserId === meeting.hostId;
  const myPermissions = participants.find((p) => p.userId === currentUserId)?.permissions ?? [];
  const canUseMiniApp = isHost || myPermissions.includes("mini_app");
  const canShareScreen = isHost || myPermissions.includes("share_screen");

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
        // Cho mot nhip roi thu lai thi thuong duoc ngay.
        async function enableWithRetry(fn: () => Promise<unknown>) {
          try {
            await fn();
            return true;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 700));
            try {
              await fn();
              return true;
            } catch {
              return false;
            }
          }
        }

        const failed: string[] = [];
        if (!(await enableWithRetry(() => r.localParticipant.setMicrophoneEnabled(true)))) {
          if (!cancelled) setMicOn(false);
          failed.push("micro");
        }
        if (!(await enableWithRetry(() => r.localParticipant.setCameraEnabled(true)))) {
          if (!cancelled) setCamOn(false);
          failed.push("camera");
        }
        if (failed.length > 0 && !cancelled) {
          setNotice(
            `Không bật được ${failed.join(" và ")}. Bạn vẫn đang ở trong phòng — bấm nút bật lại để thử. ` +
              `Nếu vẫn không được: kiểm tra xem có tab/ứng dụng nào khác đang dùng thiết bị, hoặc trình duyệt chưa được cấp quyền.`,
          );
        }

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

  // --- Dieu khien --------------------------------------------------------
  // Bat/tat thiet bi CO THE that bai that su (NotReadableError khi camera
  // dang bi ung dung khac giu, NotAllowedError khi bi tu choi quyen). Truoc
  // day khong bat loi nen loi roi tu do thanh unhandled rejection: nguoi
  // dung bam nut va KHONG THAY GI XAY RA, khong biet tai sao.
  async function toggleDevice(kind: "mic" | "cam") {
    if (!room) return;
    const next = kind === "mic" ? !micOn : !camOn;
    setNotice(null);
    try {
      if (kind === "mic") {
        await room.localParticipant.setMicrophoneEnabled(next);
        setMicOn(next);
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
          : `Không mở được ${device} — thiết bị đang bị ứng dụng khác (Zoom/Teams/OBS…) hoặc một tab khác chiếm dụng. Đóng ứng dụng đó rồi thử lại.`,
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

    // GIANH SUAT TRINH BAY TRUOC khi bat chia se: chi mot nguoi duoc trinh
    // bay mot luc (giong Teams). Neu nguoi khac dang trinh bay -> 409, khong
    // de len nguoi ta.
    try {
      await meetingApi.startPresentation(meetingId, "screen");
    } catch (err) {
      setNotice(extractApiError(err, "Không bắt đầu trình chiếu được"));
      return;
    }

    try {
      // Tu lay track truoc roi moi publish de bat duoc truong hop nguoi dung
      // bam Huy o hop chon man hinh cua trinh duyet (khong phai loi).
      const tracks = await createLocalScreenTracks({ audio: false });
      await Promise.all(tracks.map((t) => room.localParticipant.publishTrack(t)));
      setSharing(true);
      setVersion((v) => v + 1);
    } catch {
      // Nguoi dung huy o hop chon man hinh -> phai TRA LAI suat vua gianh,
      // neu khong ca phong se ket o focus mode voi mot man hinh trong.
      await meetingApi.stopPresentation(meetingId).catch(() => {});
    }
  }

  // Dung trinh bay - nguoi dang trinh bay tu dung, hoac Chu phong go ket khi
  // nguoi kia mat mang ma khong kip tat.
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

  async function handleCreateInviteLink() {
    try {
      const res = await meetingApi.createInvite(meetingId, "link");
      setInviteLink(`${window.location.origin}/meetings/join/${res.data.inviteToken}`);
    } catch (err) {
      setError(extractApiError(err, "Không tạo được link mời"));
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
  async function handleTogglePermission(p: MeetingParticipant, perm: "share_screen" | "mini_app") {
    try {
      if (p.permissions.includes(perm)) await meetingApi.revokePermission(meetingId, p.userId, perm);
      else await meetingApi.grantPermission(meetingId, p.userId, perm);
      await refresh();
    } catch (err) {
      setError(extractApiError(err, "Không đổi được quyền"));
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
  //   1. Nguoi TOI tu ghim (lua chon rieng cua toi, thang moi thu khac)
  //   2. Nguoi dang chia se man hinh (focus mode tu dong)
  // Ghim va viec thoat che do tap trung deu la trang thai CUC BO cua tung
  // nguoi - khong gui len server, khong anh huong ai khac.
  const pinnedParticipant = findParticipant(pinnedUserId);
  const autoFocusParticipant =
    presentation?.kind === "screen" && !gridOverride ? findParticipant(presentation.userId) : undefined;

  const stageParticipant = pinnedParticipant ?? autoFocusParticipant;
  const showAppStage = presentation?.kind === "mini_app" && !gridOverride && pinnedUserId === null;
  const inFocusLayout = Boolean(stageParticipant) || showAppStage;

  // Moi LUOT TRINH BAY MOI thi tra lai che do tu dong. Viec bam "Xem dang
  // luoi" chi ap dung cho luot dang dien ra, khong phai tat focus mode vinh
  // vien: neu khong, thoat mot lan la nhung lan sau nguoi khac trinh chieu
  // minh cung khong duoc dua vao khung trinh bay nua.
  const presentationKey = presentation
    ? `${presentation.userId}:${presentation.kind}:${presentation.startedAt}`
    : null;
  useEffect(() => {
    setGridOverride(false);
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

  // UC-34 1e: tat hien thi camera nguoi khac de TIET KIEM BANG THONG.
  // Dung setSubscribed(false) chu khong an bang CSS: an CSS thi trinh duyet
  // VAN tai video ve, dung mat muc dich cua tinh nang. Huy dang ky la
  // LiveKit ngung gui luon luong do toi may nay.
  // CHI doi state; viec huy/dang ky lai do effect dieu phoi subscribe ben
  // duoi lam. Truoc day ham nay tu goi setSubscribed, nhung tu khi co phan
  // trang thi co HAI nguon cung dieu khien mot thu - de lech nhau (vd bo an
  // mot nguoi dang o trang khac se subscribe lai luong khong ai nhin).
  function toggleHideVideo(userId: number) {
    setHiddenVideos((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setVersion((v) => v + 1);
  }

  // Tu bo ghim khi nguoi bi ghim roi phong - neu khong, khung trung tam ket
  // o mot o trong mai cho toi khi nguoi dung tu bam bo.
  useEffect(() => {
    if (pinnedUserId === null) return;
    if (pinnedUserId === currentUserId) return; // chinh minh thi luon con day
    const stillHere = remotes.some((p) => Number(p.identity) === pinnedUserId);
    if (!stillHere) setPinnedUserId(null);
  }, [remotes, pinnedUserId, currentUserId]);

  // --- Phan trang luoi ----------------------------------------------------

  type Tile = { key: string; participant: Participant; isLocal: boolean; userId: number };

  const allTiles: Tile[] = [];
  if (room)
    allTiles.push({ key: "local", participant: room.localParticipant, isLocal: true, userId: currentUserId ?? -1 });
  for (const p of remotes)
    allTiles.push({ key: p.sid, participant: p, isLocal: false, userId: Number(p.identity) });

  // Nguoi dang o khung lon thi khong lap lai o cot ben canh.
  const gridTiles = stageParticipant ? allTiles.filter((t) => t.participant !== stageParticipant) : allTiles;

  // Focus mode: cot ben phai hep nen it o hon. Man hinh hep: it hon nua.
  const perPage = inFocusLayout ? (isNarrow ? 2 : 6) : isNarrow ? 4 : 9;
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

  const visibleKey = visibleTiles
    .filter((t) => !t.isLocal)
    .map((t) => t.userId)
    .join(",");

  // Day moi la phan tiet kiem that: o nao khong hien thi thi HUY DANG KY
  // camera cua nguoi do, LiveKit ngung gui luong toi may nay. An bang CSS
  // thi video van tai ve, dung mat muc dich.
  //
  // Ba nguon quyet dinh, ket hop lai:
  //   - dang o khung lon  -> luon giu
  //   - dang o trang hien tai -> giu
  //   - bi nguoi dung tu an (hiddenVideos) -> BO, thang moi thu tren
  // Chi dung toi Track.Source.Camera; KHONG dung toi audio (van phai nghe
  // duoc moi nguoi) va khong dung toi luong chia se man hinh.
  useEffect(() => {
    if (!room) return;
    const visible = new Set(visibleKey ? visibleKey.split(",").map(Number) : []);

    for (const p of remotes) {
      const uid = Number(p.identity);
      const want = (p === stageParticipant || visible.has(uid)) && !hiddenVideos.has(uid);
      const pub = p.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
      if (pub && pub.isSubscribed !== want) pub.setSubscribed(want);
    }
  }, [room, remotes, visibleKey, hiddenVideos, stageParticipant]);

  const renderTile = (t: Tile) => (
    <ParticipantTile
      key={t.key}
      participant={t.participant}
      isLocal={t.isLocal}
      version={version}
      label={t.isLocal ? (nickname ?? "Bạn") : nameOf(t.participant)}
      videoHidden={!t.isLocal && hiddenVideos.has(t.userId)}
    />
  );

  const pager = totalPages > 1 && (
    <div className="meet-pager">
      <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
        ‹
      </button>
      <span>
        {safePage + 1}/{totalPages} · {gridTiles.length} người
      </span>
      <button disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
        ›
      </button>
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
    <div className="meet-page">
      <header className="meet-header">
        <span>Cuộc họp #{meetingId}</span>
        <div className="meet-header-actions">
          <button onClick={() => setShowPeople((v) => !v)}>
            Người tham gia ({participants.length}){waiting.length > 0 && ` · ${waiting.length} chờ`}
          </button>
          <button onClick={() => setShowDiscussion((v) => !v)}>💬 Thảo luận</button>
          {canUseMiniApp && <button onClick={() => setShowIptv((v) => !v)}>Mini App IPTV</button>}
        </div>
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
        <div className="meet-center">
          <p>Đang kết nối phòng họp…</p>
        </div>
      ) : (
        <div className="meet-body">
          <div className="meet-stage-wrap">
            {/* FOCUS MODE: co nguoi dang trinh bay -> khung trinh bay chiem
                trung tam, moi nguoi thu nho thanh dai ben duoi. Khong ai
                trinh bay -> luoi deu nhu binh thuong. */}
            {(presentation || pinnedUserId !== null) && (
              <div className="meet-focus-bar">
                <span>
                  {presentation ? (
                    <>
                      🔴 <strong>{presentation.nickname}</strong>{" "}
                      {presentation.kind === "screen" ? "đang trình chiếu màn hình" : "đang mở Mini App"}
                    </>
                  ) : (
                    <>
                      📌 Bạn đang ghim <strong>{nameOfUserId(pinnedUserId!)}</strong>{" "}
                      <em className="meet-note">(chỉ hiển thị ở màn hình của bạn)</em>
                    </>
                  )}
                </span>
                <span className="meet-people-actions">
                  {pinnedUserId !== null && <button onClick={() => setPinnedUserId(null)}>Bỏ ghim</button>}
                  {presentation && (
                    <button onClick={() => setGridOverride((v) => !v)}>
                      {gridOverride ? "Xem khung trình bày" : "Xem dạng lưới"}
                    </button>
                  )}
                  {presentation && (presentation.userId === currentUserId || isHost) && (
                    <button className="meet-danger" onClick={handleStopPresentation}>
                      Dừng trình bày
                    </button>
                  )}
                </span>
              </div>
            )}

            {/* FOCUS MODE: khung lon ben trai, cot o nho co phan trang ben
                phai (giong Teams). Man hinh hep thi cot nay tu xuong duoi
                thanh mot dai ngang - xem meeting.css. */}
            {inFocusLayout ? (
              <div className="meet-stage-row">
                {stageParticipant && (
                  <div className="meet-stage">
                    <ParticipantTile
                      participant={stageParticipant}
                      isLocal={stageParticipant === room?.localParticipant}
                      version={version}
                      label={pinnedParticipant ? nameOfUserId(pinnedUserId!) : (presentation?.nickname ?? "")}
                      stage
                    />
                  </div>
                )}

                {showAppStage && (
                  <div className="meet-stage meet-stage-app">
                    <IptvPanel meetingId={meetingId} onClose={() => {}} stage />
                  </div>
                )}

                {gridTiles.length > 0 && (
                  <div className="meet-side-tiles">
                    <div className="meet-grid meet-grid-side">{visibleTiles.map(renderTile)}</div>
                    {pager}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="meet-grid">{visibleTiles.map(renderTile)}</div>
                {pager}
              </>
            )}
          </div>

          {/* Thao luan chi co khi cuoc hop gan voi 1 hoi thoai - cuoc hop
              doc lap (mode=direct) khong co nhom nao de gan luong thao luan. */}
          {showDiscussion && meeting?.conversationId != null && (
            <aside className="meet-side">
              <div className="meet-side-head">
                <h3>Thảo luận</h3>
                <button onClick={() => setShowDiscussion(false)}>Đóng</button>
              </div>
              <MeetingDiscussion conversationId={meeting.conversationId} meetingId={meetingId} compact />
            </aside>
          )}
          {showDiscussion && meeting?.conversationId == null && (
            <aside className="meet-side">
              <div className="meet-side-head">
                <h3>Thảo luận</h3>
                <button onClick={() => setShowDiscussion(false)}>Đóng</button>
              </div>
              <p className="meet-empty">Cuộc họp này không mở từ nhóm chat nào nên không có luồng thảo luận.</p>
            </aside>
          )}

          {showIptv && canUseMiniApp && <IptvPanel meetingId={meetingId} onClose={() => setShowIptv(false)} />}

          {showPeople && (
            <aside className="meet-side">
              <h3>Trong phòng</h3>
              <ul className="meet-people">
                {participants.map((p) => (
                  <li key={p.userId}>
                    <span>
                      {p.nickname}
                      {p.role === "host" && " · Chủ phòng"}
                    </span>
                    {/* UC-34 1d - am luong cua nguoi nay, chi o phia minh */}
                    {p.userId !== currentUserId && (
                      <label className="meet-volume">
                        🔊
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={volumes[p.userId] ?? 1}
                          onChange={(e) => handleVolume(p.userId, Number(e.target.value))}
                        />
                      </label>
                    )}
                    <span className="meet-people-actions">
                      {/* Ghim = lua chon xem RIENG cua toi, khong gui len
                          server, khong ai khac bi anh huong -> khong can
                          quyen gi ca, ai cung ghim duoc. */}
                      <button onClick={() => setPinnedUserId(pinnedUserId === p.userId ? null : p.userId)}>
                        {pinnedUserId === p.userId ? "Bỏ ghim" : "Ghim vào giữa"}
                      </button>
                      {p.userId !== currentUserId && (
                        <button onClick={() => toggleHideVideo(p.userId)}>
                          {hiddenVideos.has(p.userId) ? "Hiện camera" : "Tắt camera (đỡ mạng)"}
                        </button>
                      )}
                      {isHost && p.userId !== currentUserId && (
                        <>
                          <button onClick={() => handleTogglePermission(p, "share_screen")}>
                            {p.permissions.includes("share_screen") ? "Thu quyền chia sẻ" : "Cho chia sẻ"}
                          </button>
                          <button onClick={() => handleTogglePermission(p, "mini_app")}>
                            {p.permissions.includes("mini_app") ? "Thu quyền Mini App" : "Cho Mini App"}
                          </button>
                          <button className="meet-danger" onClick={() => handleKick(p.userId)}>
                            Mời ra
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {isHost && (
                <>
                  <h3>Phòng chờ</h3>
                  {waiting.length === 0 ? (
                    <p className="meet-empty">Không có ai đang chờ.</p>
                  ) : (
                    <ul className="meet-people">
                      {waiting.map((w) => (
                        <li key={w.userId}>
                          <span>{w.nickname}</span>
                          <span className="meet-people-actions">
                            <button onClick={() => handleApprove(w.userId)}>Duyệt</button>
                            <button className="meet-danger" onClick={() => handleDeny(w.userId)}>
                              Từ chối
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <h3>Mời bằng link</h3>
                  <button onClick={handleCreateInviteLink}>Tạo link mời (24 giờ)</button>
                  {inviteLink && <input className="meet-invite-link" readOnly value={inviteLink} onFocus={(e) => e.target.select()} />}
                  <p className="meet-note">Người vào bằng link phải được bạn duyệt ở Phòng chờ.</p>
                </>
              )}
            </aside>
          )}
        </div>
      )}

      <footer className="meet-controls">
        <button onClick={toggleMic} className={micOn ? "" : "meet-off"}>
          {micOn ? "Tắt mic" : "Bật mic"}
        </button>
        <button onClick={toggleCam} className={camOn ? "" : "meet-off"}>
          {camOn ? "Tắt cam" : "Bật cam"}
        </button>
        {room && <DevicePicker room={room} />}
        {canShareScreen && (
          <button onClick={toggleShare} className={sharing ? "meet-off" : ""}>
            {sharing ? "Dừng trình chiếu" : "Trình chiếu"}
          </button>
        )}
        <button className="meet-danger" onClick={handleLeave}>
          Rời phòng
        </button>
        {isHost && (
          <button className="meet-danger" onClick={handleEnd}>
            Kết thúc cho tất cả
          </button>
        )}
      </footer>
    </div>
  );
}
