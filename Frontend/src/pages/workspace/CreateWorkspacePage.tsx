import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { workspaceApi } from "../../api/workspaceApi";
import { extractApiError } from "../../lib/apiError";
import { resizeAvatar } from "../../lib/imageResize";
import { AppShell } from "../../components/AppShell";
import { useAuthStore } from "../../store/authStore";
import "./workspace.css";

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  // Chan ca duong go thang dia chi: server tra 403 nhung noi ra o day thi
  // nguoi dung biet ngay vi sao, khong phai dien xong form moi biet.
  const laKhach = useAuthStore((s) => s.user?.userType) === "guest";
  const [name, setName] = useState("");
  // Anh da cat/nen san, giu o dang Blob cho toi luc co id nhom de gui len.
  // `xem` la dia chi blob: dung de xem truoc, phai tu thu hoi khi khong dung.
  const [anh, setAnh] = useState<{ blob: Blob; xem: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Chi khac null khi nhom DA tao xong ma rieng buoc dat anh that bai - luc do
  // khong duoc bam "Tao nhom" lan nua (se ra nhom trung), chi con duong vao.
  const [daTao, setDaTao] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (anh) URL.revokeObjectURL(anh.xem);
    };
  }, [anh]);

  async function chonAnh(file: File) {
    setError(null);
    try {
      // Cat vuong + nen ngay tai trinh duyet, cung ham voi anh dai dien nguoi
      // dung - server chi nhan toi 256KB.
      const { blob } = await resizeAvatar(file);
      setAnh({ blob, xem: URL.createObjectURL(blob) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được ảnh");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await workspaceApi.create(name);
      if (anh) {
        // Anh phai gui SAU khi tao vi truoc do chua co id nhom. Tao nhom da
        // thanh cong roi, nen buoc nay hong thi khong duoc coi la ca viec
        // hong: nhom co that, chi thieu anh.
        try {
          await workspaceApi.uploadAvatar(data.id, anh.blob);
        } catch (err) {
          setDaTao(data.id);
          setError(extractApiError(err, "Đã tạo nhóm nhưng chưa đặt được ảnh - vào nhóm rồi bấm dấu + để thử lại."));
          return;
        }
      }
      navigate(`/workspaces/${data.id}`);
    } catch (err) {
      setError(extractApiError(err, "Không tạo được nhóm"));
    } finally {
      setLoading(false);
    }
  }

  const chuDau = name.trim().charAt(0).toUpperCase() || "?";

  if (laKhach) {
    return (
      <AppShell activeTab="groups">
        <div className="ws-page-header">
          <h1>Tạo nhóm mới</h1>
        </div>
        <p className="ws-empty">
          Tài khoản khách không tạo được nhóm. Lý do: tài khoản khách bị xoá sau 6 tháng không hoạt
          động, mà trưởng nhóm rời nhóm thì cả nhóm bị giải tán - cả nhóm sẽ mất theo. Hãy đăng ký
          một tài khoản, hoặc nhờ một nhóm có sẵn thêm bạn vào.
        </p>
        <Link to="/workspaces" className="ws-btn-primary" style={{ textDecoration: "none" }}>
          Về danh sách nhóm
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell activeTab="groups">
      <div className="ws-page-header">
        <h1>Tạo nhóm mới</h1>
      </div>
      <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
        {/* Anh nhom chon TU TEP, khong phai dan dia chi: dung mot khuon voi
            anh dai dien nguoi dung, va dung huy hieu "+" nhu frame "Danh sach
            nhom" (node 122:1354). */}
        <div className="ws-avatar-pick">
          <span className="ws-avatar-ring">
            {anh ? <img src={anh.xem} alt="Ảnh nhóm đã chọn" /> : chuDau}
          </span>
          <button
            type="button"
            className="ws-avatar-add"
            onClick={() => fileRef.current?.click()}
            aria-label={anh ? "Đổi ảnh nhóm" : "Thêm ảnh nhóm"}
            title={anh ? "Đổi ảnh nhóm" : "Thêm ảnh nhóm"}
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
              // Xoa gia tri de chon LAI DUNG tep vua roi van kich hoat onChange.
              e.target.value = "";
              if (f) void chonAnh(f);
            }}
          />
        </div>

        <input
          placeholder="Tên nhóm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          className="ws-input"
        />
        {error && <p className="ws-error">{error}</p>}
        {daTao !== null ? (
          <Link to={`/workspaces/${daTao}`} className="ws-btn-primary">
            Vào nhóm vừa tạo
          </Link>
        ) : (
          <button type="submit" disabled={loading} className="ws-btn-primary">
            {loading ? "Đang tạo..." : "Tạo nhóm"}
          </button>
        )}
      </form>
    </AppShell>
  );
}
