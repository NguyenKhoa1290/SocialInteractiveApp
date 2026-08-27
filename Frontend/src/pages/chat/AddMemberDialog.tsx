import { useEffect, useMemo, useState } from "react";
import { friendApi } from "../../api/friendApi";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { Modal } from "../../components/Modal";
import { Avatar } from "../../components/Avatar";
import type { Friend } from "../../types/friend";
import type { ThanhVien } from "./ConversationInfo";

// Popup "Them thanh vien" - chon tu DANH SACH BAN BE.
//
// Ban thiet ke chi ve cai NUT "Them" ma khong ve hop thoai, nen phan nay tu
// suy theo he thong thiet ke dang co: khuon Modal (Figma node 111:307), hang
// nguoi dung mang khuon the thanh vien o panel phai (anh 68, ten 24px w400,
// nut bau duc #56959E), o tim kiem giong o tim o panel trai.
//
// Vi sao chon tu ban be chu khong tim toan he thong: them mot nguoi la vao
// nhom co nghia ho doc duoc toan bo lich su nhom. Gioi han o ban be lam viec
// do la mot quyet dinh co y thuc thay vi go nham mot cai ten.
export function AddMemberDialog({
  workspaceId,
  members,
  onClose,
  onAdded,
}: {
  workspaceId: number;
  members: ThanhVien[];
  onClose: () => void;
  onAdded: (m: ThanhVien) => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [q, setQ] = useState("");
  const [dangThem, setDangThem] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let huy = false;
    void friendApi
      .list()
      .then((r) => {
        if (!huy) setFriends(r.data);
      })
      .catch((err) => {
        if (!huy) {
          setFriends([]);
          setError(extractApiError(err, "Không tải được danh sách bạn bè"));
        }
      });
    return () => {
      huy = true;
    };
  }, []);

  const daO = useMemo(() => new Set(members.map((m) => m.userId)), [members]);

  const hienThi = useMemo(() => {
    const ten = q.trim().toLowerCase();
    return (friends ?? []).filter((f) => ten === "" || f.nickname.toLowerCase().includes(ten));
  }, [friends, q]);

  async function them(f: Friend) {
    setError(null);
    setDangThem(f.userId);
    try {
      await workspaceApi.addMember(workspaceId, f.userId);
      onAdded({ userId: f.userId, nickname: f.nickname, avatarUpdatedAt: f.avatarUpdatedAt });
    } catch (err) {
      setError(extractApiError(err, `Không thêm được ${f.nickname}`));
    } finally {
      setDangThem(null);
    }
  }

  return (
    <Modal title="Thêm thành viên" onClose={onClose}>
      <div className="am-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
          <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm trong danh sách bạn bè"
          aria-label="Tìm bạn bè"
          autoFocus
        />
      </div>

      {error && <p className="md-note" style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="am-list">
        {friends === null && <p className="md-note">Đang tải…</p>}
        {friends !== null && friends.length === 0 && (
          <p className="md-note">
            Bạn chưa có người bạn nào. Sang mục Chat, tìm tên người dùng và gửi lời mời kết bạn trước.
          </p>
        )}
        {friends !== null && friends.length > 0 && hienThi.length === 0 && (
          <p className="md-note">Không có ai khớp “{q.trim()}”</p>
        )}

        {hienThi.map((f) => {
          const oTrongNhom = daO.has(f.userId);
          return (
            <div key={f.userId} className="am-row">
              <Avatar userId={f.userId} nickname={f.nickname} avatarUpdatedAt={f.avatarUpdatedAt} size={56} />
              <span className="am-name">{f.nickname}</span>
              {oTrongNhom ? (
                // Van HIEN nguoi da o trong nhom, chi khoa nut lai - an di thi
                // nguoi dung khong hieu vi sao tim mai khong thay ban minh.
                <span className="am-in">Đã ở trong nhóm</span>
              ) : (
                <button className="cw-pill" onClick={() => void them(f)} disabled={dangThem !== null}>
                  {dangThem === f.userId ? "Đang thêm…" : "Thêm"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
