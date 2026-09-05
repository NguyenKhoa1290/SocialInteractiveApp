import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { chatApi } from "../../api/chatApi";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { resizeAvatar } from "../../lib/imageResize";
import { Avatar } from "../../components/Avatar";
import { ImageViewer } from "../../components/ImageViewer";
import { IconCaret } from "./ComposerIcons";
import type { FileMeta } from "../../types/chat";

export type ThanhVien = { userId: number; nickname: string; avatarUpdatedAt?: string | null };

// Mui ten gap/mo mot muc trong panel. Hinh luon ve huong xuong, trang thai
// "dang gap" xoay no bang CSS - xem .cw-caret trong workspace.css.
function NutGap({ mo, doi, ten }: { mo: boolean; doi: () => void; ten: string }) {
  const nhan = `${mo ? "Ẩn" : "Hiện"} ${ten}`;
  return (
    <button
      type="button"
      className={`cw-caret${mo ? "" : " cw-caret-gap"}`}
      onClick={doi}
      aria-expanded={mo}
      title={nhan}
      aria-label={nhan}
    >
      <IconCaret />
    </button>
  );
}

// Nut "Tuy chinh" o dau danh sach thanh vien: mot nut, tha xuong hai viec.
//
// Truoc day cho la mot nut "Them" tro tro. Van de la viec quan tri nang hon -
// phong/truat Pho nhom - lai nam o mot TRANG KHAC (/workspaces/:id) ma tu man
// chat khong co duong nao sang, nen nguoi dung dung ngay o cho hop ly nhat de
// phong pho lai la cho duy nhat khong lam duoc. Gom hai viec vao mot cho.
//
// Hai man danh sach nhom tach nhau (/app/groups doc tin, /workspaces quan tri)
// la CHU DICH da chot, khong phai trung lap cho gop - day chinh la cai noi hai
// ben lai. Ly do day du: Tainguyen/frontend-admin-page-dac-ta.md muc 5, "Hai
// danh sach nhom".
function MenuTuyChinh({
  themDuoc,
  onThem,
  workspaceId,
}: {
  themDuoc: boolean;
  onThem?: () => void;
  workspaceId?: number | null;
}) {
  const [mo, setMo] = useState(false);
  const boc = useRef<HTMLSpanElement | null>(null);

  // Bam ra ngoai / bam Esc thi dong. Gan o giai doan BAT (capture) de menu
  // dong truoc khi cu bam roi vao thu khac phia sau no.
  useEffect(() => {
    if (!mo) return;
    const ngoai = (e: MouseEvent) => {
      if (!boc.current?.contains(e.target as Node)) setMo(false);
    };
    const phim = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMo(false);
    };
    document.addEventListener("mousedown", ngoai, true);
    document.addEventListener("keydown", phim);
    return () => {
      document.removeEventListener("mousedown", ngoai, true);
      document.removeEventListener("keydown", phim);
    };
  }, [mo]);

  return (
    <span className="cw-menu-boc" ref={boc}>
      <button
        type="button"
        className="cw-pill"
        onClick={() => setMo((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={mo}
      >
        Tùy chỉnh
      </button>
      {mo && (
        <div className="cw-menu" role="menu">
          {themDuoc && onThem && (
            <button
              type="button"
              role="menuitem"
              className="cw-menu-muc"
              onClick={() => {
                setMo(false);
                onThem();
              }}
            >
              Thêm thành viên
            </button>
          )}
          {workspaceId != null && (
            <Link role="menuitem" className="cw-menu-muc" to={`/workspaces/${workspaceId}`} onClick={() => setMo(false)}>
              Quản lý thành viên
            </Link>
          )}
        </div>
      )}
    </span>
  );
}

// Panel phai cua man hinh chinh.
//
// Hai bien the, dung theo Figma:
//   - chat 1-1  (node 111:391, "Thanh menu" 416): anh + ten + luoi media + "Xoa ban"
//   - chat nhom (node 122:1248, "Thanh menu" 462): them "Danh sach nguoi trong
//     nhom" voi nut "Them", moi thanh vien mot the 440x101 co hai nut "Cam
//     chat" / "Xoa", va nut cuoi la "Xoa nhom"
//
// Moi muc trong panel co MOT MUI TEN de gap lai (Figma "Keyboard arrow down"
// 32x32, co trong ca frame 100:22 lan 122:1248). Gap la viec cua rieng may
// nay - no chi doi cai gi dang chiem cho tren man hinh, khong luu len server.
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
  // Mac dinh MO ca hai muc - dung nhu frame 100:22. Gap lai chi co hieu luc
  // trong lan mo nay: sang hoi thoai khac la mot panel khac.
  const [hienThanhVien, setHienThanhVien] = useState(true);
  const [hienMedia, setHienMedia] = useState(true);
  const [media, setMedia] = useState<FileMeta[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [xem, setXem] = useState<FileMeta | null>(null);
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
        //
        // Endpoint /files khong sap xep nen thu tu tra ve tuy y DB - phai tu sap
        // MOI NHAT LEN DAU (uploadedAt giam dan, hoa nhau thi id lon truoc).
        const anhVideo = r.data.filter((f) => f.fileType === "image" || f.fileType === "video");
        anhVideo.sort((a, b) =>
          a.uploadedAt === b.uploadedAt ? b.id - a.id : (a.uploadedAt < b.uploadedAt ? 1 : -1),
        );
        setMedia(anhVideo);
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
    // Ky URL cho TAT CA file chu khong chi 9 o dau: luoi khong con gioi han 9 o
    // nen o thu 10 tro di cung can anh. Nhung dung ban het mot luc - mot cuoc
    // tro chuyen nhieu anh se tao hang tram request ky URL song song. Chay theo
    // tung dot 6 cai, va do dan URL vao luoi sau moi dot de anh hien dan.
    const ds = media;
    const DOT = 6;
    void (async () => {
      for (let i = 0; i < ds.length && !huy; i += DOT) {
        const cap = await Promise.all(
          ds.slice(i, i + DOT).map(async (f) => {
            try {
              const { data } = await chatApi.getDownloadUrl(f.id);
              return [f.id, data.uploadUrl] as const;
            } catch {
              return null;
            }
          }),
        );
        if (huy) return;
        const them = Object.fromEntries(cap.filter((x): x is readonly [number, string] => x !== null));
        setUrls((truoc) => ({ ...truoc, ...them }));
      }
    })();
    return () => {
      huy = true;
    };
  }, [media]);

  function mo(f: FileMeta) {
    // Chi mo popup khi da co URL da ky; chua ky xong thi bam khong lam gi thay
    // vi mo mot popup trong.
    if (urls[f.id]) setXem(f);
  }

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
            {/* Thu tu lay dung tu thiet ke: mui ten truoc, nut hanh dong sau. */}
            <span className="cw-info-head-acts">
              <NutGap mo={hienThanhVien} doi={() => setHienThanhVien((v) => !v)} ten="danh sách người trong nhóm" />
              {(canEditGroup || workspaceId != null) && (
                <MenuTuyChinh
                  // Them thanh vien la quyen cua CA Pho nhom (UC-20), khong
                  // rieng Truong nhom - server cung cho (WorkspaceEndpoints
                  // chi chan role='member'). Truoc day cho hien theo isLeader
                  // nen Pho nhom khong them duoc ai du duoc phep.
                  themDuoc={!!canEditGroup}
                  onThem={onAddMember}
                  workspaceId={workspaceId}
                />
              )}
            </span>
          </div>

          {/* Bo han khoi cay DOM chu khong dat `hidden`: .cw-members co
              `display` rieng trong CSS, ma quy tac cua tac gia de bep
              `display: none` cua trinh duyet - dat `hidden` se khong an gi. */}
          {hienThanhVien && (
            <div className="cw-members">
              {members!.length === 0 && <p className="cw-empty">Chưa có thành viên nào</p>}
              {members!.map((m) => {
                // Truong nhom khong tu cam chat / tu xoa chinh minh - hai nut
                // do chi co nghia khi nham vao NGUOI KHAC.
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
          )}
        </>
      )}

      {/* Muc nay co o CA HAI bien the, nen mui ten gap cung vay - chat ca
          nhan khong phai ngoai le. */}
      <div className="cw-info-head">
        <span className="cw-info-label">Danh sách file media đã gửi</span>
        <NutGap mo={hienMedia} doi={() => setHienMedia((v) => !v)} ten="danh sách file media đã gửi" />
      </div>

      {hienMedia &&
        media !== null &&
        (media.length > 0 ? (
          // Ve dung so file that co, cang gui nhieu thi luoi cang dai them hang.
          // KHONG con ve o trong giu cho: o xam chi la mau trong thiet ke, khi
          // it hoac chua co file thi de trong chu dung bay o rong.
          <div className="cw-media">
            {media.map((f) => (
              <button key={f.id} className="cw-media-cell" onClick={() => mo(f)} title={f.fileName ?? "Tệp"}>
                {/* Video cung hien duoc bang the <video> nhung chi de lay MOT
                    khung hinh dau - re hon nhieu so voi tai ca doan phim ve chi
                    de dung o mot o 100x100. */}
                {urls[f.id] && f.fileType === "image" && (
                  <img src={urls[f.id]} alt={f.fileName ?? ""} loading="lazy" />
                )}
                {urls[f.id] && f.fileType === "video" && (
                  <video src={urls[f.id]} muted playsInline preload="metadata" />
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="cw-empty">Chưa có ảnh hay video nào.</p>
        ))}

      {onDanger && (
        <button className="cw-danger" onClick={onDanger}>
          {dangerLabel}
        </button>
      )}

      {xem && urls[xem.id] && (
        <ImageViewer
          src={urls[xem.id]}
          name={xem.fileName}
          kind={xem.fileType === "video" ? "video" : "image"}
          onClose={() => setXem(null)}
        />
      )}
    </div>
  );
}
