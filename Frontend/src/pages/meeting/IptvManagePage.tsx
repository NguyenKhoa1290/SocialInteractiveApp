import { useEffect, useState } from "react";
import { iptvApi } from "../../api/mediaApi";
import { AppShell } from "../../components/AppShell";
import { extractApiError } from "../../lib/apiError";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";
import "./meeting.css";

// Danh sach kenh la CUA RIENG tung user (khong gan voi 1 cuoc hop cu the) -
// quan ly o day truoc, khi vao hop thi chon 1 kenh de xem (IptvPanel).
export function IptvManagePage() {
  const [lists, setLists] = useState<IptvChannelList[]>([]);
  const [selectedList, setSelectedList] = useState<number | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newListName, setNewListName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [channelForm, setChannelForm] = useState<{ groupId: number; name: string; url: string; audio: string } | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);

  async function loadLists(selectId?: number) {
    const res = await iptvApi.listChannelLists();
    setLists(res.data);
    if (selectId) setSelectedList(selectId);
    else if (res.data.length > 0 && selectedList === null) setSelectedList(res.data[0].id);
  }

  async function loadGroups(listId: number) {
    const res = await iptvApi.listGroups(listId);
    setGroups(res.data);
  }

  useEffect(() => {
    loadLists().catch((err) => setError(extractApiError(err, "Không tải được danh sách kênh")));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedList === null) return;
    loadGroups(selectedList).catch((err) => setError(extractApiError(err, "Không tải được nhóm kênh")));
  }, [selectedList]);

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await iptvApi.createChannelList(newListName.trim());
      setNewListName("");
      await loadLists(res.data.id);
    } catch (err) {
      setError(extractApiError(err, "Không tạo được danh sách"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (selectedList === null || !newGroupName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await iptvApi.createGroup(selectedList, newGroupName.trim());
      setNewGroupName("");
      await loadGroups(selectedList);
    } catch (err) {
      setError(extractApiError(err, "Không tạo được nhóm kênh"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    if (selectedList === null || !channelForm) return;
    if (!channelForm.name.trim() || !channelForm.url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await iptvApi.createChannel(
        selectedList,
        channelForm.groupId,
        channelForm.name.trim(),
        channelForm.url.trim(),
        channelForm.audio.trim() || undefined,
      );
      setChannelForm(null);
      await loadGroups(selectedList);
    } catch (err) {
      setError(extractApiError(err, "Không thêm được kênh"));
    } finally {
      setBusy(false);
    }
  }

  // Nguoi dung thuong dan mot URL .m3u8 vao o "kenh" ma khong biet no chua
  // hang tram kenh. Server phan biet giup: playlist nhieu kenh thi tach ra,
  // luong don thi bao de ho them nhu kenh binh thuong.
  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (selectedList === null || !importUrl.trim()) return;
    setBusy(true);
    setError(null);
    setImportNote(null);
    try {
      const { data } = await iptvApi.importPlaylist(selectedList, importUrl.trim());
      if (!data.isPlaylist) {
        setImportNote("URL này là một luồng phát đơn, không phải danh sách nhiều kênh — thêm nó như một kênh bình thường ở nhóm bên dưới.");
        return;
      }
      setImportNote(
        `Đã nhập ${data.imported} kênh vào ${data.newGroups} nhóm mới` +
          (data.skipped > 0 ? `, bỏ qua ${data.skipped} kênh đã có sẵn.` : "."),
      );
      setImportUrl("");
      await loadGroups(selectedList);
    } catch (err) {
      setError(extractApiError(err, "Không nhập được playlist"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h2>Mini App · Danh sách kênh IPTV</h2>
      <p className="meet-note">
        Danh sách kênh là của riêng bạn. Khi đang trong cuộc họp, mở Mini App IPTV để chọn kênh xem.
      </p>

      {error && <p className="meet-error">{error}</p>}

      <form className="meet-inline-form" onSubmit={handleCreateList}>
        <input
          placeholder="Tên danh sách mới"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
        />
        <button disabled={busy || !newListName.trim()}>Tạo danh sách</button>
      </form>

      {lists.length === 0 ? (
        <p className="meet-empty">Chưa có danh sách nào.</p>
      ) : (
        <>
          <select value={selectedList ?? ""} onChange={(e) => setSelectedList(Number(e.target.value))}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          <form className="meet-inline-form" onSubmit={handleImport}>
            <input
              placeholder="Dán link playlist M3U (nhiều kênh)"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
            />
            <button disabled={busy || !importUrl.trim()}>{busy ? "Đang nhập..." : "Nhập playlist"}</button>
          </form>
          {importNote && <p className="meet-note">{importNote}</p>}

          <form className="meet-inline-form" onSubmit={handleCreateGroup}>
            <input
              placeholder="Tên nhóm kênh (vd: Thể thao)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
            <button disabled={busy || !newGroupName.trim()}>Thêm nhóm</button>
          </form>

          {groups.length === 0 ? (
            <p className="meet-empty">Danh sách này chưa có nhóm kênh nào.</p>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="meet-iptv-group">
                <strong>{g.groupName}</strong>
                <ul className="meet-people">
                  {g.channels.map((c) => (
                    <li key={c.id}>
                      <span>
                        {c.channelName}
                        {c.audioTrack && ` · ${c.audioTrack}`}
                      </span>
                      <span className="meet-note meet-truncate">{c.streamUrl}</span>
                    </li>
                  ))}
                  {g.channels.length === 0 && <li className="meet-empty">Chưa có kênh nào.</li>}
                </ul>

                {channelForm?.groupId === g.id ? (
                  <form className="meet-inline-form" onSubmit={handleCreateChannel}>
                    <input
                      placeholder="Tên kênh"
                      value={channelForm.name}
                      onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                    />
                    <input
                      placeholder="URL luồng phát"
                      value={channelForm.url}
                      onChange={(e) => setChannelForm({ ...channelForm, url: e.target.value })}
                    />
                    <input
                      placeholder="Tiếng (tuỳ chọn)"
                      value={channelForm.audio}
                      onChange={(e) => setChannelForm({ ...channelForm, audio: e.target.value })}
                    />
                    <button disabled={busy}>Lưu</button>
                    <button type="button" onClick={() => setChannelForm(null)}>
                      Huỷ
                    </button>
                  </form>
                ) : (
                  <button onClick={() => setChannelForm({ groupId: g.id, name: "", url: "", audio: "" })}>
                    Thêm kênh
                  </button>
                )}
              </div>
            ))
          )}
        </>
      )}
    </AppShell>
  );
}
