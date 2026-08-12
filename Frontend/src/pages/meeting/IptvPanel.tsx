import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { iptvApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";

// UC-37: nguoi khoi dong bao cho server la minh mo Mini App (kiem tra quyen),
// nhung LUONG PHAT thi MOI NGUOI TRONG PHONG TU FETCH RIENG - khong stream
// qua LiveKit. Vi Media Service chua co tang WebSocket, viec "ca phong cung
// xem 1 kenh" hien phai tu thoa thuan qua chat/loi noi, khong tu dong bo
// duoc (da ghi ro trong MiniAppSessionEndpoints.cs).
export function IptvPanel({ meetingId, onClose }: { meetingId: number; onClose: () => void }) {
  const [lists, setLists] = useState<IptvChannelList[]>([]);
  const [selectedList, setSelectedList] = useState<number | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [playingName, setPlayingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    iptvApi
      .startMiniApp(meetingId)
      .then(() => iptvApi.listChannelLists())
      .then((res) => {
        setLists(res.data);
        if (res.data.length > 0) setSelectedList(res.data[0].id);
      })
      .catch((err) => setError(extractApiError(err, "Không mở được Mini App IPTV")));
  }, [meetingId]);

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
    } catch (err) {
      setError(extractApiError(err, "Không lấy được luồng phát"));
    }
  }

  return (
    <aside className="meet-side">
      <div className="meet-side-head">
        <h3>Mini App · IPTV</h3>
        <button onClick={onClose}>Đóng</button>
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
          {/* Chi phat duoc dinh dang trinh duyet ho tro san (MP4/WebM, hoac
              HLS tren Safari). Luong .m3u8 tren Chrome/Firefox can them thu
              vien hls.js - chua dua vao de khong keo them phu thuoc khi chua
              co nguon phat that de kiem chung. */}
          <video ref={videoRef} src={streamUrl} controls autoPlay className="meet-iptv-video" />
          <a href={streamUrl} target="_blank" rel="noreferrer" className="meet-note">
            Mở luồng ở tab mới
          </a>
        </div>
      )}
    </aside>
  );
}
