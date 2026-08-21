import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { iptvApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";

// Popup chon kenh, CHI nguoi trinh bay thay.
//
// Truoc day danh sach nam ngay trong khung trinh bay o giua man hinh: bam
// "Xem" mot kenh thi danh sach van nam nguyen do, day trinh phat xuong duoi
// va phai cuon moi thay. Dua vao popup thi chon xong la dong lai, khung giua
// chi con dung mot thu can nhin - luong phat.
export function IptvChannelPicker({
  onPick,
  onClose,
}: {
  onPick: (channelId: number, channelName: string) => void;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<IptvChannelList[]>([]);
  const [selectedList, setSelectedList] = useState<number | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    iptvApi
      .listChannelLists()
      .then((res) => {
        setLists(res.data);
        if (res.data.length > 0) setSelectedList(res.data[0].id);
      })
      .catch((err) => setError(extractApiError(err, "Không tải được danh sách kênh")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedList === null) return;
    iptvApi
      .listGroups(selectedList)
      .then((res) => setGroups(res.data))
      .catch((err) => setError(extractApiError(err, "Không tải được nhóm kênh")));
  }, [selectedList]);

  // Playlist nhap tu M3U co the co hang tram kenh trong hang chuc nhom -
  // khong co o loc thi khong tim noi kenh muon xem.
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? groups
        .map((g) => ({ ...g, channels: g.channels.filter((c) => c.channelName.toLowerCase().includes(needle)) }))
        .filter((g) => g.channels.length > 0)
    : groups;

  const totalShown = shown.reduce((n, g) => n + g.channels.length, 0);

  return (
    <div className="iptv-picker-overlay" onClick={onClose}>
      <div className="iptv-picker" onClick={(e) => e.stopPropagation()}>
        <div className="iptv-picker-head">
          <h3>Chọn kênh phát cho cả phòng</h3>
          <button onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        {error && <p className="meet-error">{error}</p>}

        {loading ? (
          <p className="meet-empty">Đang tải...</p>
        ) : lists.length === 0 ? (
          <p className="meet-empty">
            Bạn chưa có danh sách kênh nào. <Link to="/app/iptv">Tạo danh sách</Link>
          </p>
        ) : (
          <>
            <div className="iptv-picker-controls">
              <select value={selectedList ?? ""} onChange={(e) => setSelectedList(Number(e.target.value))}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Tìm kênh..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>

            <div className="iptv-picker-body">
              {totalShown === 0 ? (
                <p className="meet-empty">{needle ? "Không có kênh nào khớp." : "Danh sách này chưa có kênh nào."}</p>
              ) : (
                shown.map((g) => (
                  <div key={g.id} className="iptv-picker-group">
                    <strong>{g.groupName}</strong>
                    <ul>
                      {g.channels.map((c) => (
                        <li key={c.id}>
                          <button onClick={() => onPick(c.id, c.channelName)}>{c.channelName}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
