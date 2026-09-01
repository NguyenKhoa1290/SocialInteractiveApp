import { useEffect, useRef } from "react";
import { Track, type Participant } from "livekit-client";
import { Avatar } from "../../components/Avatar";

// Mot o video cua 1 nguoi trong phong. LiveKit khong phat su kien React nao
// nen tile phai duoc render lai qua prop "version" (bo dem tang moi khi Room
// ban ra su kien track/participant) - dung cach chinh thuc trong vi du cua
// livekit-client cho React thuan (khong dung @livekit/components-react de
// khong keo them 1 he thong UI rieng vao du an).
export function ParticipantTile({
  participant,
  isLocal,
  version,
  label,
  stage = false,
  videoHidden = false,
  source = "camera",
  userId,
  avatarUpdatedAt,
  avatarSize = 122,
  onGhim,
  dangGhim = false,
}: {
  participant: Participant;
  isLocal: boolean;
  version: number;
  label: string;
  // UC-34 1e - dang tat hien thi camera cua nguoi nay (client-side, de tiet
  // kiem bang thong). Xem MeetingRoomPage.toggleHideVideo: cho tat that su
  // bang setSubscribed(false), khong chi an bang CSS.
  videoHidden?: boolean;
  // Nguon video muon hien trong o NAY. Truoc day tile luon uu tien man hinh
  // chia se hon camera, nen nguoi dang trinh chieu bi mat o khuon mat - ca
  // phong thay man hinh nhung khong thay nguoi. Gio man hinh co O RIENG
  // (giong Teams/Meet), nen phai noi ro o nay lay nguon nao.
  source?: "camera" | "screen";
  // stage = o trung tam khi dang focus mode: khung to, va uu tien hien
  // NGUYEN khung hinh (object-fit: contain) thay vi cat vien nhu o video
  // khuon mat - noi dung trinh chieu bi cat la mat chu.
  stage?: boolean;
  // Chu cua o, de lay anh dai dien. Khach vang lai vao bang link co the khong
  // ung voi mot tai khoan nao - luc do bo trong va o hien chu cai dau.
  userId?: number | null;
  avatarUpdatedAt?: string | null;
  // Duong kinh vong tron TRUOC khi nhan --s. Thiet ke dat co dinh, khong doi
  // theo do lon cua o: 122 o luoi thuong, 61 o dai nho cua focus mode.
  avatarSize?: number;
  // Bam vao o de ghim nguoi do vao khung lon. Ban thiet ke khong ve nut ghim
  // o dau ca, nen chinh cai o la nut - khong ton mot mm giao dien nao.
  //
  // Bo trong khi KHONG ghim duoc; luc do o khong doi con tro, khong sang
  // vien khi ro chuot va khong co title - de nguoi dung khong bam vao mot
  // thu khong phan hoi. Xem MeetingRoomPage: dang co nguoi trinh bay thi
  // khung lon thuoc ve luot trinh bay, ghim bi tat.
  onGhim?: () => void;
  dangGhim?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const screenAudioPub = participant.getTrackPublication(Track.Source.ScreenShareAudio);
  const videoPub = source === "screen" ? screenPub : camPub;
  // O man hinh nghe TIENG CUA MAN HINH, o camera nghe tieng nguoi. Truoc day
  // o man hinh khong gan am thanh nao ca, nen nguoi chia se mot video co
  // tieng thi ca phong nhin thay hinh ma khong nghe gi.
  const audioPub = source === "screen" ? screenAudioPub : micPub;

  useEffect(() => {
    const el = videoRef.current;
    const track = videoPub?.track;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [videoPub?.track, version]);

  useEffect(() => {
    // KHONG attach am thanh cua chinh minh - se tu nghe lai tieng minh (voi
    // lai), va voi man hinh chia se thi thanh mot vong lap tieng.
    if (isLocal) return;
    const el = audioRef.current;
    const track = audioPub?.track;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [audioPub?.track, version, isLocal]);

  const hasVideo = Boolean(videoPub?.track) && !videoPub?.isMuted && !videoHidden;
  // Noi dung trinh chieu bi cat vien la mat chu - luon hien nguyen khung du
  // o dang o luoi nho.
  const contain = stage || source === "screen";
  const micMuted = !micPub?.track || micPub.isMuted;

  const lop = [stage ? "meet-tile meet-tile-stage" : "meet-tile", onGhim ? "meet-tile-ghim-duoc" : "", dangGhim ? "meet-tile-dang-ghim" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={lop}
      onClick={onGhim}
      title={onGhim ? (dangGhim ? `Bỏ ghim ${label}` : `Ghim ${label} vào khung lớn`) : undefined}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={contain ? "meet-tile-video meet-tile-video-contain" : "meet-tile-video"}
        />
      ) : (
        /* Chua bat camera: vong tron chu cai dau, ten ngay ben duoi va canh
           giua o - dung nhu moi o trong ban thiet ke (Figma 116:773). O
           trang thai nay ten KHONG nam o dai goc duoi nua, vi ca o dang
           trong thi khong co gi phai tranh cho. */
        <div className="meet-tile-placeholder">
          {typeof userId === "number" && Number.isFinite(userId) && userId > 0 ? (
            <Avatar
              userId={userId}
              nickname={label}
              avatarUpdatedAt={avatarUpdatedAt}
              size={avatarSize}
              className="meet-tile-avatar"
            />
          ) : (
            <span className="avatar avatar-chu meet-tile-avatar meet-tile-avatar-tay">
              {label.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="meet-tile-ten">
            {source === "camera" && micMuted && <span className="meet-tile-muted">🔇</span>}
            {/* Ten phai nam trong mot the RIENG: text-overflow: ellipsis khong
                an vao mot text node tran trong flex container, nen truoc day
                ten dai bi cat cut giua chung thay vi co dau ba cham. */}
            <span className="meet-tile-ten-chu">
              {label}
              {source === "camera" && isLocal && " (bạn)"}
            </span>
          </span>
        </div>
      )}
      {/* O camera gan mic, o man hinh gan tieng cua man hinh - hai nguon
          khac nhau nen khong bao gio nghe doi. */}
      {!isLocal && <audio ref={audioRef} autoPlay />}
      {hasVideo && (
        <div className="meet-tile-label">
          {source === "camera" && micMuted && <span className="meet-tile-muted">🔇</span>}
          {label}
          {source === "camera" && isLocal && " (bạn)"}
        </div>
      )}
    </div>
  );
}
