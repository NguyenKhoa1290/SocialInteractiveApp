import { useState } from "react";
import { iptvApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import { Modal } from "../../components/Modal";
import { MiniAppIcon } from "./MiniAppIcon";

// Popup "Thêm playlist IPTV" - Figma node 112:695.
//
// Thiết kế gồm: tên playlist, công tắc "Tự động nhận diện playlist con",
// ô nhập link, nút "Thêm link", và một dòng báo lỗi ("Kênh không hợp lệ").
//
// Link là TUỲ CHỌN: tạo một playlist rỗng rồi tự thêm kênh tay cũng hợp lệ,
// và đó là đường duy nhất khi nguồn không phải M3U.
export function AddPlaylistDialog({
  laAdmin,
  onClose,
  onCreated,
}: {
  // Admin được thêm một lựa chọn nữa: đặt playlist này dùng chung cho mọi
  // người. Người thường không thấy công tắc đó (server vẫn chặn bằng 403).
  laAdmin: boolean;
  onClose: () => void;
  // `loi` khac null nghia la playlist DA TAO nhung buoc nhap link khong tron
  // ven - noi goi phai mo playlist do ra va noi ro, khong duoc im lang.
  onCreated: (listId: number, loi?: string) => void;
}) {
  const [ten, setTen] = useState("");
  const [link, setLink] = useState("");
  const [tuTachNhom, setTuTachNhom] = useState(true);
  const [dungChung, setDungChung] = useState(false);
  const [dangLam, setDangLam] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [ghiChu, setGhiChu] = useState<string | null>(null);

  async function them(e: React.FormEvent) {
    e.preventDefault();
    if (!ten.trim()) return;
    setDangLam(true);
    setLoi(null);
    setGhiChu(null);
    try {
      const { data } = await iptvApi.createChannelList(ten.trim(), dungChung);

      if (link.trim()) {
        try {
          const { data: kq } = await iptvApi.importPlaylist(data.id, link.trim(), tuTachNhom);
          if (!kq.isPlaylist) {
            setGhiChu("Link này là một luồng đơn, không phải danh sách kênh — hãy thêm nó như một kênh.");
            setDangLam(false);
            return;
          }
        } catch (err) {
          // Playlist ĐÃ TẠO rồi, và bước nhập có thể đã ghi được một phần
          // trước khi hỏng. Đóng lại rồi im lặng là nói dối: người dùng thấy
          // báo lỗi nhưng mở ra vẫn có cả danh sách kênh. Mở thẳng playlist
          // đó ra kèm lời giải thích.
          onCreated(data.id, extractApiError(err, "Không nhập được hết playlist — hãy kiểm tra lại danh sách kênh."));
          return;
        }
      }

      onCreated(data.id);
    } catch (err) {
      setLoi(extractApiError(err, "Không tạo được playlist"));
      setDangLam(false);
    }
  }

  return (
    <Modal title="" onClose={onClose} width={589}>
      <form onSubmit={them} className="ma-dialog">
        <div className="ma-dialog-head">
          <MiniAppIcon />
          <span className="ma-dialog-app">Calli IPTV</span>
        </div>

        <div className="ma-row-2">
          <label className="ma-field">
            <span>Thêm tên playlist</span>
            <input
              className="ma-input"
              value={ten}
              onChange={(e) => setTen(e.target.value)}
              maxLength={100}
              placeholder="Ví dụ: Kênh Việt Nam"
              autoFocus
            />
          </label>

          <label className="ma-switch">
            <input type="checkbox" checked={tuTachNhom} onChange={(e) => setTuTachNhom(e.target.checked)} />
            <span>Tự động nhận diện playlist con</span>
          </label>
        </div>

        <label className="ma-field">
          <span>Nhập link</span>
          <input
            className="ma-input ma-input-lg"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://… (.m3u / .m3u8) — để trống nếu muốn tự thêm kênh"
          />
        </label>

        {laAdmin && (
          <label className="ma-switch">
            <input type="checkbox" checked={dungChung} onChange={(e) => setDungChung(e.target.checked)} />
            <span>Đặt làm Admin Playlist (mọi người đều thấy)</span>
          </label>
        )}

        {loi && <p className="ma-err">{loi}</p>}
        {ghiChu && <p className="ma-note">{ghiChu}</p>}

        <div className="ma-dialog-actions">
          <button type="submit" className="md-btn" disabled={dangLam || !ten.trim()}>
            {dangLam ? "Đang thêm…" : link.trim() ? "Thêm link" : "Tạo playlist"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
