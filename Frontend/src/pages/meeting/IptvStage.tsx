import { useEffect, useState } from "react";
import { iptvApi } from "../../api/mediaApi";
import { IptvPlayer } from "./IptvPlayer";
import { extractApiError } from "../../lib/apiError";

// Khung trinh bay Mini App IPTV o giua man hinh - CHI co trinh phat, khong
// co danh sach kenh (danh sach nam trong popup, xem IptvChannelPicker).
//
// channelId den tu TRANG THAI TRINH BAY chung cua phong chu khong phai state
// cua rieng component nay. Hai he qua quan trong:
//  - Moi nguoi trong phong cung xem mot kenh, dung UC-37: nguoi trinh bay
//    chon, con luong phat thi MOI MAY TU FETCH RIENG (khong day qua LiveKit).
//  - Doi bo cuc (bam "Xem dang luoi" roi quay lai) khong lam mat kenh dang
//    chieu, vi component nay co thao ra roi gan lai thi channelId van con
//    nguyen o tren.
export function IptvStage({
  meetingId,
  channelId,
  channelName,
  canPick,
  onOpenPicker,
  compact = false,
}: {
  meetingId: number;
  channelId: number | null;
  channelName: string | null;
  canPick: boolean;
  onOpenPicker: () => void;
  // compact = dang nam trong mot O LUOI chu khong phai khung trung tam:
  // khong con cho cho nut/link phu, chi giu dung trinh phat.
  compact?: boolean;
}) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [audioTrack, setAudioTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (channelId === null) {
      setStreamUrl(null);
      return;
    }

    let cancelled = false;
    setError(null);
    iptvApi
      .getStreamUrl(meetingId, channelId)
      .then((res) => {
        if (cancelled) return;
        setStreamUrl(res.data.streamUrl);
        setAudioTrack(res.data.audioTrack);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err, "Không lấy được luồng phát"));
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId, channelId]);

  return (
    <div className={compact ? "meet-app-stage meet-app-compact" : "meet-app-stage"}>
      <div className="meet-side-head">
        <h3>{compact ? (channelName ?? "Mini App · IPTV") : `Mini App · IPTV${channelName ? ` · ${channelName}` : ""}`}</h3>
        {canPick && !compact && (
          <button onClick={onOpenPicker}>{channelId === null ? "Chọn kênh" : "Đổi kênh"}</button>
        )}
      </div>

      {error && <p className="meet-error">{error}</p>}

      {channelId === null ? (
        <p className="meet-empty">
          Đang chờ gắn link kênh…
          {canPick && !compact && " Bấm “Chọn kênh” để phát cho cả phòng."}
          {canPick && compact && " Bấm “Mini App IPTV” ở trên để chọn."}
        </p>
      ) : !streamUrl && !error ? (
        <p className="meet-empty">Đang lấy luồng phát…</p>
      ) : (
        streamUrl && (
          <>
            {/* Phat qua hls.js (xem IptvPlayer.tsx) - the <video> thuan chi
                phat duoc .m3u8 tren Safari, Chrome/Firefox thi khong phat gi. */}
            <IptvPlayer src={streamUrl} preferredAudioTrack={audioTrack} />
            {!compact && (
              <a href={streamUrl} target="_blank" rel="noreferrer" className="meet-note">
                Mở luồng ở tab mới
              </a>
            )}
          </>
        )
      )}
    </div>
  );
}
