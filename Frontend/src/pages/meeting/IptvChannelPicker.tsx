import { useEffect, useRef, useState, type FormEvent } from "react";
import Hls from "hls.js";
import { iptvApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import { MeetingPopup } from "./MeetingPopup";
import { useIptvSlot } from "./IptvPlayerHost";
import { AddPlaylistDialog } from "../miniapp/AddPlaylistDialog";
import { useAuthStore } from "../../store/authStore";
import { decodeJwtIsAdmin } from "../../lib/jwt";
import type { IptvChannelGroup, IptvChannelList } from "../../types/media";
import { doanLoaiLuong, type TuyChonPhat } from "./IptvPlayer";

// Luong IPTV theo dung bon frame di NGANG trong ban thiet ke:
//   140:263  Danh sach Playlist
//   140:321  Danh sach Kenh   (tim kiem + nhom con + "Them kenh")
//   140:396  Tuy chinh kenh   (quet thong tin, do phan giai, luong am thanh,
//                              khoa giai ma, "Bat dau phat")
//   140:465  Cai dat trong luc phat (Dung phat / Chuyen kenh / Phat lai)
//
// Bon frame la BON BUOC cua mot popup, khong phai bon popup.
//
// MOT nut Mini App o thanh ben phai mo ra HAI popup khac nhau:
//   - chua phat gi  -> "Danh sach app" (MeetingAppsDialog), roi vao buoc 1
//   - dang phat IPTV -> nhay THANG vao buoc "dangphat" (frame 149:1321)
// Cho re nam o moPanel("app") trong MeetingRoomPage.

type Buoc = "playlist" | "kenh" | "tuychinh" | "dangphat";

type KetQuaQuet = {
  mucChatLuong: { index: number; nhan: string }[];
  luongAmThanh: { index: number; nhan: string }[];
};

// Doc manifest de biet luong co nhung do phan giai va nhung luong tieng nao.
//
// Moi dinh dang mot duong doc rieng - xem doanLoaiLuong trong IptvPlayer.
function quetLuong(url: string): Promise<KetQuaQuet> {
  const loai = doanLoaiLuong(url);
  if (loai === "dash") return quetDash(url);
  // FLV, MPEG-TS va file am thanh deu la MOT luong duy nhat: khong co nhieu muc
  // chat luong hay nhieu track tieng de liet ke. Tra ve rong chu khong bao loi
  // - khong co gi de chon la dung, khong phai hong.
  if (loai === "flv" || loai === "ts" || loai === "audio")
    return Promise.resolve({ mucChatLuong: [], luongAmThanh: [] });
  return quetHls(url);
}

// DASH: dashjs can mot the <video> de khoi tao, nhung khong can the do nam
// trong trang - dung mot the roi, khong tu phat, doc xong la huy.
function quetDash(url: string): Promise<KetQuaQuet> {
  return new Promise((giai, tuChoi) => {
    let xong = false;
    void (async () => {
      try {
        const { MediaPlayer } = await import("dashjs");
        const the = document.createElement("video");
        the.muted = true;
        const player = MediaPlayer().create();
        const hen = setTimeout(() => {
          if (xong) return;
          xong = true;
          player.destroy();
          tuChoi(new Error("Quá lâu không đọc được thông tin luồng."));
        }, 12000);

        player.on("streamInitialized", () => {
          if (xong) return;
          xong = true;
          clearTimeout(hen);
          const kq: KetQuaQuet = {
            mucChatLuong: player.getRepresentationsByType("video").map((r, i) => ({
              index: i,
              nhan: `${r.height || r.width || "?"}${r.height ? "p" : ""}${
                r.frameRate ? ` - ${Math.round(r.frameRate)}fps` : ""
              }`,
            })),
            luongAmThanh: player.getTracksFor("audio").map((t, i) => ({
              index: i,
              nhan: [t.labels?.[0]?.text, t.lang].filter(Boolean).join(" - ") || `Luồng ${i + 1}`,
            })),
          };
          player.destroy();
          giai(kq);
        });

        player.on("error", () => {
          if (xong) return;
          xong = true;
          clearTimeout(hen);
          player.destroy();
          tuChoi(new Error("Không đọc được luồng - nguồn có thể chặn hoặc đã chết."));
        });

        player.initialize(the, url, false);
      } catch {
        if (xong) return;
        xong = true;
        tuChoi(new Error("Không tải được bộ giải mã DASH."));
      }
    })();
  });
}

// HLS: chay hls.js KHONG gan vao the <video> - chi can toi su kien
// MANIFEST_PARSED, khong can giai ma mot khung hinh nao. Nen "Quet thong tin"
// khong ton bang thong cua doan video.
function quetHls(url: string): Promise<KetQuaQuet> {
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
      tuChoi(new Error("Không đọc được luồng - nguồn có thể chặn hoặc đã chết."));
    });

    hls.loadSource(url);
  });
}

