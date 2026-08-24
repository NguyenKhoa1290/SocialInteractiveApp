import "./upload-progress.css";

export type UploadState = {
  name: string;
  loaded: number;
  total: number;
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Thanh tien do tai file len.
//
// Dung chung cho luong chat chinh va luong thao luan cuoc hop, nen KHONG bam
// vao bang mau cua rieng trang nao: chu lay currentColor (thua cua khung
// chua), ray dung mau xam trong suot - doc duoc ca tren nen sang cua trang
// chat lan nen toi cua phong hop.
export function UploadProgressBar({ state }: { state: UploadState }) {
  const percent = state.total > 0 ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;

  // 100% nghia la TRINH DUYET da gui xong, chua chac may chu da luu xong -
  // no con phai ghi xuong dia va tra loi. Khong noi ro thi nguoi dung thay
  // thanh day roi ma van phai cho, tuong treo.
  const sent = percent >= 100;

  return (
    <div className="upload-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="upload-progress-head">
        <span className="upload-progress-name" title={state.name}>
          {state.name}
        </span>
        <span className="upload-progress-num">
          {sent ? "Đang lưu trên máy chủ…" : `${humanSize(state.loaded)} / ${humanSize(state.total)} · ${percent}%`}
        </span>
      </div>
      <div className="upload-progress-track">
        <div
          className={sent ? "upload-progress-fill upload-progress-fill-done" : "upload-progress-fill"}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
