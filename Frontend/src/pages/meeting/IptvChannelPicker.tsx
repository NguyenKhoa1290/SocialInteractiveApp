import { useEffect, useRef, useState, type FormEvent } from "react";
import Hls from "hls.js";
import { iptvApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import { MeetingPopup } from "./MeetingPopup";
import { AddPlaylistDialog } from "../miniapp/AddPlaylistDialog";
import { useAuthStore } from "../../store/authStore";
import { decodeJwtIsAdmin } from "../../lib/jwt";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";
import type { TuyChonPhat } from "./IptvPlayer";

// Luong IPTV theo dung bon frame di NGANG trong ban thiet ke:
//   140:263  Danh sach Playlist
//   140:321  Danh sach Kenh   (tim kiem + nhom con + "Them kenh")
//   140:396  Tuy chinh kenh   (quet thong tin, do phan giai, luong am thanh,
//                              khoa giai ma, "Bat dau phat")
//   140:465  Cai dat trong luc phat (Dung phat / Chuyen kenh / Phat lai)
//
// Bon frame la BON BUOC cua mot popup, khong phai bon popup.

type Buoc = "playlist" | "kenh" | "tuychinh" | "dangphat";

type KetQuaQuet = {
  mucChatLuong: { index: number; nhan: string }[];
  luongAmThanh: { index: number; nhan: string }[];
};

// Doc manifest de biet luong co nhung do phan giai va nhung luong tieng nao.
//
// Chay hls.js KHONG gan vao the <video>: chi can toi su kien MANIFEST_PARSED,
// khong can giai ma mot khung hinh nao. Nen "Quet thong tin" khong ton bang
// thong cua doan video.
function quetLuong(url: string): Promise<KetQuaQuet> {
  return new Promise((giai, tuChoi) => {
    if (!Hls.isSupported()) {
      tuChoi(new Error("Trình duyệt này không đọc trước được luồng HLS."));
      return;
    }
    const hls = new Hls({ enableWorker: true });
    const hen = setTimeout(() => {
      hls.destroy();
      tuChoi(new Error("Quá lâu không đọc được thông tin luồng."));
    }, 12000);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      clearTimeout(hen);
      const kq: KetQuaQuet = {
        mucChatLuong: hls.levels.map((l, i) => ({
          index: i,
          nhan: `${l.height || l.width || "?"}${l.height ? "p" : ""}${
            l.frameRate ? ` - ${Math.round(l.frameRate)}fps` : ""
          }`,
        })),
        luongAmThanh: hls.audioTracks.map((t, i) => ({
          index: i,
          nhan: [t.name, t.lang].filter(Boolean).join(" - ") || `Luồng ${i + 1}`,
        })),
      };
      hls.destroy();
      giai(kq);
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      clearTimeout(hen);
      hls.destroy();
      tuChoi(new Error("Không đọc được luồng — nguồn có thể chặn hoặc đã chết."));
    });

    hls.loadSource(url);
  });
}