export function IptvChannelPicker({
  meetingId,
  dangPhat,
  dieuKhienDuoc,
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
  // Nguoi dang trinh bay (hoac chu phong) moi duoc dung phat / doi kenh cho
  // ca phong. Nguoi xem van mo duoc popup nay - do phan giai, luong tieng va
  // am luong deu la lua chon CUC BO cua tung may.
  dieuKhienDuoc: boolean;
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

  // Luong DANG phat, de "Quet thong tin" chay duoc ca khi popup mo thang
  // vao buoc "dangphat" (luc do chua di qua buoc chon kenh nen kenhChon rong).
  const slot = useIptvSlot();

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
    setDangQuet(true);
    setLoiQuet(null);
    try {
      // Mo popup THANG vao buoc dang phat thi khong co kenhChon - lay luon
      // link ma trinh phat dang chay.
      let url = kenhChon ? kenhChon.url : (slot?.streamUrl ?? null);
      if (!url && kenhChon && kenhChon.id !== null) {
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
              <path d="m2 2 10 10 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
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
              <path d="m2 2 10 10 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>

      {!quet && !dangQuet && (
        <p className="mpop-ghi-chu">
          Bấm “Quét thông tin” để đọc các độ phân giải và luồng tiếng mà kênh này thật sự có.
        </p>
      )}

      {quet && quet.mucChatLuong.length === 0 && quet.luongAmThanh.length === 0 && (
        <p className="mpop-ghi-chu">
          Luồng này chỉ có một mức chất lượng và một luồng tiếng - không có gì để chọn. Link .flv và
          .ts luôn như vậy.
        </p>
      )}
    </>
  );

  // Thanh am luong: truoc kia nam ngay duoi khung chieu, gio o day vi khung
  // chieu chi con video. Am luong la cua RIENG may nay, khong doi cho ca
  // phong - dung nhu do phan giai va luong tieng ngay tren.
  const thanhAmLuong = (
    <div className="mpop-muc">
      <p className="mpop-nhan-nho">
        <b>Âm lượng</b>
      </p>
      <div className="mpop-truot">
        <span className="mpop-truot-moc">0%</span>
        <span className="mpop-truot-moc mpop-truot-moc-phai">100%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={tuyChon.amLuong}
          onChange={(e) => onDoiTuyChon({ ...tuyChon, amLuong: Number(e.target.value) })}
          aria-label="Âm lượng kênh đang phát"
          style={{ ["--phan" as string]: `${tuyChon.amLuong * 100}%` }}
        />
      </div>
      <p className="mpop-ghi-chu">Chỉ đổi ở máy bạn - người khác trong phòng không bị ảnh hưởng.</p>
    </div>
  );

  return (
    <>
      <MeetingPopup
        title="Bắt đầu khởi tạo ứng dụng"
        onClose={onClose}
        width={826}
        dauCoDinh={
          <>
            {/* Ten app luon o phan KHONG CUON - no la nhan cua ca popup, de
                no cuon di mat thi nguoi dung mat luon manh moc "minh dang o
                trong app nao". */}
            <p className="mpop-nhan">Tên App: IPTV</p>
            {buoc === "kenh" && (
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
            )}
          </>
        }
      >
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
                    <input
                      className="mpop-o-nhap"
                      name="url"
                      placeholder="https://…/stream.m3u8 - hoặc .mpd, .flv, .ts"
                    />
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
            {thanhAmLuong}
            <div className="mpop-hang-nut">
              {dieuKhienDuoc && (
                <>
                  <button type="button" className="mpop-pill mpop-pill-do" onClick={onDungPhat}>
                    Dừng phát
                  </button>
                  <button type="button" className="mpop-pill mpop-pill-xam" onClick={() => setBuoc("playlist")}>
                    Chuyển kênh
                  </button>
                </>
              )}
              <button type="button" className="mpop-pill mpop-pill-teal" onClick={onPhatLai}>
                Phát lại
              </button>
            </div>
            {!dieuKhienDuoc && (
              <p className="mpop-ghi-chu">
                Người đang trình bày mới đổi hoặc dừng được kênh. Những mục ở trên là của riêng máy bạn.
              </p>
            )}
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
