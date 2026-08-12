import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Room, RoomEvent, createLocalScreenTracks, type Participant, type RemoteParticipant } from "livekit-client";
import { meetingApi } from "../../api/mediaApi";
import { useAuthStore } from "../../store/authStore";
import { extractApiError } from "../../lib/apiError";
import { ParticipantTile } from "./ParticipantTile";
import { IptvPanel } from "./IptvPanel";
import { MeetingDiscussion } from "./MeetingDiscussion";
import type { MeetingParticipant, MeetingWithCallerStatus, WaitingParticipant } from "../../types/media";
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
      setSharing(false);
      setVersion((v) => v + 1);
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
      // nguoi dung huy chon man hinh - bo qua
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

  const nameOf = (p: Participant) => {
    const id = Number(p.identity);
    return participants.find((x) => x.userId === id)?.nickname ?? (p.name || p.identity);
  };

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
          <div className="meet-grid">
            {room && (
              <ParticipantTile
                participant={room.localParticipant}
                isLocal
                version={version}
                label={nickname ?? "Bạn"}
              />
            )}
            {remotes.map((p) => (
              <ParticipantTile key={p.sid} participant={p} isLocal={false} version={version} label={nameOf(p)} />
            ))}
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
                    {isHost && p.userId !== currentUserId && (
                      <span className="meet-people-actions">
                        <button onClick={() => handleTogglePermission(p, "share_screen")}>
                          {p.permissions.includes("share_screen") ? "Thu quyền chia sẻ" : "Cho chia sẻ"}
                        </button>
                        <button onClick={() => handleTogglePermission(p, "mini_app")}>
                          {p.permissions.includes("mini_app") ? "Thu quyền Mini App" : "Cho Mini App"}
                        </button>
                        <button className="meet-danger" onClick={() => handleKick(p.userId)}>
                          Mời ra
                        </button>
                      </span>
                    )}
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
