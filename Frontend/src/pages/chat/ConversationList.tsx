import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { chatApi } from "../../api/chatApi";
import { friendApi } from "../../api/friendApi";
import { workspaceApi } from "../../api/workspaceApi";
import { meetingApi } from "../../api/mediaApi";
import { extractApiError } from "../../lib/apiError";
import { Avatar } from "../../components/Avatar";
import type { ConversationSummary } from "../../types/chat";
import type { AuthUser } from "../../types/auth";
import type { Friend, FriendRequest } from "../../types/friend";
import { useLastMessages } from "./useLastMessages";
import { useAuthStore } from "../../store/authStore";
import { useChatUnreadStore } from "../../store/chatUnreadStore";

// Avatar kem cham do khi co tin chua doc - "dau tron do canh tren avatar".
function AvatarConDot({ con, children }: { con: boolean; children: React.ReactNode }) {
  return (
    <span className="cw-av">
      {children}
      {con && <span className="cw-av-dot" aria-label="Có tin nhắn mới" />}
    </span>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
      <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// Bao lau truoc - DUONG LUI khi chua co doan xem truoc.
//
// Doan chu that lay tu useLastMessages: server khong doc duoc noi dung (ma hoa
// dau cuoi) nen client tu giai ma. Ham nay dung cho luc chua giai ma xong,
// hoi thoai chua co tin nao, hoac nguoi dung chua mo khoa E2EE.
function batDau(iso: string | null): string {
  if (!iso) return "Chưa có tin nhắn";
  const giay = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (giay < 60) return "Vừa xong";
  if (giay < 3600) return `${Math.floor(giay / 60)} phút trước`;
  if (giay < 86400) return `${Math.floor(giay / 3600)} giờ trước`;
  if (giay < 7 * 86400) return `${Math.floor(giay / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

// `kind` tach hai muc rieng biet dung nhu chu du an chot: chat CA NHAN va chat
// NHOM la hai man khac nhau, khong tron chung mot danh sach.
export function ConversationList({
  kind,
  activeId,
  reloadKey,
}: {
  kind: "p2p" | "group";
  activeId?: number;
  // Doi so nay de bat danh sach nap lai. Khung chat dung no sau khi doi anh
  // nhom: khong co no thi panel phai da doi anh ma cai the ben trai van con
  // anh cu cho toi luc chuyen trang - trong nhu mot loi.
  reloadKey?: number;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  // `userId` chi co o muc ca nhan, `wsId` chi co o muc nhom - anh cua hai loai
  // nam o hai service khac nhau nen phai biet dang ve ai.
  const [names, setNames] = useState<
    Record<string, { ten: string; userId?: number; wsId?: number; anh?: string | null }>
  >({});
  const [error, setError] = useState<string | null>(null);
  // Muc CA NHAN lay DANH SACH BAN BE lam goc, khong phai danh sach hoi thoai.
  //
  // Loi that da gap: ban thiet ke ghi "Danh sach ban be" nhung code lai liet ke
  // hoi thoai. Ket ban xong ma chua ai nhan tin thi CHUA CO hoi thoai nao ca -
  // nguoi ban do khong bao gio hien ra, va cung khong co duong nao de bat dau
  // nhan. Hoi thoai chi duoc tao khi bam vao mot nguoi ban (xem moChat).
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [dangMo, setDangMo] = useState<number | null>(null);
  // Loi moi ket ban NGUOI KHAC gui den. Truoc day chi co mot trang rieng
  // (/app/friends) ma thanh dieu huong moi khong dan toi cho nao ca - gui loi
  // moi thi duoc, nhung khong ai co duong nao de bam dong y.
  const [loiMoi, setLoiMoi] = useState<FriendRequest[]>([]);
  const [dangTraLoi, setDangTraLoi] = useState<number | null>(null);
  const [dangMoHop, setDangMoHop] = useState(false);

  const [q, setQ] = useState("");
  // Khach khong tao duoc nhom (UC-17, da chot): tai khoan Guest bi xoa sau 6
  // thang khong hoat dong, ma Truong nhom roi nhom = giai tan ca nhom.
  const laKhach = useAuthStore((st) => st.user?.userType) === "guest";
  const [ketQua, setKetQua] = useState<AuthUser[] | null>(null);
  const [dangTim, setDangTim] = useState(false);
  const [daGui, setDaGui] = useState<Set<number>>(new Set());

  // Doan xem truoc: tin cuoi cua tung hoi thoai, giai ma ngay tai client vi
  // server khong doc duoc noi dung (ma hoa dau cuoi).
  const preview = useLastMessages(items);

  // Cham chua doc + moc hoat dong realtime (xem chatUnreadStore).
  const unread = useChatUnreadStore((s) => s.unread);
  const activity = useChatUnreadStore((s) => s.activity);
  // Moc de sap xep "moi nhat len dau": lay cai muon hon giua tin realtime
  // trong phien va lastMessageAt tu server.
  const tsHoiThoai = (c: ConversationSummary | undefined) => {
    if (!c) return 0;
    const server = c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0;
    return Math.max(server || 0, activity[c.id] ?? 0);
  };

  useEffect(() => {
    async function load() {
      try {
        const [convRes, friendsRes, wsRes, moiRes] = await Promise.all([
          chatApi.listConversations(),
          friendApi.list(),
          workspaceApi.listMine(),
          // Muc nhom khong dinh gi toi ket ban - dung goi cho ton mot request.
          kind === "p2p" ? friendApi.incoming() : Promise.resolve({ data: [] as FriendRequest[] }),
        ]);
        // Chat Service khong resolve ten (xem ConversationSummaryResponse) -
        // Frontend tu doi chieu voi hai danh sach da co san.
        const map: Record<string, { ten: string; userId?: number; wsId?: number; anh?: string | null }> = {};
        for (const f of friendsRes.data) {
          map[`u${f.userId}`] = { ten: f.nickname, userId: f.userId, anh: f.avatarUpdatedAt ?? null };
        }
        for (const w of wsRes.data) map[`w${w.id}`] = { ten: w.name, wsId: w.id, anh: w.avatarUpdatedAt };
        setNames(map);
        setFriends(friendsRes.data);
        setLoiMoi(moiRes.data);
        // Ghi loai tung hoi thoai de thanh dieu huong dat cham do dung bieu
        // tuong (Chat vs Nhom).
        useChatUnreadStore.getState().setTypes(convRes.data.map((c) => ({ id: c.id, type: c.type })));
        setItems(convRes.data.filter((c) => c.type === kind));
      } catch (err) {
        setError(extractApiError(err, "Không tải được danh sách"));
      }
    }
    void load();
  }, [kind, reloadKey]);

  // Tim nguoi dung de ket ban. Cho go xong 350ms moi goi - go tung chu ma ban
  // nao cung goi thi vua ton request vua cho ra ket qua nhay lung tung.
  useEffect(() => {
    const ten = q.trim();
    if (ten.length < 2) {
      setKetQua(null);
      return;
    }
    setDangTim(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await friendApi.searchUsers(ten);
        setKetQua(data);
      } catch {
        setKetQua([]);
      } finally {
        setDangTim(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  async function ketBan(u: AuthUser) {
    try {
      await friendApi.sendRequest(u.id);
      setDaGui((s) => new Set(s).add(u.id));
    } catch (err) {
      setError(extractApiError(err, "Không gửi được lời mời"));
    }
  }

  // Hoi thoai 1-1 voi mot nguoi ban, neu da tung co. Chua co la binh thuong:
  // no chi duoc sinh ra o lan dau bam vao nguoi do.
  const hoiThoaiCua = useMemo(() => {
    const m = new Map<number, ConversationSummary>();
    for (const c of items ?? []) if (c.otherUserId != null) m.set(c.otherUserId, c);
    return m;
  }, [items]);

  // O tim kiem o muc ca nhan phuc vu HAI viec: tim nguoi la de ket ban (goi
  // API), va loc chinh danh sach ban be dang co (loc tai cho).
  const banHienThi = useMemo(() => {
    const ten = q.trim().toLowerCase();
    return (friends ?? []).filter((f) => ten === "" || f.nickname.toLowerCase().includes(ten));
  }, [friends, q]);

  // MOT cu bam ra ca cuoc hop: tao phong tam, sinh link moi, chep link vao
  // clipboard, roi vao thang phong.
  //
  // Vi sao khong hoi han gi truoc: tai lieu goc bat phai co nhom moi hop
  // duoc, nhung yeu cau cua chu du an la chu tri duoc mot cuoc hop trong ba
  // cu bam. Mot popup dat ten phong la mot cu bam khong mua lai duoc gi -
  // phong nay song vai chuc phut roi bien mat cung du lieu cua no.
  async function moPhongHopTuyChinh() {
    setDangMoHop(true);
    setError(null);
    try {
      const { data: hop } = await meetingApi.create("standalone");
      const { data: moi } = await meetingApi.createInvite(hop.id, "link");
      const link = `${window.location.origin}/meetings/join/${moi.inviteToken}`;

      // Chep TRUOC khi roi trang: o mot so trinh duyet, quyen ghi clipboard
      // gan voi chinh cu bam vua roi.
      let daChep = false;
      try {
        await navigator.clipboard.writeText(link);
        daChep = true;
      } catch {
        // Trinh duyet tu choi (khong phai ngu canh an toan, hoac nguoi dung
        // chan quyen). Van vao phong - link hien san trong do de chep tay.
      }

      const { data: vao } = await meetingApi.joinInChat(hop.id);
      // Bao "da chep" o TRONG PHONG chu khong o day: bam xong la roi trang
      // nay ngay, mot thong bao hien o day thi khong ai kip doc.
      navigate(`/meetings/${hop.id}`, {
        state: {
          livekitToken: vao.livekitToken,
          livekitUrl: vao.livekitUrl,
          // Truyen luon link sang: phong vua tao da co link roi, bat host bam
          // "Tao link moi" mot lan nua chi de nhin thay no la thua.
          inviteLink: link,
          linkDaChep: daChep,
        },
      });
    } catch (err) {
      setError(extractApiError(err, "Không mở được cuộc họp"));
    } finally {
      setDangMoHop(false);
    }
  }

  async function traLoiMoi(req: FriendRequest, dongY: boolean) {
    setDangTraLoi(req.id);
    setError(null);
    try {
      if (dongY) {
        await friendApi.accept(req.id);
        // Nap lai ca hai: nguoi vua dong y phai xuat hien ngay o danh sach ban
        // be ben duoi, khong bat nguoi dung tai lai trang moi thay.
        const [fr, moi] = await Promise.all([friendApi.list(), friendApi.incoming()]);
        setFriends(fr.data);
        setLoiMoi(moi.data);
      } else {
        await friendApi.cancelOrReject(req.id);
        setLoiMoi((truoc) => truoc.filter((x) => x.id !== req.id));
      }
    } catch (err) {
      setError(extractApiError(err, dongY ? "Không chấp nhận được lời mời" : "Không từ chối được lời mời"));
    } finally {
      setDangTraLoi(null);
    }
  }

  async function moChat(userId: number) {
    const co = hoiThoaiCua.get(userId);
    if (co) {
      navigate(`/app/chat/${co.id}`, { state: { kind: "p2p" } });
      return;
    }
    setDangMo(userId);
    setError(null);
    try {
      // Endpoint nay LAY-HOAC-TAO: bam hai lan khong sinh ra hai hoi thoai.
      const { data } = await chatApi.createOrGetP2P(userId);
      navigate(`/app/chat/${data.id}`, { state: { kind: "p2p" } });
    } catch (err) {
      setError(extractApiError(err, "Không mở được cuộc trò chuyện"));
    } finally {
      setDangMo(null);
    }
  }

  // Anh cua mot hang trong danh sach. Nhom lay anh nhom (WorkSpace Service),
  // ca nhan lay anh nguoi (Identity Service) - xem lib/avatarUrl.ts.
  function anhCua(c: ConversationSummary, info: { userId?: number; wsId?: number; anh?: string | null } | undefined) {
    const chung = { nickname: tenCua(c), avatarUpdatedAt: info?.anh, size: 68 } as const;
    return c.type === "group" && info?.wsId !== undefined ? (
      <Avatar workspaceId={info.wsId} {...chung} />
    ) : (
      <Avatar userId={info?.userId ?? 0} {...chung} />
    );
  }

  function tenCua(c: ConversationSummary) {
    const k = c.type === "p2p" ? `u${c.otherUserId}` : `w${c.workspaceId}`;
    return names[k]?.ten ?? (c.type === "p2p" ? `Người dùng ${c.otherUserId}` : `Nhóm ${c.workspaceId}`);
  }

  return (
    <>
      <div className="cw-left-top">
        <div className="cw-search">
          <IconSearch />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={kind === "group" ? "Tìm kiếm nhóm" : "Tìm kiếm người dùng"}
            aria-label={kind === "group" ? "Tìm kiếm nhóm" : "Tìm kiếm người dùng"}
          />
        </div>

        {/* Ket qua tim kiem thay cho danh sach khi dang go - dung nhu the
            "Ten nguoi dung / Ket ban +" trong ban thiet ke. Chi o muc CA NHAN:
            man nhom tim theo TEN NHOM trong danh sach da co, khong tim nguoi. */}
        {kind === "p2p" && ketQua?.map((u) => {
          // Da la ban roi ma van moi "Ket ban +" thi bam vao chi nhan loi -
          // cho thang duong nhan tin, do la thu nguoi ta dinh lam.
          const daLaBan = (friends ?? []).some((f) => f.userId === u.id);
          return (
            <div key={u.id} className="cw-card">
              <Avatar userId={u.id} nickname={u.nickname} avatarUpdatedAt={u.avatarUpdatedAt} size={68} />
              <div className="cw-card-body">
                <p className="cw-card-name">{u.nickname}</p>
              </div>
              {daLaBan ? (
                <button className="cw-pill" onClick={() => void moChat(u.id)} disabled={dangMo === u.id}>
                  {dangMo === u.id ? "Đang mở…" : "Nhắn tin"}
                </button>
              ) : (
                <button className="cw-pill" onClick={() => void ketBan(u)} disabled={daGui.has(u.id)}>
                  {daGui.has(u.id) ? "Đã gửi" : "Kết bạn +"}
                </button>
              )}
            </div>
          );
        })}
        {kind === "p2p" && dangTim && ketQua === null && <p className="cw-empty">Đang tìm…</p>}
        {kind === "p2p" && ketQua?.length === 0 && <p className="cw-empty">Không tìm thấy ai</p>}

        <div className="cw-section">
          <p className="cw-section-label">{kind === "group" ? "Danh sách nhóm" : "Danh sách bạn bè"}</p>
          {kind === "group" ? (
            // Khach khong tao duoc nhom (UC-17) - an nut thay vi de ho bam roi
            // an 403 o trang sau.
            laKhach ? (
              <span className="cw-empty">Tài khoản khách không tạo được nhóm</span>
            ) : (
              <Link className="cw-pill" to="/workspaces/new">
                Tạo nhóm mới
              </Link>
            )
          ) : (
            /* KHONG phai cuoc hop cua mot cuoc tro chuyen nao - day la phong
               hop TUY CHINH, moi nguoi vao bang link. */
            <button className="cw-pill" onClick={() => void moPhongHopTuyChinh()} disabled={dangMoHop}>
              {dangMoHop ? "Đang mở…" : "Khởi tạo cuộc họp"}
            </button>
          )}
        </div>
      </div>

      <div className="cw-scroll">
        {error && <p className="cw-empty">{error}</p>}

        {kind === "p2p" ? (
          <>
            {/* Loi moi den nam TREN CUNG: day la thu can tra loi, khac voi
                danh sach ban be la thu de xem dan. */}
            {loiMoi.length > 0 && (
              <p className="cw-section-label cw-invite-label">
                Lời mời kết bạn ({loiMoi.length})
              </p>
            )}
            {loiMoi.map((r) => (
              <div key={r.id} className="cw-card">
                <Avatar userId={r.userId} nickname={r.nickname} avatarUpdatedAt={r.avatarUpdatedAt} size={68} />
                <div className="cw-card-body">
                  <p className="cw-card-name">{r.nickname}</p>
                  <p className="cw-card-sub">Muốn kết bạn với bạn</p>
                </div>
                <span className="cw-invite-acts">
                  <button
                    className="cw-pill cw-pill-sm"
                    onClick={() => void traLoiMoi(r, true)}
                    disabled={dangTraLoi === r.id}
                  >
                    {dangTraLoi === r.id ? "…" : "Đồng ý"}
                  </button>
                  <button
                    className="cw-pill cw-pill-sm cw-pill-ghost"
                    onClick={() => void traLoiMoi(r, false)}
                    disabled={dangTraLoi === r.id}
                  >
                    Từ chối
                  </button>
                </span>
              </div>
            ))}

            {friends === null && !error && <p className="cw-empty">Đang tải…</p>}
            {friends?.length === 0 && loiMoi.length === 0 && (
              <p className="cw-empty">
                Chưa có người bạn nào. Gõ tên người dùng vào ô tìm kiếm ở trên rồi gửi lời mời kết bạn.
              </p>
            )}
            {friends !== null && friends.length > 0 && banHienThi.length === 0 && (
              <p className="cw-empty">Không có người bạn nào khớp “{q.trim()}”</p>
            )}

            {[...banHienThi]
              // Nguoi vua nhan tin (hoat dong moi nhat) len dau; ban chua tro
              // chuyen bao gio o cuoi.
              .sort((a, b) => tsHoiThoai(hoiThoaiCua.get(b.userId)) - tsHoiThoai(hoiThoaiCua.get(a.userId)))
              .map((f) => {
              const c = hoiThoaiCua.get(f.userId);
              return (
                <button
                  key={f.userId}
                  className={`cw-card${c && c.id === activeId ? " active" : ""}`}
                  onClick={() => void moChat(f.userId)}
                  disabled={dangMo === f.userId}
                >
                  <AvatarConDot con={!!(c && unread[c.id])}>
                    <Avatar userId={f.userId} nickname={f.nickname} avatarUpdatedAt={f.avatarUpdatedAt} size={68} />
                  </AvatarConDot>
                  <div className="cw-card-body">
                    <p className="cw-card-name">{f.nickname}</p>
                    <p className="cw-card-sub">
                      {dangMo === f.userId
                        ? "Đang mở…"
                        : c
                          ? (preview[c.id] ?? batDau(c.lastMessageAt))
                          : "Chưa có tin nhắn"}
                    </p>
                  </div>
                </button>
              );
            })}
          </>
        ) : (
          <>
            {items === null && !error && <p className="cw-empty">Đang tải…</p>}
            {items?.length === 0 && <p className="cw-empty">Chưa có nhóm nào</p>}

            {items
              ?.filter((c) => q.trim() === "" || tenCua(c).toLowerCase().includes(q.trim().toLowerCase()))
              // Nhom co tin moi nhat len dau (realtime trong phien + server).
              .slice()
              .sort((a, b) => tsHoiThoai(b) - tsHoiThoai(a))
              .map((c) => {
                const info = names[`w${c.workspaceId}`];
                return (
                  <button
                    key={c.id}
                    className={`cw-card${c.id === activeId ? " active" : ""}`}
                    // Bao truoc day la NHOM: /app/chat/:id dung chung cho ca
                    // hai muc, thieu cai nay thi thanh dieu huong sang muc
                    // "Chat" mot nhip roi moi nhay ve "Nhom" luc tai xong.
                    onClick={() => navigate(`/app/chat/${c.id}`, { state: { kind: "group" } })}
                  >
                    <AvatarConDot con={!!unread[c.id]}>{anhCua(c, info)}</AvatarConDot>
                    <div className="cw-card-body">
                      <p className="cw-card-name">{tenCua(c)}</p>
                      <p className="cw-card-sub">{preview[c.id] ?? batDau(c.lastMessageAt)}</p>
                    </div>
                  </button>
                );
              })}
          </>
        )}
      </div>
    </>
  );
}
