import { useIptvSlot } from "./IptvPlayerHost";

// Khung trinh bay Mini App IPTV - CHI co phan vien: tieu de, nut doi kenh,
// va mot O TRONG de trinh phat gan vao. Danh sach kenh nam trong popup rieng
// (xem IptvChannelPicker).
//
// Component nay KHONG tao the <video> va cung khong goi API lay stream URL.
// Ca hai deu do IptvPlayerHost giu, vi component nay bi thao ra/dung lai moi
// lan doi bo cuc (focus mode <-> luoi) - neu no so huu trinh phat thi doi bo
// cuc la video tai lai tu dau. Xem IptvPlayerHost.tsx.
//
// Kenh dang chieu den tu TRANG THAI TRINH BAY chung cua phong chu khong phai
// state cua rieng component nay: moi nguoi trong phong cung xem mot kenh,
// dung UC-37 - nguoi trinh bay chon, con luong phat thi MOI MAY TU FETCH
// RIENG (khong day qua LiveKit).
export function IptvStage({
  channelName,
  canPick,
  onOpenPicker,
  compact = false,
}: {
  channelName: string | null;
  canPick: boolean;
  onOpenPicker: () => void;
  // compact = dang nam trong mot O LUOI chu khong phai khung trung tam:
  // khong con cho cho nut/link phu, chi giu dung trinh phat.
  compact?: boolean;
}) {
  const slot = useIptvSlot();
  const status = slot?.status ?? "idle";

  return (
    <div className={compact ? "meet-app-stage meet-app-compact" : "meet-app-stage"}>
      <div className="meet-side-head">
        <h3>
          {compact
            ? (channelName ?? "Mini App · IPTV")
            : `Mini App · IPTV${channelName ? ` · ${channelName}` : ""}`}
        </h3>
      </div>

      {status === "error" && <p className="meet-error">{slot?.error}</p>}

      {status === "idle" && (
        <p className="meet-empty">
          Đang chờ gắn link kênh…
          {canPick && !compact && " Bấm “Chọn kênh” để phát cho cả phòng."}
          {canPick && compact && " Bấm “Mini App IPTV” ở trên để chọn."}
        </p>
      )}

      {status === "loading" && <p className="meet-empty">Đang lấy luồng phát…</p>}

      {/* O nhan trinh phat. The <video> khong do React tao ra o day - no duoc
          IptvPlayerHost chuyen vao bang appendChild, nen doi bo cuc khong lam
          gian doan luong dang phat. Ca o nay lan holder deu la
          display:contents nen khong them mot tang layout nao. */}
      <div ref={slot?.mount} className="iptv-player-slot" />
    </div>
  );
}
