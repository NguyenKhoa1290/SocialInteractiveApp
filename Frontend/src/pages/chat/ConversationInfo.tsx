import { useEffect, useRef, useState } from "react";
import { chatApi } from "../../api/chatApi";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { resizeAvatar } from "../../lib/imageResize";
import { Avatar } from "../../components/Avatar";
import type { FileMeta } from "../../types/chat";

export type ThanhVien = { userId: number; nickname: string; avatarUpdatedAt?: string | null };

// Panel phai cua man hinh chinh.
//
// Hai bien the, dung theo Figma:
//   - chat 1-1  (node 111:391, "Thanh menu" 416): anh + ten + luoi media + "Xoa ban"
//   - chat nhom (node 122:1248, "Thanh menu" 462): them "Danh sach nguoi trong
//     nhom" voi nut "Them", moi thanh vien mot the 440x101 co hai nut "Cam
//     chat" / "Xoa", va nut cuoi la "Xoa nhom"
export function ConversationInfo({
  conversationId,
  title,
  peerUserId,
  peerAvatarUpdatedAt,
  dangerLabel,
  onDanger,
  // --- rieng nhom ---
  members,
  mutedUserIds,
  isLeader,
  currentUserId,
  onToggleMute,
  onRemoveMember,
  onAddMember,
  workspaceId,
  groupAvatarUpdatedAt,
  canEditGroup,
  onGroupAvatarChanged,
}: {
  conversationId: number;
  title: string;
  peerUserId?: number | null;
  peerAvatarUpdatedAt?: string | null;
  dangerLabel: string;
  onDanger?: () => void;
  members?: ThanhVien[];
  mutedUserIds?: Set<number>;
  isLeader?: boolean;
  currentUserId?: number;
  onToggleMute?: (userId: number) => void;
  onRemoveMember?: (userId: number) => void;
  onAddMember?: () => void;
  workspaceId?: number | null;
  groupAvatarUpdatedAt?: string | null;
  // Doi anh nhom la quyen cua Truong nhom / Pho nhom - cung quyen voi doi ten
  // nhom. Server van chan bang 403; an nut o day chi de khong moi nguoi bam
  // vao mot thu chac chan se bi tu choi.
  canEditGroup?: boolean;
  onGroupAvatarChanged?: (avatarUpdatedAt: string | null) => void;
}) {
  const [media, setMedia] = useState<FileMeta[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const laNhom = members !== undefined;

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [anhBan, setAnhBan] = useState(false);
  const [anhLoi, setAnhLoi] = useState<string | null>(null);
  const doiDuocAnh = laNhom && canEditGroup === true && typeof workspaceId === "number";

  async function doiAnhNhom(file: File) {
    if (typeof workspaceId !== "number") return;
    setAnhLoi(null);
    setAnhBan(true);
    try {
      // Cat vuong + nen ngay tai trinh duyet, dung ham dung cho anh dai dien
      // nguoi dung: cung mot khung tron, cung nguong 256KB ma server nhan.
      const { blob } = await resizeAvatar(file);
      const { data } = await workspaceApi.uploadAvatar(workspaceId, blob);
      onGroupAvatarChanged?.(data.avatarUpdatedAt);
    } catch (err) {
      // resizeAvatar nem Error thuong (khong co `response`), loi mang thi co.
      setAnhLoi(err instanceof Error && !("response" in err)
        ? err.message
        : extractApiError(err, "Không đổi được ảnh nhóm"));
    } finally {
      setAnhBan(false);
    }
  }

  async function xoaAnhNhom() {
    if (typeof workspaceId !== "number") return;
    setAnhLoi(null);
    setAnhBan(true);
    try {
      await workspaceApi.deleteAvatar(workspaceId);
      onGroupAvatarChanged?.(null);
    } catch (err) {
      setAnhLoi(extractApiError(err, "Không xoá được ảnh nhóm"));
    } finally {
      setAnhBan(false);
    }
  }

  useEffect(() => {
    let huy = false;
    void chatApi
      .listFiles(conversationId)
      .then((r) => {
        if (huy) return;
        // Chi lay anh/video - "file media" trong ban thiet ke la luoi hinh
        // vuong xem truoc, tai lieu khong co gi de xem truoc ca.
        setMedia(r.data.filter((f) => f.fileType === "image" || f.fileType === "video"));
      })
      .catch(() => {
        if (!huy) setMedia([]);
      });
    return () => {
      huy = true;
    };
  }, [conversationId]);

  // Dia chi xem truoc cua tung o. Phai lay rieng vi anh nam trong MinIO va
  // chi truy cap duoc qua URL da ky - khong doan duoc tu id.
  //
  // Lay MOT LAN cho ca luoi roi giu lai: moi lan mo panel ma goi lai chin
  // request thi vua cham vua vo nghia, URL con han hang gio.
  useEffect(() => {
    if (!media || media.length === 0) return;
    let huy = false;
    void Promise.all(
      media.slice(0, 9).map(async (f) => {
        try {
          const { data } = await chatApi.getDownloadUrl(f.id);
          return [f.id, data.uploadUrl] as const;
        } catch {
          return null;
        }
      }),
    ).then((cap) => {
      if (huy) return;
      setUrls(Object.fromEntries(cap.filter((x): x is readonly [number, string] => x !== null)));
    });
    return () => {
      huy = true;
    };
  }, [media]);

  function mo(f: FileMeta) {
    const u = urls[f.id];
    if (u) window.open(u, "_blank", "noopener");
  }

  // Thiet ke ve luoi 3x3 = 9 o. Luon ve du 9 o de khung khong xo lech khi it
  // file; o thua la o giu cho xam nhu trong thiet ke.
  const oTrong = Math.max(0, 9 - Math.min(9, media?.length ?? 0));

  return (
    <div className={`cw-info${laNhom ? " cw-info-group" : ""}`}>
      <div className="cw-info-avatar">
        {laNhom && typeof workspaceId === "number" ? (
          <Avatar workspaceId={workspaceId} nickname={title} avatarUpdatedAt={groupAvatarUpdatedAt} size={170} />
        ) : (
          <Avatar userId={peerUserId ?? 0} nickname={title} avatarUpdatedAt={peerAvatarUpdatedAt} size={170} />
        )}

        {/* Huy hieu "+" dung nhu frame "Danh sach nhom" (node 122:1354): 30x30
            tron, nen #56959E, dau cong #2F3C52, nam o goc duoi phai va thua ra
            khoi vien anh mot chut. <input type="file"> that duoc giau di - no
            khong the tao kieu duoc nen phai boc trong mot nut. */}
        {doiDuocAnh && (
          <>
            <button
              type="button"
              className="cw-info-add"
              onClick={() => fileRef.current?.click()}
              disabled={anhBan}
              aria-label={groupAvatarUpdatedAt ? "Đổi ảnh nhóm" : "Thêm ảnh nhóm"}
              title={groupAvatarUpdatedAt ? "Đổi ảnh nhóm" : "Thêm ảnh nhóm"}
            >
              +
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Xoa gia tri de chon LAI DUNG tep vua roi van kich hoat
                // onChange - neu khong, cat lai cung mot anh se khong thay gi.
                e.target.value = "";
                if (f) void doiAnhNhom(f);
              }}
            />
          </>
        )}
      </div>

      {anhBan && <p className="cw-info-note">Đang xử lý ảnh…</p>}
      {anhLoi && <p className="cw-info-note cw-info-note-err">{anhLoi}</p>}
      {doiDuocAnh && groupAvatarUpdatedAt && !anhBan && (
        <button type="button" className="cw-info-remove-avatar" onClick={() => void xoaAnhNhom()}>
          Xoá ảnh nhóm
        </button>
      )}

      <p className="cw-info-name">{title}</p>

      {laNhom && (
        <>
          <div className="cw-info-head">
            <span className="cw-info-label">Danh sách người trong nhóm</span>
            {isLeader && onAddMember && (
              <button className="cw-pill" onClick={onAddMember}>
                Thêm
              </button>
            )}
          </div>

          <div className="cw-members">
            {members!.length === 0 && <p className="cw-empty">Chưa có thành viên nào</p>}
            {members!.map((m) => {
              // Truong nhom khong tu cam chat / tu xoa chinh minh - hai nut do
              // chi co nghia khi nham vao NGUOI KHAC.
              const nguoiKhac = m.userId !== currentUserId;
              return (
                <div key={m.userId} className="cw-member">
                  <Avatar userId={m.userId} nickname={m.nickname} avatarUpdatedAt={m.avatarUpdatedAt} size={68} />
                  <span className="cw-member-name">{m.nickname}</span>
                  {isLeader && nguoiKhac && (
                    <span className="cw-member-acts">
                      <button className="cw-pill cw-pill-sm" onClick={() => onToggleMute?.(m.userId)}>
                        {mutedUserIds?.has(m.userId) ? "Gỡ cấm" : "Cấm chat"}
                      </button>
                      <button className="cw-pill cw-pill-sm cw-pill-ghost" onClick={() => onRemoveMember?.(m.userId)}>
                        Xóa
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="cw-info-label">Danh sách file media đã gửi</p>
      <div className="cw-media">
        {media?.slice(0, 9).map((f) => (
          <button key={f.id} className="cw-media-cell" onClick={() => mo(f)} title={f.fileName ?? "Tệp"}>
            {/* Video cung hien duoc bang the <video> nhung chi de lay MOT
                khung hinh dau - re hon nhieu so voi tai ca doan phim ve chi
                de dung o mot o 100x100. */}
            {urls[f.id] && f.fileType === "image" && <img src={urls[f.id]} alt={f.fileName ?? ""} loading="lazy" />}
            {urls[f.id] && f.fileType === "video" && (
              <video src={urls[f.id]} muted playsInline preload="metadata" />
            )}
          </button>
        ))}
        {Array.from({ length: oTrong }, (_, i) => (
          <span key={`trong-${i}`} className="cw-media-cell" aria-hidden="true" />
        ))}
      </div>

      {onDanger && (
        <button className="cw-danger" onClick={onDanger}>
          {dangerLabel}
        </button>
      )}
    </div>
  );
}
