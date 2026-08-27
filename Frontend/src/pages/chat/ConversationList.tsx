import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { chatApi } from "../../api/chatApi";
import { friendApi } from "../../api/friendApi";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { Avatar } from "../../components/Avatar";
import type { ConversationSummary } from "../../types/chat";
import type { AuthUser } from "../../types/auth";
import { useLastMessages } from "./useLastMessages";

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
  onStartMeeting,
  meetingBusy,
}: {
  kind: "p2p" | "group";
  activeId?: number;
  // Nut "Khoi tao cuoc hop" nam o panel trai nhung cuoc hop lai thuoc ve mot
  // hoi thoai cu the, nen viec mo hop do panel giua lo - o day chi bam nut.
  onStartMeeting?: () => void;
  meetingBusy?: boolean;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [names, setNames] = useState<Record<string, { ten: string; userId?: number; anh?: string | null }>>({});
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [ketQua, setKetQua] = useState<AuthUser[] | null>(null);
  const [dangTim, setDangTim] = useState(false);
  const [daGui, setDaGui] = useState<Set<number>>(new Set());

  // Doan xem truoc: tin cuoi cua tung hoi thoai, giai ma ngay tai client vi
  // server khong doc duoc noi dung (ma hoa dau cuoi).
  const preview = useLastMessages(items);

  useEffect(() => {
    async function load() {
      try {
        const [convRes, friendsRes, wsRes] = await Promise.all([
          chatApi.listConversations(),
          friendApi.list(),
          workspaceApi.listMine(),
        ]);
        // Chat Service khong resolve ten (xem ConversationSummaryResponse) -
        // Frontend tu doi chieu voi hai danh sach da co san.
        const map: Record<string, { ten: string; userId?: number; anh?: string | null }> = {};
        for (const f of friendsRes.data) {
          map[`u${f.userId}`] = { ten: f.nickname, userId: f.userId, anh: f.avatarUpdatedAt ?? null };
        }
        for (const w of wsRes.data) map[`w${w.id}`] = { ten: w.name };
        setNames(map);
        setItems(convRes.data.filter((c) => c.type === kind));
      } catch (err) {
        setError(extractApiError(err, "Không tải được danh sách"));
      }
    }
    void load();
  }, [kind]);

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
        {kind === "p2p" && ketQua?.map((u) => (
          <div key={u.id} className="cw-card">
            <Avatar userId={u.id} nickname={u.nickname} avatarUpdatedAt={u.avatarUpdatedAt} size={68} />
            <div className="cw-card-body">
              <p className="cw-card-name">{u.nickname}</p>
            </div>
            <button
              className="cw-pill"
              onClick={() => void ketBan(u)}
              disabled={daGui.has(u.id)}
            >
              {daGui.has(u.id) ? "Đã gửi" : "Kết bạn +"}
            </button>
          </div>
        ))}
        {kind === "p2p" && dangTim && ketQua === null && <p className="cw-empty">Đang tìm…</p>}
        {kind === "p2p" && ketQua?.length === 0 && <p className="cw-empty">Không tìm thấy ai</p>}

        <div className="cw-section">
          <p className="cw-section-label">{kind === "group" ? "Danh sách nhóm" : "Danh sách bạn bè"}</p>
          {kind === "group" ? (
            <Link className="cw-pill" to="/workspaces/new">
              Tạo nhóm mới
            </Link>
          ) : (
            <button className="cw-pill" onClick={onStartMeeting} disabled={!onStartMeeting || meetingBusy}>
              {meetingBusy ? "Đang mở…" : "Khởi tạo cuộc họp"}
            </button>
          )}
        </div>
      </div>

      <div className="cw-scroll">
        {error && <p className="cw-empty">{error}</p>}
        {items === null && !error && <p className="cw-empty">Đang tải…</p>}
        {items?.length === 0 && <p className="cw-empty">Chưa có cuộc trò chuyện nào</p>}

        {items
          ?.filter((c) => kind !== "group" || q.trim() === "" || tenCua(c).toLowerCase().includes(q.trim().toLowerCase()))
          .map((c) => {
          const k = c.type === "p2p" ? `u${c.otherUserId}` : `w${c.workspaceId}`;
          const info = names[k];
          return (
            <button
              key={c.id}
              className={`cw-card${c.id === activeId ? " active" : ""}`}
              onClick={() => navigate(`/app/chat/${c.id}`)}
            >
              <Avatar
                userId={info?.userId ?? 0}
                nickname={tenCua(c)}
                avatarUpdatedAt={info?.anh}
                size={68}
              />
              <div className="cw-card-body">
                <p className="cw-card-name">{tenCua(c)}</p>
                <p className="cw-card-sub">{preview[c.id] ?? batDau(c.lastMessageAt)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
