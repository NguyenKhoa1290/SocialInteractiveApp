import { useState, type FormEvent } from "react";
import { iptvApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import { Modal } from "../../components/Modal";
import type { IptvChannelList } from "../../types/media";
import { MiniAppIcon } from "./MiniAppIcon";

// Cung khuon voi popup Them playlist, nhung luu ca bon thu nguoi dung can
// dieu chinh: ten, link nguon, cach tach playlist con va pham vi ca nhan /
// Admin Playlist. Server van la noi kiem tra quyen cuoi cung.
export function EditPlaylistDialog({
  playlist,
  laAdmin,
  onClose,
  onUpdated,
}: {
  playlist: IptvChannelList;
  laAdmin: boolean;
  onClose: () => void;
  onUpdated: (playlist: IptvChannelList) => void;
}) {
  const [ten, setTen] = useState(playlist.name);
  const [link, setLink] = useState(playlist.sourceUrl ?? "");
  const [tuTachNhom, setTuTachNhom] = useState(playlist.autoGroups);
  const [dungChung, setDungChung] = useState(playlist.isShared);
  const [dangLam, setDangLam] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  async function luu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ten.trim()) return;
    setDangLam(true);
    setLoi(null);
    try {
      const { data } = await iptvApi.updateChannelList(playlist.id, {
        name: ten.trim(),
        url: link,
        autoGroups: tuTachNhom,
        shared: laAdmin ? dungChung : false,
      });
      onUpdated(data);
    } catch (err) {
      setLoi(extractApiError(err, "Không cập nhật được playlist"));
      setDangLam(false);
    }
  }

  const close = () => {
    if (!dangLam) onClose();
  };

  return (
    <Modal title="" onClose={close} width={589} closeOnEscape={!dangLam}>
      <form onSubmit={luu} className="ma-dialog">
        <div className="ma-dialog-head">
          <MiniAppIcon />
          <span className="ma-dialog-app">Điều chỉnh Calli IPTV</span>
        </div>

        <div className="ma-row-2">
          <label className="ma-field">
            <span>Tên playlist</span>
            <input
              className="ma-input"
              value={ten}
              onChange={(event) => setTen(event.target.value)}
              maxLength={100}
              autoFocus
              disabled={dangLam}
            />
          </label>

          <label className="ma-switch">
            <input
              type="checkbox"
              checked={tuTachNhom}
              onChange={(event) => setTuTachNhom(event.target.checked)}
              disabled={dangLam}
            />
            <span>Tự động nhận diện playlist con</span>
          </label>
        </div>

        <label className="ma-field">
          <span>Link nguồn</span>
          <input
            className="ma-input ma-input-lg"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://… (.m3u / .m3u8) - để trống để ngừng tự làm mới"
            disabled={dangLam}
          />
        </label>

        {laAdmin && (
          <label className="ma-switch">
            <input
              type="checkbox"
              checked={dungChung}
              onChange={(event) => setDungChung(event.target.checked)}
              disabled={dangLam}
            />
            <span>Đặt làm Admin Playlist (mọi người đều thấy)</span>
          </label>
        )}

        <p className="ma-note">
          Khi lưu link nguồn, hệ thống sẽ kiểm tra và đồng bộ lại danh sách kênh. Để trống link chỉ dừng tự làm mới, không xoá các kênh hiện có.
        </p>
        {loi && <p className="ma-err">{loi}</p>}

        <div className="ma-dialog-actions">
          <button type="submit" className="md-btn" disabled={dangLam || !ten.trim()}>
            {dangLam ? "Đang cập nhật…" : "Lưu thay đổi"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
