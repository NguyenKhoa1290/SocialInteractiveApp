import { useState } from "react";
import { Avatar } from "../../components/Avatar";
import { MeetingPopup, HangTac } from "./MeetingPopup";
import { IconCamera, IconDoiRa, IconMicrophone, IconPhoNhom, IconScreenShare } from "./MeetingIcons";
import type { Meeting, MeetingParticipant, PermissionType, WaitingParticipant } from "../../types/media";
import type { Friend } from "../../types/friend";

// Nut tron CHI CO BIEU TUONG cho dai nut quan tri o tung hang. Chu khong mat
// di: no chuyen vao title (hien khi re chuot) va aria-label (trinh doc man
// hinh). Bo chu ma khong de lai gi thi nguoi chua quen icon phai doan.
//
// `bat` = viec nay CHUA lam (nut mau teal, bam vao la cam/phong); false =
// da lam roi (nut xam, bam vao la go ra). Mau giu nguyen nhu ban co chu.
function NutIcon({
  bat,
  nhan,
  moTa,
  onClick,
  children,
}: {
  bat: boolean;
  nhan: string;
  moTa?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mpop-pill mpop-pill-icon${bat ? " mpop-pill-teal" : " mpop-pill-xam"}`}
      onClick={onClick}
      title={moTa ?? nhan}
      aria-label={nhan}
    >
      {children}
    </button>
  );
}

// Popup "Quan ly thanh vien" - Figma 140:497 (danh sach), 140:774 (co nguoi
// dang cho) va 140:645 (Cai dat phong).
//
// Ba frame la BA TRANG THAI cua cung mot popup chu khong phai ba popup: dai
// nut o dau co "Cai dat" de lat sang trang cai dat phong, va khoi "dang doi"
// chi hien khi that su co nguoi cho.
export function MeetingPeopleDialog({
  meeting,
  participants,
  waiting,
  friends,
  currentUserId,
  truotPhongCho,
  laChuPhongThat,
  anhCua,
  volumes,
  inviteLink,
  invitingId,
  invitedIds,
  dangDoiDuyet,
  onClose,
  onVolume,
  onTogglePermission,
  onKick,
  onApprove,
  onDeny,
  onInviteFriend,
  onCopyInviteLink,
  onMuteAll,
  onDoiCaiDatPhong,
}: {
  meeting: Meeting | null;
  participants: MeetingParticipant[];
  waiting: WaitingParticipant[];
  friends: Friend[];
  currentUserId: number | undefined;
  // Chu phong HOAC dong chu phong. Dong chu chi lam duoc ba viec: duyet phong
  // cho, tat mic ca phong, tat cam ca phong.
  truotPhongCho: boolean;
  // Chu phong THAT - moi thao tac quan tri con lai deu doi cai nay.
  laChuPhongThat: boolean;
  anhCua: Record<number, string | null>;
  volumes: Record<number, number>;
  inviteLink: string | null;
  invitingId: number | null;
  invitedIds: Set<number>;
  dangDoiDuyet: boolean;
  onClose: () => void;
  onVolume: (userId: number, v: number) => void;
  onTogglePermission: (p: MeetingParticipant, t: PermissionType) => void;
  onKick: (userId: number) => void;
  onApprove: (userId: number) => void;
  onDeny: (userId: number) => void;
  onInviteFriend: (f: Friend) => void;
  onCopyInviteLink: () => void;
  onMuteAll: (mic: boolean, camera: boolean) => void;
  onDoiCaiDatPhong: (patch: Partial<Pick<Meeting, "allowCamera" | "allowMic" | "allowScreenShare" | "allowMiniApp" | "requiresApproval">>) => void;
}) {
  const [trang, setTrang] = useState<"nguoi" | "phong">("nguoi");
  const [tim, setTim] = useState("");
  const [moMoi, setMoMoi] = useState(false);

  const loc = tim.trim().toLowerCase();
  const hienThi = loc ? participants.filter((p) => p.nickname.toLowerCase().includes(loc)) : participants;

  // Chu phong doc theo meeting.hostId chu khong theo cot role: sau khi chuyen
  // quyen, hang cu cua chu cu VAN mang role='host' (dau vet "da tung la chu",
  // xem HostSuccession.cs) nen tin vao role la co luc hien hai chu phong.
  const laChu = (p: MeetingParticipant) => meeting != null && p.userId === meeting.hostId;
  const cam2 = (p: MeetingParticipant, t: PermissionType) => p.permissions.includes(t);

  if (trang === "phong") {
    return (
      <MeetingPopup title="Quản lý thành viên" onClose={onClose} width={1000}>
        <div className="mpop-dau">
          <h3 className="mpop-nhan">Cài đặt phòng</h3>
          <button type="button" className="mpop-pill mpop-pill-teal" onClick={() => setTrang("nguoi")}>
            Danh sách
          </button>
        </div>

        {/* Nam cong tac nay la MAC DINH CUA CA PHONG, ap cho ca nguoi vao sau -
            khac han cac nut "Cam ..." o tung hang, von chi nham vao mot nguoi. */}
        <HangTac
          nhan="Cho phép bật cam"
          bat={meeting?.allowCamera ?? true}
          doi={(v) => onDoiCaiDatPhong({ allowCamera: v })}
          khoa={!laChuPhongThat}
        />
        <HangTac
          nhan="Cho phép bật mic"
          bat={meeting?.allowMic ?? true}
          doi={(v) => onDoiCaiDatPhong({ allowMic: v })}
          khoa={!laChuPhongThat}
        />
        <HangTac
          nhan="Cho phép chia sẻ màn hình"
          bat={meeting?.allowScreenShare ?? true}
          doi={(v) => onDoiCaiDatPhong({ allowScreenShare: v })}
          khoa={!laChuPhongThat}
        />
        <HangTac
          nhan="Cho phép một thành viên không phải chủ phòng bắt đầu ứng dụng"
          bat={meeting?.allowMiniApp ?? false}
          doi={(v) => onDoiCaiDatPhong({ allowMiniApp: v })}
          khoa={!laChuPhongThat}
        />
        <HangTac
          nhan="Bật phòng chờ"
          bat={meeting?.requiresApproval ?? true}
          doi={(v) => onDoiCaiDatPhong({ requiresApproval: v })}
          khoa={!truotPhongCho || dangDoiDuyet}
        />
        <p className="mpop-ghi-chu">
          {meeting?.requiresApproval
            ? "Người bấm link mời sẽ nằm ở phòng chờ tới khi bạn duyệt."
            : "Người bấm link mời vào thẳng phòng, không phải chờ duyệt."}
        </p>
      </MeetingPopup>
    );
  }

  return (
    <MeetingPopup title="Quản lý thành viên" onClose={onClose} width={1000}>
      {truotPhongCho && waiting.length > 0 && (
        <>
          <h3 className="mpop-nhan">Danh sách Thành viên đang đợi</h3>
          <label className="mpop-tim">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
              <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm kiếm người trong phòng" />
          </label>
          {waiting.map((w) => (
            <div key={w.userId} className="mpop-hang">
              <Avatar userId={w.userId} nickname={w.nickname} avatarUpdatedAt={anhCua[w.userId]} size={68} />
              <span className="mpop-ten">{w.nickname}</span>
              <span className="mpop-nut">
                <button type="button" className="mpop-pill mpop-pill-xam" onClick={() => onDeny(w.userId)}>
                  Đuổi
                </button>
                <button type="button" className="mpop-pill mpop-pill-teal" onClick={() => onApprove(w.userId)}>
                  Cho phép
                </button>
              </span>
            </div>
          ))}
        </>
      )}

      <div className="mpop-dau">
        <h3 className="mpop-nhan">Danh sách Thành viên</h3>
        {/* Tat mic/cam ca phong: TAT mot lan, ai cung bat lai duoc - khac
            han "Cấm mic" o tung hang (thu quyen). Dong chu phong lam duoc
            viec nay, nhung khong cam duoc ai. */}
        {truotPhongCho && (
          <>
            <button type="button" className="mpop-pill mpop-pill-do" onClick={() => onMuteAll(true, false)}>
              Tắt tất cả mic
            </button>
            <button type="button" className="mpop-pill mpop-pill-do" onClick={() => onMuteAll(false, true)}>
              Tắt tất cả cam
            </button>
          </>
        )}
        {laChuPhongThat && (
          <>
            <button type="button" className="mpop-pill mpop-pill-teal" onClick={() => setMoMoi((v) => !v)}>
              Mời bạn bè
            </button>
            <button type="button" className="mpop-pill mpop-pill-teal" onClick={onCopyInviteLink}>
              {inviteLink ? "Sao chép link mời" : "Tạo link mời"}
            </button>
            <button type="button" className="mpop-pill mpop-pill-teal" onClick={() => setTrang("phong")}>
              Cài đặt
            </button>
          </>
        )}
      </div>

      {moMoi && (
        <div className="mpop-moi">
          {friends.length === 0 ? (
            <p className="mpop-ghi-chu">Chưa có bạn bè nào để mời.</p>
          ) : (
            friends.map((f) => {
              // Co y dung `participants` (so sach) chu khong phai danh sach
              // dang ket noi: nguoi vua rot mang van con ho so trong cuoc hop,
              // moi lai chi to loi "da o trong phong".
              const trongPhong = participants.some((p) => p.userId === f.userId);
              return (
                <div key={f.userId} className="mpop-hang-moi">
                  <Avatar userId={f.userId} nickname={f.nickname} avatarUpdatedAt={f.avatarUpdatedAt} size={44} />
                  <span className="mpop-ten-moi">{f.nickname}</span>
                  {trongPhong ? (
                    <span className="mpop-ghi-chu">Đang trong phòng</span>
                  ) : (
                    <button
                      type="button"
                      className="mpop-pill mpop-pill-teal"
                      onClick={() => onInviteFriend(f)}
                      disabled={invitingId === f.userId || invitedIds.has(f.userId)}
                    >
                      {invitedIds.has(f.userId) ? "Đã mời" : invitingId === f.userId ? "Đang mời…" : "Mời"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {(!truotPhongCho || waiting.length === 0) && (
        <label className="mpop-tim">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="2.2" />
            <path d="m15.6 15.6 4.6 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <input value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm kiếm người trong phòng" />
        </label>
      )}

      {hienThi.length === 0 && <p className="mpop-ghi-chu">Không tìm thấy ai.</p>}

      {hienThi.map((p) => {
        const nguoiKhac = p.userId !== currentUserId;
        const cam = (t: PermissionType) => p.permissions.includes(t);
        return (
          <div key={p.userId} className="mpop-hang">
            <Avatar userId={p.userId} nickname={p.nickname} avatarUpdatedAt={anhCua[p.userId]} size={68} />
            <span className="mpop-ten">
              {p.nickname}
              {laChu(p) ? <em> · Chủ phòng</em> : cam2(p, "co_host") ? <em> · Phó nhóm</em> : null}
            </span>

            {/* Ca dai nut nay la cua chu phong THAT: pho nhom khong tu
                nhan them pho nhom, cung khong cam/duoi ai. */}
            {laChuPhongThat && nguoiKhac && !laChu(p) && (
              <span className="mpop-nut">
                <NutIcon
                  bat={!cam("co_host")}
                  nhan={cam("co_host") ? "Truất quyền" : "Phó nhóm"}
                  moTa={
                    cam("co_host")
                      ? "Truất quyền phó nhóm của người này"
                      : "Phó nhóm - duyệt phòng chờ, tắt mic/camera cả phòng, và thay bạn khi bạn rời đi"
                  }
                  onClick={() => onTogglePermission(p, "co_host")}
                >
                  <IconPhoNhom size={22} ha={cam("co_host")} />
                </NutIcon>

                <NutIcon
                  bat={!cam("no_mic")}
                  nhan={cam("no_mic") ? "Bỏ cấm mic" : "Cấm mic"}
                  onClick={() => onTogglePermission(p, "no_mic")}
                >
                  <IconMicrophone size={22} off={!cam("no_mic")} />
                </NutIcon>

                <NutIcon
                  bat={!cam("no_camera")}
                  nhan={cam("no_camera") ? "Bỏ cấm camera" : "Cấm camera"}
                  onClick={() => onTogglePermission(p, "no_camera")}
                >
                  <IconCamera size={22} off={!cam("no_camera")} />
                </NutIcon>

                <NutIcon
                  bat={!cam("no_screen_share")}
                  nhan={cam("no_screen_share") ? "Bỏ cấm chia sẻ màn hình" : "Cấm chia sẻ màn hình"}
                  onClick={() => onTogglePermission(p, "no_screen_share")}
                >
                  <IconScreenShare size={22} off={!cam("no_screen_share")} />
                </NutIcon>

                <NutIcon bat={false} nhan="Mời ra khỏi phòng" onClick={() => onKick(p.userId)}>
                  <IconDoiRa size={22} />
                </NutIcon>
              </span>
            )}

            {/* Am luong cua nguoi nay o PHIA MINH - khong ai khac bi anh
                huong, nen ai cung keo duoc, khong can quyen gi. */}
            {nguoiKhac && (
              <input
                className="mpop-am"
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round((volumes[p.userId] ?? 1) * 100)}
                onChange={(e) => onVolume(p.userId, Number(e.target.value) / 100)}
                aria-label={`Âm lượng của ${p.nickname}`}
                title={`Âm lượng của ${p.nickname}: ${Math.round((volumes[p.userId] ?? 1) * 100)}%`}
                style={{ ["--phan" as string]: `${Math.round((volumes[p.userId] ?? 1) * 100)}%` }}
              />
            )}
          </div>
        );
      })}
    </MeetingPopup>
  );
}
