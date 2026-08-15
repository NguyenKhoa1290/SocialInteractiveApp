import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { iptvApi, meetingApi } from "../../api/mediaApi";
import { IptvPlayer } from "./IptvPlayer";
import { extractApiError } from "../../lib/apiError";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";

// UC-37: nguoi khoi dong bao cho server la minh mo Mini App (kiem tra quyen),
// nhung LUONG PHAT thi MOI NGUOI TRONG PHONG TU FETCH RIENG - khong stream
// qua LiveKit. Vi Media Service chua co tang WebSocket, viec "ca phong cung
// xem 1 kenh" hien phai tu thoa thuan qua chat/loi noi, khong tu dong bo
// duoc (da ghi ro trong MiniAppSessionEndpoints.cs).
export function IptvPanel({
  meetingId,
  onClose,
  stage = false,
}: {
  meetingId: number;
  onClose: () => void;
  // stage = dang o khung trung tam cua focus mode (khong phai panel ben canh)
  stage?: boolean;
}) {
  const [lists, setLists] = useState<IptvChannelList[]>([]);
  const [selectedList, setSelectedList] = useState<number | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [playingName, setPlayingName] = useState<string | null>(null);
  // Track am thanh "uu tien" do nguoi tao kenh nhap - chi la goi y, trinh
  // phat se doi chieu voi danh sach track THAT trong luong.
  const [playingAudioTrack, setPlayingAudioTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Chi ban dieu khien (panel ben canh) moi GIANH suat trinh bay - ban o
    // khung trung tam la KET QUA cua viec da gianh duoc, goi lai se thanh
    // vong lap. Gianh suat lam ca phong vao focus mode va chan nguoi khac
    // trinh bay cung luc (giong Teams).
    const claim = stage
      ? Promise.resolve()
      : meetingApi.startPresentation(meetingId, "mini_app", { appId: "iptv" }).then(() => undefined);

    claim
      .then(() => iptvApi.startMiniApp(meetingId))
      .then(() => iptvApi.listChannelLists())
      .then((res) => {
        setLists(res.data);
        if (res.data.length > 0) setSelectedList(res.data[0].id);
      })
      .catch((err) => setError(extractApiError(err, "Không mở được Mini App IPTV")));
  }, [meetingId, stage]);

  useEffect(() => {
    if (selectedList === null) return;
    iptvApi
      .listGroups(selectedList)
      .then((res) => setGroups(res.data))
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách kênh")));
  }, [selectedList]);

  async function play(channelId: number, name: string) {
    setError(null);
    try {
      const res = await iptvApi.getStreamUrl(meetingId, channelId);
      setStreamUrl(res.data.streamUrl);
      setPlayingName(name);
      setPlayingAudioTrack(res.data.audioTrack);
    } catch (err) {
      setError(extractApiError(err, "Không lấy được luồng phát"));
    }
  }

  return (
    <aside className={stage ? "meet-app-stage" : "meet-side"}>
      <div className="meet-side-head">
        <h3>Mini App · IPTV</h3>
        {!stage && <button onClick={onClose}>Đóng</button>}
      </div>

      {error && <p className="meet-error">{error}</p>}

      {lists.length === 0 ? (
        <p className="meet-empty">
          Bạn chưa có danh sách kênh nào. <Link to="/app/iptv">Tạo danh sách</Link>
        </p>
      ) : (
        <select value={selectedList ?? ""} onChange={(e) => setSelectedList(Number(e.target.value))}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}

      {groups.map((g) => (
        <div key={g.id} className="meet-iptv-group">
          <strong>{g.groupName}</strong>
          <ul className="meet-people">
            {g.channels.map((c) => (
              <li key={c.id}>
                <span>{c.channelName}</span>
                <button onClick={() => play(c.id, c.channelName)}>Xem</button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {streamUrl && (
        <div className="meet-iptv-player">
          <p className="meet-note">Đang phát: {playingName}</p>
          {/* Phat qua hls.js (xem IptvPlayer.tsx) - the <video> thuan chi
              phat duoc .m3u8 tren Safari, Chrome/Firefox thi khong phat gi. */}
          <IptvPlayer src={streamUrl} preferredAudioTrack={playingAudioTrack} />
          <a href={streamUrl} target="_blank" rel="noreferrer" className="meet-note">
            Mở luồng ở tab mới
          </a>
        </div>
      )}
    </aside>
  );
}