export function IptvChannelPicker({
  meetingId,
  dangPhat,
  tuyChon,
  onPick,
  onDungPhat,
  onPhatLai,
  onDoiTuyChon,
  onClose,
}: {
  meetingId: number;
  // Ten kenh dang chieu cho ca phong, null = chua phat gi.
  dangPhat: string | null;
  tuyChon: TuyChonPhat;
  onPick: (channelId: number, channelName: string) => void;
  onDungPhat: () => void;
  onPhatLai: () => void;
  onDoiTuyChon: (t: TuyChonPhat) => void;
  onClose: () => void;
}) {
  // Admin tao duoc "Admin Playlist" (playlist dung chung) ngay trong phong
  // hop, khong phai thoat ra man Mini App. Claim `role` chi co khi
  // User.IsAdmin - xem lib/jwt.ts.
  const accessToken = useAuthStore((x) => x.accessToken);
  const laAdmin = accessToken !== null && decodeJwtIsAdmin(accessToken);

  const [buoc, setBuoc] = useState<Buoc>(dangPhat ? "dangphat" : "playlist");
  const [lists, setLists] = useState<IptvChannelList[]>([]);
  const [listDangMo, setListDangMo] = useState<IptvChannelList | null>(null);
  const [groups, setGroups] = useState<IptvChannelGroup[]>([]);
  const [tim, setTim] = useState("");
  const [dangNap, setDangNap] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);

  const [kenhChon, setKenhChon] = useState<{ id: number | null; ten: string; url: string | null } | null>(null);
  const [quet, setQuet] = useState<KetQuaQuet | null>(null);
  const [dangQuet, setDangQuet] = useState(false);
  const [loiQuet, setLoiQuet] = useState<string | null>(null);

  const [moThemPlaylist, setMoThemPlaylist] = useState(false);
  const [nhomThemKenh, setNhomThemKenh] = useState<number | null>(null);

  const napLists = useRef(() => {
    setDangNap(true);
    iptvApi
      .listChannelLists()
      .then((res) => setLists(res.data))
      .catch((err) => setLoi(extractApiError(err, "Không tải được danh sách playlist")))
      .finally(() => setDangNap(false));
  }).current;

  useEffect(() => {
    napLists();
  }, [napLists]);

  async function moPlaylist(l: IptvChannelList) {
    setListDangMo(l);
    setBuoc("kenh");
    setLoi(null);
    try {
      const res = await iptvApi.listGroups(l.id);
      setGroups(res.data);
    } catch (err) {
      setLoi(extractApiError(err, "Không tải được danh sách kênh"));
    }
  }

  async function chonKenh(id: number, ten: string) {
    setKenhChon({ id, ten, url: null });
    setQuet(null);
    setLoiQuet(null);
    setBuoc("tuychinh");
  }

  async function bamQuet() {
    if (!kenhChon) return;
    setDangQuet(true);
    setLoiQuet(null);
    try {
      let url = kenhChon.url;
      if (!url && kenhChon.id !== null) {
        // Lay URL da ky cua kenh - cung duong ma trinh phat dung.
        const res = await iptvApi.getStreamUrl(meetingId, kenhChon.id);
        url = res.data.streamUrl;
        setKenhChon({ ...kenhChon, url });
      }
      if (!url) throw new Error("Chưa có link để quét.");
      setQuet(await quetLuong(url));
    } catch (err) {
      setLoiQuet(err instanceof Error && !("response" in err) ? err.message : extractApiError(err, "Không quét được"));
    } finally {
      setDangQuet(false);
    }
  }

  async function themKenh(e: FormEvent<HTMLFormElement>, groupId: number) {
    e.preventDefault();
    const form = e.currentTarget;
    const ten = (form.elements.namedItem("ten") as HTMLInputElement).value.trim();
    const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim();
    if (!ten || !url || !listDangMo) return;
    try {
      await iptvApi.createChannel(listDangMo.id, groupId, ten, url);
      const res = await iptvApi.listGroups(listDangMo.id);
      setGroups(res.data);
      setNhomThemKenh(null);
    } catch (err) {
      setLoi(extractApiError(err, "Không thêm được kênh"));
    }
  }

  const loc = tim.trim().toLowerCase();
  const nhomHienThi = loc
    ? groups
        .map((g) => ({ ...g, channels: g.channels.filter((c) => c.channelName.toLowerCase().includes(loc)) }))
        .filter((g) => g.channels.length > 0)
    : groups;

  const cuaToi = lists.filter((l) => !l.isShared);
  const cuaAdmin = lists.filter((l) => l.isShared);

  // Hai buoc cuoi dung CHUNG mot khoi o nhap - chi khac hang nut ben duoi.
  const khoiTuyChinh = (
    <>
      <p className="mpop-nhan-nho">
        <b>Tùy chỉnh kênh: {kenhChon?.ten ?? dangPhat}</b>
      </p>
      <button type="button" className="mpop-o-nut" onClick={() => void bamQuet()} disabled={dangQuet}>
        {dangQuet ? "Đang quét…" : "Quét thông tin"}
      </button>
      {loiQuet && <p className="mpop-loi">{loiQuet}</p>}

      <div className="mpop-doi">
        <div className="mpop-muc">
          <p className="mpop-nhan-nho">Độ phân giải</p>
          <div className="mpop-chon">
            <select
              value={tuyChon.mucChatLuong}
              onChange={(e) => onDoiTuyChon({ ...tuyChon, mucChatLuong: Number(e.target.value) })}
            >
              <option value={-1}>Tự động</option>
              {(quet?.mucChatLuong ?? []).map((m) => (
                <option key={m.index} value={m.index}>
                  {m.nhan}
                </option>
              ))}
            </select>
            <svg width="22" height="14" viewBox="0 0 24 14" fill="none" aria-hidden="true">
              <path d="m2 12 10-10 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="mpop-muc">
          <p className="mpop-nhan-nho">Luồng âm thanh</p>
          <div className="mpop-chon">
            <select
              value={tuyChon.luongAmThanh}
              onChange={(e) => onDoiTuyChon({ ...tuyChon, luongAmThanh: Number(e.target.value) })}
            >
              <option value={-1}>Mặc định</option>
              {(quet?.luongAmThanh ?? []).map((m) => (
                <option key={m.index} value={m.index}>
                  {m.nhan}
                </option>
              ))}
            </select>
            <svg width="22" height="14" viewBox="0 0 24 14" fill="none" aria-hidden="true">
              <path d="m2 12 10-10 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>

      {!quet && !dangQuet && (
        <p className="mpop-ghi-chu">
          Bấm “Quét thông tin” để đọc các độ phân giải và luồng tiếng mà kênh này thật sự có.
        </p>
      )}

      <p className="mpop-nhan-nho">
        <b>Khóa giải mã ClearKey (nếu có)</b>
      </p>
      <input
        className="mpop-o-nhap"
        value={tuyChon.khoaClearKey}
        onChange={(e) => onDoiTuyChon({ ...tuyChon, khoaClearKey: e.target.value })}
        placeholder="Điền mã — dạng kid:key, cả hai là chuỗi hex 32 ký tự"
      />
    </>
  );

  return (
    <>
      <MeetingPopup
        title="Bắt đầu khởi tạo ứng dụng"
        onClose={onClose}
        width={826}
        dauCoDinh={
          buoc === "kenh" ? (
            <>
              <h3 className="mpop-nhan">Danh sách Kênh</h3>
              <label className="mpop-tim">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
                  <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                <input value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm kiếm Kênh" />
              </label>
            </>
          ) : undefined
        }
      >
        <p className="mpop-nhan">Tên App: IPTV</p>
        {loi && <p className="mpop-loi">{loi}</p>}

        {/* ---------------------------------------------------- 140:263 --- */}
        {buoc === "playlist" && (
          <>
            <div className="mpop-dau">
              <h3 className="mpop-nhan">Danh sách Playlist</h3>
              <button type="button" className="mpop-pill mpop-pill-teal" onClick={() => setMoThemPlaylist(true)}>
                Thêm playlist
              </button>
            </div>

            {dangNap && <p className="mpop-ghi-chu">Đang tải…</p>}
            {!dangNap && lists.length === 0 && <p className="mpop-ghi-chu">Chưa có playlist nào.</p>}

            {cuaToi.map((l) => (
              <button key={l.id} type="button" className="mpop-o-nut" onClick={() => void moPlaylist(l)}>
                {l.name}
              </button>
            ))}

            {cuaAdmin.length > 0 && (
              <>
                <p className="mpop-nhan-be">Admin Playlist</p>
                {cuaAdmin.map((l) => (
                  <button key={l.id} type="button" className="mpop-o-nut" onClick={() => void moPlaylist(l)}>
                    {l.name}
                  </button>
                ))}
              </>
            )}

          </>
        )}

        {/* ---------------------------------------------------- 140:321 --- */}
        {buoc === "kenh" && (
          <>
            {/* Tieu de va o tim kiem da len phan KHONG CUON o tren - xem
                dauCoDinh. Khong co nut quay lai: da co nut Dong o dau popup,
                va frame 149:1253 cung khong ve nut nao ca. */}
            {nhomHienThi.length === 0 && <p className="mpop-ghi-chu">Không có kênh nào.</p>}

            {nhomHienThi.map((g) => (
              <div key={g.id} className="mpop-nhom">
                <div className="mpop-dau">
                  <p className="mpop-nhan-be">{g.groupName}</p>
                  {listDangMo?.canEdit && (
                    <button
                      type="button"
                      className="mpop-pill mpop-pill-teal"
                      onClick={() => setNhomThemKenh(nhomThemKenh === g.id ? null : g.id)}
                    >
                      Thêm kênh
                    </button>
                  )}
                </div>

                {nhomThemKenh === g.id && (
                  <form className="mpop-them-kenh" onSubmit={(e) => void themKenh(e, g.id)}>
                    <input className="mpop-o-nhap" name="ten" placeholder="Tên kênh" maxLength={100} />
                    {/* Khong dat maxLength: link luong cua nhieu nha cung cap
                        co token ky rat dai, cot da doi sang TEXT. */}
                    <input className="mpop-o-nhap" name="url" placeholder="https://…/stream.m3u8" />
                    <button type="submit" className="mpop-pill mpop-pill-teal">
                      Lưu
                    </button>
                  </form>
                )}

                {g.channels.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="mpop-o-nut mpop-o-nut-hep"
                    onClick={() => void chonKenh(c.id, c.channelName)}
                  >
                    {c.channelName}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}

        {/* ---------------------------------------------------- 140:396 --- */}
        {buoc === "tuychinh" && (
          <>
            {khoiTuyChinh}
            <div className="mpop-hang-nut">
              <button
                type="button"
                className="mpop-pill mpop-pill-teal"
                onClick={() => {
                  if (kenhChon?.id != null) onPick(kenhChon.id, kenhChon.ten);
                  setBuoc("dangphat");
                }}
              >
                Bắt đầu phát
              </button>
            </div>
          </>
        )}

        {/* ---------------------------------------------------- 140:465 --- */}
        {buoc === "dangphat" && (
          <>
            {khoiTuyChinh}
            <div className="mpop-hang-nut">
              <button type="button" className="mpop-pill mpop-pill-do" onClick={onDungPhat}>
                Dừng phát
              </button>
              <button type="button" className="mpop-pill mpop-pill-xam" onClick={() => setBuoc("playlist")}>
                Chuyển kênh
              </button>
              <button type="button" className="mpop-pill mpop-pill-teal" onClick={onPhatLai}>
                Phát lại
              </button>
            </div>
          </>
        )}
      </MeetingPopup>

      {moThemPlaylist && (
        <AddPlaylistDialog
          laAdmin={laAdmin}
          onClose={() => setMoThemPlaylist(false)}
          onCreated={() => {
            setMoThemPlaylist(false);
            napLists();
          }}
        />
      )}
    </>
  );
}
