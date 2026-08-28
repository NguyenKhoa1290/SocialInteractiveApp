// Biểu tượng Calli IPTV - dựng lại theo group "Biểu tượng app" trong Figma
// (node 111:353): ô vuông bo góc, vòng tròn sáng ở giữa, và năm vạch âm
// thanh cao thấp dần từ giữa ra.
//
// Vẽ bằng SVG chứ không nhúng ảnh: nó phải hiện ở ba cỡ khác nhau (70 ở thẻ
// app, 70 trong popup, 40 ở chỗ chật) và một tệp PNG sẽ nhoè ở cỡ lớn nhất.
export function MiniAppIcon({ size = 70 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 70 70"
      fill="none"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <rect width="70" height="70" rx="16" fill="var(--calli-navy)" />
      <circle cx="35" cy="35" r="25" fill="var(--calli-teal)" />
      {/* Năm vạch: hai ngoài thấp, hai giữa cao hơn, vạch giữa cao nhất. */}
      <g stroke="var(--calli-navy)" strokeWidth="2.6" strokeLinecap="round">
        <line x1="27" y1="31" x2="27" y2="39" />
        <line x1="31" y1="28" x2="31" y2="42" />
        <line x1="35" y1="26" x2="35" y2="44" />
        <line x1="39" y1="28" x2="39" y2="42" />
        <line x1="43" y1="31" x2="43" y2="39" />
      </g>
    </svg>
  );
}
