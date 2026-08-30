import { useEffect, useMemo, useState } from "react";
import { iptvApi } from "../../api/mediaApi";
import { useAuthStore } from "../../store/authStore";
import { decodeJwtIsAdmin } from "../../lib/jwt";
import { extractApiError } from "../../lib/apiError";
import { AppShell } from "../../components/AppShell";
import { AddPlaylistDialog } from "./AddPlaylistDialog";
import { MiniAppInfoDialog } from "./MiniAppInfoDialog";
import { MiniAppIcon } from "./MiniAppIcon";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";
import "./miniapp.css";

// Màn Mini App - Figma node 90:173. Ba panel, trái sang phải:
//   1. Danh sách Mini App (hiện chỉ có Calli IPTV là app thật)
//   2. Danh sách Playlist: playlist riêng của mình, rồi mục "Admin Playlist"
//   3. Kênh của playlist đang chọn, nhóm theo "playlist con"
//
// Playlist dùng chung là tính năng chủ dự án thêm sau: quản trị viên đặt sẵn
// một số playlist, mọi người đều thấy và xem được nhưng không sửa được.

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
      <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function MiniAppPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const laAdmin = accessToken !== null && decodeJwtIsAdmin(accessToken);

  const [lists, setLists] = useState<IptvChannelList[] | null>(null);
  const [dangChon, setDangChon] = useState<number | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ghiChu, setGhiChu] = useState<string | null>(null);

  const [timPlaylist, setTimPlaylist] = useState("");
  const [timKenh, setTimKenh] = useState("");
  const [hienThemPlaylist, setHienThemPlaylist] = useState(false);
  const [hienThongTin, setHienThongTin] = useState(false);
  const [themKenhVao, setThemKenhVao] = useState<number | null>(null);
  const [kenhMoi, setKenhMoi] = useState({ ten: "", url: "" });
  const [nhomMoi, setNhomMoi] = useState<string | null>(null);
  const [dangLam, setDangLam] = useState(false);

  async function napDanhSach(chon?: number) {
    const { data } = await iptvApi.listChannelLists();
    setLists(data);
    if (chon !== undefined) setDangChon(chon);
    else if (data.length > 0) setDangChon((truoc) => (truoc === null ? data[0].id : truoc));
    else setDangChon(null);
  }

  useEffect(() => {
    napDanhSach().catch((err) => {
      setLists([]);
      setError(extractApiError(err, "Không tải được danh sách playlist"));
    });
  }, []);

  useEffect(() => {
    if (dangChon === null) {
      setGroups(null);
      return;
    }
    let huy = false;
    setGroups(null);
    setNhomMoi(null);
    setThemKenhVao(null);
    iptvApi
      .listGroups(dangChon)
      .then((r) => {
        if (!huy) setGroups(r.data);
      })
      .catch((err) => {
        if (!huy) {
          setGroups([]);
          setError(extractApiError(err, "Không tải được kênh"));
        }
      });
    return () => {
      huy = true;
    };
  }, [dangChon]);

  const playlistCuaToi = useMemo(
    () => (lists ?? []).filter((l) => !l.isShared && khop(l.name, timPlaylist)),
    [lists, timPlaylist],
  );
  const playlistAdmin = useMemo(
    () => (lists ?? []).filter((l) => l.isShared && khop(l.name, timPlaylist)),
    [lists, timPlaylist],
  );
  const chon = (lists ?? []).find((l) => l.id === dangChon) ?? null;

  // Lọc kênh theo ô tìm, và bỏ luôn nhóm không còn kênh nào khớp - để lại
  // một nhóm rỗng thì người dùng tưởng nhóm đó không có gì.
  const nhomHienThi = useMemo(() => {
    if (!groups) return null;
    const q = timKenh.trim().toLowerCase();
    if (q === "") return groups;
    return groups
      .map((g) => ({ ...g, channels: g.channels.filter((c) => c.channelName.toLowerCase().includes(q)) }))
      .filter((g) => g.channels.length > 0);
  }, [groups, timKenh]);

  async function xoaPlaylist(l: IptvChannelList) {
    if (!window.confirm(`Xoá playlist “${l.name}”? Toàn bộ kênh trong đó sẽ mất.`)) return;
    setError(null);
    try {
      await iptvApi.deleteChannelList(l.id);
      // Xoa dung cai dang mo thi de napDanhSach tu chon lai cai dau tien;
      // xoa cai khac thi giu nguyen lua chon hien tai.
      const giuLai = dangChon === l.id ? undefined : (dangChon ?? undefined);
      if (dangChon === l.id) setDangChon(null);
      await napDanhSach(giuLai);
    } catch (err) {
      setError(extractApiError(err, "Không xoá được playlist"));
    }
  }

  // Playlist tao tay thi KHONG co nhom nao ca, ma them kenh lai bat buoc phai
  // co nhom truoc - thieu duong nay thi mot playlist rong la ngo cut. Nhom chi
  // tu sinh khi nhap tu link M3U (theo group-title cua nguon).
  async function themNhom(e: React.FormEvent) {
    e.preventDefault();
    if (dangChon === null || !nhomMoi?.trim()) return;
    setDangLam(true);
    setError(null);
    try {
      await iptvApi.createGroup(dangChon, nhomMoi.trim());
      const { data } = await iptvApi.listGroups(dangChon);
      setGroups(data);
      setNhomMoi(null);
    } catch (err) {
      setError(extractApiError(err, "Không thêm được playlist con"));
    } finally {
      setDangLam(false);
    }
  }

  async function themKenh(e: React.FormEvent) {
    e.preventDefault();
    if (dangChon === null || themKenhVao === null) return;
    if (!kenhMoi.ten.trim() || !kenhMoi.url.trim()) return;
    setDangLam(true);
    setError(null);
    try {
      await iptvApi.createChannel(dangChon, themKenhVao, kenhMoi.ten.trim(), kenhMoi.url.trim());
      const { data } = await iptvApi.listGroups(dangChon);
      setGroups(data);
      setKenhMoi({ ten: "", url: "" });
      setThemKenhVao(null);
    } catch (err) {
      setError(extractApiError(err, "Không thêm được kênh"));
    } finally {
      setDangLam(false);
    }
  }

  async function xoaNhom(g: IptvChannelGroup) {
    if (dangChon === null) return;
    // Hoi lai vi keo theo ca kenh ben trong - khac han xoa mot kenh le.
    const them = g.channels.length > 0 ? ` cùng ${g.channels.length} kênh trong đó` : "";
    if (!window.confirm(`Xoá playlist con “${g.groupName}”${them}?`)) return;
    setError(null);
    try {
      await iptvApi.deleteGroup(dangChon, g.id);
      setGroups((truoc) => (truoc ?? []).filter((x) => x.id !== g.id));
      if (themKenhVao === g.id) setThemKenhVao(null);
    } catch (err) {
      setError(extractApiError(err, "Không xoá được playlist con"));
    }
  }

  async function xoaKenh(groupId: number, channelId: number) {
    if (dangChon === null) return;
    setError(null);
    try {
      await iptvApi.deleteChannel(dangChon, groupId, channelId);
      setGroups((truoc) =>
        (truoc ?? []).map((g) =>
          g.id === groupId ? { ...g, channels: g.channels.filter((c) => c.id !== channelId) } : g,
        ),
      );
    } catch (err) {
      setError(extractApiError(err, "Không xoá được kênh"));
    }
  }

  function veHangPlaylist(l: IptvChannelList) {
    return (
      <div key={l.id} className={`ma-row${l.id === dangChon ? " active" : ""}`}>
        <button className="ma-row-main" onClick={() => setDangChon(l.id)}>
          {l.name}
        </button>
        {l.canEdit && (
          <button className="ma-row-x" onClick={() => void xoaPlaylist(l)} title="Xoá playlist">
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <AppShell activeTab="miniapp">
      <div className="ma">
        {/* --- Panel 1: danh sách Mini App --- */}
        <div className="ma-col">
          <div className="ma-search">
            <IconSearch />
            <input placeholder="Tìm kiếm Mini App" aria-label="Tìm kiếm Mini App" disabled />
          </div>
          <p className="ma-section">Danh sách MiniApp</p>

          <div className="ma-app active">
            <MiniAppIcon />
            <div className="ma-app-body">
              <p className="ma-app-name">Calli IPTV</p>
              <p className="ma-app-sub">Cần vào cuộc họp: Phát kênh cho cả phòng cùng xem</p>
            </div>
          </div>
        </div>

        {/* --- Panel 2: playlist --- */}
        <div className="ma-col">
          <div className="ma-search">
            <IconSearch />
            <input
              value={timPlaylist}
              onChange={(e) => setTimPlaylist(e.target.value)}
              placeholder="Tìm kiếm Playlist"
              aria-label="Tìm kiếm Playlist"
            />
          </div>

          <p className="ma-section">Danh sách Playlist</p>
          {lists === null && <p className="ma-empty">Đang tải…</p>}
          {lists !== null && playlistCuaToi.length === 0 && (
            <p className="ma-empty">Bạn chưa có playlist riêng nào.</p>
          )}
          {playlistCuaToi.map(veHangPlaylist)}

          <p className="ma-section ma-section-admin">Admin Playlist</p>
          {lists !== null && playlistAdmin.length === 0 && (
            <p className="ma-empty">Quản trị viên chưa đặt playlist dùng chung nào.</p>
          )}
          {playlistAdmin.map(veHangPlaylist)}

          <div className="ma-col-actions">
            <button className="ma-pill" onClick={() => setHienThemPlaylist(true)}>
              Thêm playlist
            </button>
            <button className="ma-pill ma-pill-ghost" onClick={() => setHienThongTin(true)}>
              Thông tin chi tiết mini app
            </button>
          </div>
        </div>

        {/* --- Panel 3: kênh --- */}
        <div className="ma-col">
          <div className="ma-search">
            <IconSearch />
            <input
              value={timKenh}
              onChange={(e) => setTimKenh(e.target.value)}
              placeholder="Tìm kiếm Kênh"
              aria-label="Tìm kiếm Kênh"
              disabled={dangChon === null}
            />
          </div>

          {chon === null && <p className="ma-empty">Chọn một playlist ở giữa để xem kênh.</p>}

          {chon !== null && (
            <>
              {chon.isShared && !chon.canEdit && (
                <p className="ma-note">Playlist dùng chung của quản trị viên — bạn xem được nhưng không sửa.</p>
              )}
              {chon.canEdit && (
                <div className="ma-section ma-section-row">
                  <span>Playlist con</span>
                  <button
                    className="ma-pill ma-pill-sm"
                    onClick={() => setNhomMoi((truoc) => (truoc === null ? "" : null))}
                  >
                    {nhomMoi === null ? "Thêm playlist con" : "Huỷ"}
                  </button>
                </div>
              )}

              {nhomMoi !== null && (
                <form className="ma-add-channel" onSubmit={themNhom}>
                  <input
                    className="ma-input"
                    value={nhomMoi}
                    onChange={(e) => setNhomMoi(e.target.value)}
                    placeholder="Tên playlist con (ví dụ: Thời sự)"
                    autoFocus
                  />
                  <button className="ma-pill" type="submit" disabled={dangLam || !nhomMoi.trim()}>
                    {dangLam ? "Đang thêm…" : "Lưu playlist con"}
                  </button>
                </form>
              )}

              {groups === null && <p className="ma-empty">Đang tải…</p>}
              {groups?.length === 0 && (
                <p className="ma-empty">
                  Playlist này chưa có kênh nào. Thêm một playlist con ở trên rồi thêm kênh vào đó.
                </p>
              )}
              {nhomHienThi?.length === 0 && (groups?.length ?? 0) > 0 && (
                <p className="ma-empty">Không có kênh nào khớp “{timKenh.trim()}”.</p>
              )}

              {nhomHienThi?.map((g) => (
                <div key={g.id} className = "channel-structure">
                  <div className="ma-section ma-section-row">
                    <span className="ma-group-name">{g.groupName}</span>
                    {chon.canEdit && (
                      <span className="ma-group-acts">
                        <button
                          className="ma-pill ma-pill-sm"
                          onClick={() => {
                            setThemKenhVao((truoc) => (truoc === g.id ? null : g.id));
                            setKenhMoi({ ten: "", url: "" });
                          }}
                        >
                          Thêm kênh
                        </button>
                        <button
                          className="ma-row-x"
                          onClick={() => void xoaNhom(g)}
                          title="Xoá playlist con"
                          aria-label={`Xoá playlist con ${g.groupName}`}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>

                  {themKenhVao === g.id && (
                    <form className="ma-add-channel" onSubmit={themKenh}>
                      <input
                        className="ma-input"
                        value={kenhMoi.ten}
                        onChange={(e) => setKenhMoi((k) => ({ ...k, ten: e.target.value }))}
                        placeholder="Tên kênh"
                        autoFocus
                      />
                      <input
                        className="ma-input"
                        value={kenhMoi.url}
                        onChange={(e) => setKenhMoi((k) => ({ ...k, url: e.target.value }))}
                        placeholder="Link luồng (.m3u8 / .mpd)"
                      />
                      <button className="ma-pill" type="submit" disabled={dangLam}>
                        {dangLam ? "Đang thêm…" : "Lưu kênh"}
                      </button>
                    </form>
                  )}

                  {g.channels.map((c) => (
                    <div key={c.id} className="ma-row">
                      <span className="ma-row-main ma-row-static" title={c.streamUrl}>
                        {c.channelName}
                      </span>
                      {chon.canEdit && (
                        <button className="ma-row-x" onClick={() => void xoaKenh(g.id, c.id)} title="Xoá kênh">
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {error && <p className="ma-banner ma-banner-err">{error}</p>}
      {ghiChu && <p className="ma-banner">{ghiChu}</p>}

      {hienThemPlaylist && (
        <AddPlaylistDialog
          laAdmin={laAdmin}
          onClose={() => setHienThemPlaylist(false)}
          onCreated={(listId, loi) => {
            setHienThemPlaylist(false);
            // Nhap khong tron ven thi mo thang playlist do ra kem loi - nguoi
            // dung nhin duoc ngay phan da vao va phan con thieu.
            if (loi) {
              setGhiChu(null);
              setError(loi);
            } else {
              setError(null);
              setGhiChu("Đã thêm playlist.");
            }
            void napDanhSach(listId);
          }}
        />
      )}
      {hienThongTin && <MiniAppInfoDialog onClose={() => setHienThongTin(false)} />}
    </AppShell>
  );
}

function khop(ten: string, q: string) {
  const t = q.trim().toLowerCase();
  return t === "" || ten.toLowerCase().includes(t);
}
