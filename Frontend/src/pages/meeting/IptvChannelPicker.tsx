import { useEffect, useState, type FormEvent } from "react";
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
  onPlayDirect,
  onClose,
}: {
  onPick: (channelId: number, channelName: string) => void;
  // Phat mot link dan thang, khong luu vao danh sach nao. NEM neu link khong
  // dung - popup giu nguyen de nguoi dung sua, chu khong dong lai roi de ho
  // doan xem hong o dau.
  onPlayDirect: (url: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<IptvChannelList[]>([]);
  const [selectedList, setSelectedList] = useState<number | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Duong thu hai, song song voi danh sach: dan thang mot link vao xem ngay.
  const [directUrl, setDirectUrl] = useState("");
  const [directName, setDirectName] = useState("");
  const [directBusy, setDirectBusy] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  async function submitDirect(e: FormEvent) {
    e.preventDefault();
    const url = directUrl.trim();
    if (!url || directBusy) return;
    setDirectBusy(true);
    setDirectError(null);
    try {
      await onPlayDirect(url, directName.trim());
      onClose();
    } catch (err) {
      setDirectError(extractApiError(err, "Không phát được link này"));
    } finally {
      setDirectBusy(false);
    }
  }

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

        {/* Dan link thang - de o TREN danh sach vi day thuong la viec gap
            ("co link tran dau, mo len xem luon"), con danh sach la thu dung
            lau. Hai duong doc lap: dung duong nay khong dong gi den danh
            sach da luu. */}
        <form className="iptv-direct" onSubmit={submitDirect}>
          <strong>Phát link trực tiếp</strong>
          <input
            placeholder="https://.../stream.m3u8"
            value={directUrl}
            onChange={(e) => setDirectUrl(e.target.value)}
          />
          <input
            placeholder="Tên hiển thị (tuỳ chọn)"
            value={directName}
            onChange={(e) => setDirectName(e.target.value)}
          />
          <button type="submit" disabled={directBusy || directUrl.trim().length === 0}>
            {directBusy ? "Đang kiểm tra…" : "Phát ngay"}
          </button>
        </form>
        {directError && <p className="meet-error">{directError}</p>}

        <div className="iptv-picker-or">hoặc chọn từ danh sách đã lưu</div>

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
