import { useIptvSlot } from "./IptvPlayerHost";

// Khung trinh bay Mini App IPTV - CHI co trinh phat, khong co gi khac.
//
// Truoc day khung nay con mang mot dau de ("Mini App - IPTV - <ten kenh>"),
// nut "Doi kenh", thanh am luong va nut "Tai lai luong". Tat ca da chuyen vao
// popup Mini App: bam bieu tuong app o thanh ben phai trong luc dang phat thi
// popup mo thang sang trang dieu khien (Figma 149:1321). Khung chieu de danh
// het cho hinh - dung y "khung do chi co IPTV thoi".
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
export function IptvStage({ compact = false }: {
  // compact = dang nam trong mot O LUOI chu khong phai khung trung tam.
  compact?: boolean;
}) {
  const slot = useIptvSlot();
  const status = slot?.status ?? "idle";

  return (
    <div className={compact ? "meet-app-stage meet-app-compact" : "meet-app-stage"}>
      {status === "error" && <p className="meet-error">{slot?.error}</p>}

      {/* Ba dong duoi chi hien khi CHUA co hinh nao ca - luc dang phat thi
          khung sach tron mot mau video. */}
      {status === "idle" && (
        <p className="meet-empty">
          Đang chờ chọn kênh — mở biểu tượng ứng dụng ở thanh bên phải để chọn.
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
