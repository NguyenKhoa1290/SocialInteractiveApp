import { useEffect, useRef, useState } from "react";
import { chatApi } from "../../api/chatApi";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { Avatar } from "../../components/Avatar";
import { AvatarCropDialog } from "../../components/AvatarCropDialog";
import { ImageViewer } from "../../components/ImageViewer";
import { IconCaret } from "./ComposerIcons";
import type { FileMeta } from "../../types/chat";

export type ThanhVien = { userId: number; nickname: string; avatarUpdatedAt?: string | null };

const MEDIA_PAGE_SIZE = 12;
const MEDIA_URL_CONCURRENCY = 4;

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
// Danh sach nhom chinh nam o /app/groups. Trang quan ly nay chi la diem den
// tu menu Tuy chinh cua dung nhom dang mo, de khong tao them mot danh sach
// Workspace tong song song.
function MenuTuyChinh({
  themDuoc,
  onThem,
  onQuanLy,
}: {
  themDuoc: boolean;
  onThem?: () => void;
  onQuanLy?: () => void;
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
          {onQuanLy && (
            <button
              type="button"
              role="menuitem"
              className="cw-menu-muc"
              onClick={() => {
                setMo(false);
                onQuanLy();
              }}
            >
              Quản lý thành viên
            </button>
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
  onManageMembers,
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
  onManageMembers?: () => void;
  workspaceId?: number | null;
  groupAvatarUpdatedAt?: string | null;
  // Doi anh nhom la quyen cua Truong nhom / Pho nhom - cung quyen voi doi ten
  // nhom. Server van chan bang 403; an nut o day chi de khong moi nguoi bam
  // vao mot thu chac chan se bi tu choi.
  canEditGroup?: boolean;
  onGroupAvatarChanged?: (avatarUpdatedAt: string | null) => void;
}) {
  // Danh sach thanh vien mo san, con media de gap. Anh/video can URL ky rieng,
  // nen chi tai khi nguoi dung thuc su mo muc nay.
  const [hienThanhVien, setHienThanhVien] = useState(true);
  const [hienMedia, setHienMedia] = useState(false);
  const [media, setMedia] = useState<FileMeta[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [dangTaiMedia, setDangTaiMedia] = useState(false);
  const [conMedia, setConMedia] = useState(true);
  const [xem, setXem] = useState<FileMeta | null>(null);
  const mediaRequestVersion = useRef(0);
  const dangTaiMediaRef = useRef(false);
  const laNhom = members !== undefined;

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [anhBan, setAnhBan] = useState(false);
  const [anhLoi, setAnhLoi] = useState<string | null>(null);
  const [anhCanCat, setAnhCanCat] = useState<File | null>(null);
  const doiDuocAnh = laNhom && canEditGroup === true && typeof workspaceId === "number";

  async function doiAnhNhom(blob: Blob) {
    if (typeof workspaceId !== "number") return;
    setAnhLoi(null);
    setAnhBan(true);
    try {
      const { data } = await workspaceApi.uploadAvatar(workspaceId, blob);
      onGroupAvatarChanged?.(data.avatarUpdatedAt);
    } catch (err) {
      // Popup cat anh nem Error thuong (khong co `response`), loi mang thi co.
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
    mediaRequestVersion.current += 1;
    dangTaiMediaRef.current = false;
    setHienMedia(false);
    setMedia(null);
    setUrls({});
    setConMedia(true);
    setDangTaiMedia(false);
    setXem(null);
  }, [conversationId]);

  async function taiMediaCuHon() {
    if (dangTaiMediaRef.current || !conMedia) return;
    const version = mediaRequestVersion.current;
    const oldest = media?.at(-1);
    const before = oldest?.uploadedAt;
    dangTaiMediaRef.current = true;
    setDangTaiMedia(true);
    try {
      const { data } = await chatApi.listFiles(conversationId, before, MEDIA_PAGE_SIZE, oldest?.id);
      if (version !== mediaRequestVersion.current) return;
      const anhVideo = data.filter((f) => f.fileType === "image" || f.fileType === "video");
      setConMedia(data.length === MEDIA_PAGE_SIZE);
      setMedia((truoc) => {
        const cu = truoc ?? [];
        const ids = new Set(cu.map((f) => f.id));
        return [...cu, ...anhVideo.filter((f) => !ids.has(f.id))];
      });

      // Moi trang chi ky URL cho cac o vua nap. Bon request song song giup
      // anh hien dan ma khong tao mot dot request lon len Chat Service/MinIO.
      for (let i = 0; i < anhVideo.length; i += MEDIA_URL_CONCURRENCY) {
        const cap = await Promise.all(
          anhVideo.slice(i, i + MEDIA_URL_CONCURRENCY).map(async (f) => {
            try {
              const { data: url } = await chatApi.getDownloadUrl(f.id);
              return [f.id, url.uploadUrl] as const;
            } catch {
              return null;
            }
          }),
        );
        if (version !== mediaRequestVersion.current) return;
        const them = Object.fromEntries(cap.filter((x): x is readonly [number, string] => x !== null));
        setUrls((truoc) => ({ ...truoc, ...them }));
      }
    } catch {
      if (version === mediaRequestVersion.current) {
        setMedia((truoc) => truoc ?? []);
        setConMedia(false);
      }
    } finally {
      if (version === mediaRequestVersion.current) {
        dangTaiMediaRef.current = false;
        setDangTaiMedia(false);
      }
    }
  }

  function doiTrangThaiMedia() {
    const seMo = !hienMedia;
    setHienMedia(seMo);
    if (seMo && media === null) void taiMediaCuHon();
  }

  function mo(f: FileMeta) {
    // Chi mo popup khi da co URL da ky; chua ky xong thi bam khong lam gi thay
    // vi mo mot popup trong.
    if (urls[f.id]) setXem(f);
  }

  return (
    <div
      className={`cw-info${laNhom ? " cw-info-group" : ""}`}
      onScroll={(e) => {
        if (
          hienMedia &&
          e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 160
        ) {
          void taiMediaCuHon();
        }
      }}
    >
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
                if (f) setAnhCanCat(f);
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
                  onQuanLy={onManageMembers}
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
        <NutGap mo={hienMedia} doi={doiTrangThaiMedia} ten="danh sách file media đã gửi" />
      </div>

      {hienMedia && (
        media === null ? (
          <p className="cw-empty">Đang tải media…</p>
        ) : media.length > 0 ? (
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
      {hienMedia && dangTaiMedia && media !== null && (
        <p className="cw-media-loading">Đang tải thêm…</p>
      )}

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

      {anhCanCat && (
        <AvatarCropDialog
          file={anhCanCat}
          title="Chọn vùng ảnh nhóm"
          onClose={() => setAnhCanCat(null)}
          onCropped={doiAnhNhom}
        />
      )}
    </div>
  );
}
