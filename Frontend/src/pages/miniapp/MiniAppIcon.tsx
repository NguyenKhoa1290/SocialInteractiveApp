import bieuTuong from "../../assets/calli/calli-icon-vuong.svg";

// Biểu tượng Calli IPTV.
//
// Dùng ĐÚNG tệp logo của bộ nhận diện (`calli-icon-vuong.svg`): ô vuông bo
// góc nền #2F3C52, chữ "C" trắng, năm vạch âm thanh #85AEB0 ở giữa. Trước đây
// tôi tự vẽ lại bằng SVG và làm mất hẳn chữ C — vẽ lại một cái logo đã có sẵn
// thì chỉ có thể ra sai.
export function MiniAppIcon({ size = 70 }: { size?: number }) {
  return (
    <img
      src={bieuTuong}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ flex: "none", display: "block" }}
    />
  );
}
