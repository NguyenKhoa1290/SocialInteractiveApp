import { useEffect, useState } from "react";
import { chatApi } from "../../api/chatApi";
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
}) {
  const [media, setMedia] = useState<FileMeta[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const laNhom = members !== undefined;

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
      <Avatar userId={peerUserId ?? 0} nickname={title} avatarUpdatedAt={peerAvatarUpdatedAt} size={170} />
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
