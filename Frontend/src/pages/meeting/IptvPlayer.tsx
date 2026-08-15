import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

// Trinh phat cho Mini App IPTV (UC-37 buoc 3-5).
//
// Vi sao can hls.js: the <video> thuan CHI phat duoc .m3u8 tren Safari.
// Tren Chrome/Firefox no khong phat gi ca - tuc Mini App IPTV truoc day
// khong thuc su xem duoc kenh nao, du toan bo API da chay dung. hls.js dich
// manifest HLS thanh Media Source Extensions nen chay duoc o moi trinh duyet.
//
// UC-37 buoc 5 ("chon kenh am thanh rieng neu co, tu chinh am luong video
// cua minh"): danh sach audio track doc THANG TU LUONG (hls.audioTracks) chu
// khong phai tu cot audio_track trong DB - cot do chi la goi y "track uu
// tien mac dinh" do nguoi tao kenh nhap, khong chac khop voi luong that.
// Ca 2 thu deu la lua chon RIENG cua tung nguoi xem, dung tinh than "moi
// nguoi trong phong tu fetch stream rieng" cua UC-37 buoc 4.
export function IptvPlayer({ src, preferredAudioTrack }: { src: string; preferredAudioTrack?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [currentAudio, setCurrentAudio] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setAudioTracks([]);

    // Safari phat HLS san - dung thang, khong can hls.js (va khong nen dung,
    // ban native muot hon).
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    if (!Hls.isSupported()) {
      setError("Trình duyệt này không hỗ trợ phát luồng HLS.");
      return;
    }

    const hls = new Hls();
    hlsRef.current = hls;
    hls.loadSource(src);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {
        // Trinh duyet chan tu dong phat khi chua co tuong tac - khong phai
        // loi, nguoi dung bam nut play la duoc.
      });
    });

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
      const tracks = data.audioTracks.map((t, i) => ({ id: i, name: t.name || t.lang || `Track ${i + 1}` }));
      setAudioTracks(tracks);

      // Uu tien track ma nguoi tao kenh da ghi trong DB, neu tim thay trong
      // luong that. Khong thay thi giu nguyen track mac dinh cua luong.
      if (preferredAudioTrack) {
        const match = tracks.find((t) => t.name.toLowerCase().includes(preferredAudioTrack.toLowerCase()));
        if (match) {
          hls.audioTrack = match.id;
          setCurrentAudio(match.id);
          return;
        }
      }
      setCurrentAudio(hls.audioTrack);
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      // Chi bao loi khi KHONG the phuc hoi - hls.js tu retry duoc rat nhieu
      // loi mang tam thoi, bao het ra man hinh se nhieu vo ich.
      if (!data.fatal) return;
      setError(
        data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? "Không tải được luồng phát (kiểm tra lại URL hoặc nguồn đã tắt)."
          : "Luồng phát bị lỗi, không phát tiếp được.",
      );
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [src, preferredAudioTrack]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  return (
    <div className="iptv-player">
      {error && <p className="meet-error">{error}</p>}
      <video ref={videoRef} controls playsInline className="meet-iptv-video" />

      <div className="iptv-player-controls">
        <label className="meet-volume">
          🔊 Âm lượng
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>

        {audioTracks.length > 1 && (
          <label className="meet-volume">
            🎧 Tiếng
            <select
              value={currentAudio ?? 0}
              onChange={(e) => {
                const id = Number(e.target.value);
                if (hlsRef.current) hlsRef.current.audioTrack = id;
                setCurrentAudio(id);
              }}
            >
              {audioTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
