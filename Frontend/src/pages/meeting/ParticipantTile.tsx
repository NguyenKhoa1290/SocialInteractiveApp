import { useEffect, useRef } from "react";
import { Track, type Participant } from "livekit-client";

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
}: {
  participant: Participant;
  isLocal: boolean;
  version: number;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Uu tien man hinh chia se hon camera - khi ai do dang trinh chieu thi cai
  // dang xem la noi dung trinh chieu, khong phai khuon mat.
  const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const videoPub = screenPub?.track ? screenPub : camPub;

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
    // KHONG attach mic cua chinh minh - se tu nghe lai tieng minh (voi lai).
    if (isLocal) return;
    const el = audioRef.current;
    const track = micPub?.track;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [micPub?.track, version, isLocal]);

  const hasVideo = Boolean(videoPub?.track) && !videoPub?.isMuted;
  const micMuted = !micPub?.track || micPub.isMuted;

  return (
    <div className="meet-tile">
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className="meet-tile-video" />
      ) : (
        <div className="meet-tile-placeholder">{label.slice(0, 1).toUpperCase()}</div>
      )}
      {!isLocal && <audio ref={audioRef} autoPlay />}
      <div className="meet-tile-label">
        {micMuted && <span className="meet-tile-muted">🔇</span>}
        {label}
        {isLocal && " (bạn)"}
        {screenPub?.track && " · đang trình chiếu"}
      </div>
    </div>
  );
}
