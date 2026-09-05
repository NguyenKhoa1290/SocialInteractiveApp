import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import { AuthLayout, ErrorText, FieldGroupLabel } from "./AuthLayout";
import { IconEye } from "./AuthIcons";

// Dang ky hai buoc: dien thong tin -> nhap ma gui qua mail.
//
// Buoc 1 KHONG tao tai khoan nao ca (xem AuthEndpoints.cs): ca lan dang ky nam
// trong Redis 10 phut, chi khi nhap dung ma thi tai khoan moi sinh ra. Nen o
// day phai giu email/mat khau/ten trong state - bam "Doi email" la quay ve
// dung form cu, khong bat go lai tu dau.
export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Buoc dang o: "nhap" (form) hay "ma" (nhap ma xac thuc).
  const [buoc, setBuoc] = useState<"nhap" | "ma">("nhap");
  const [ma, setMa] = useState("");
  const [ghiChu, setGhiChu] = useState<string | null>(null);
  // Con bao nhieu giay nua moi bam duoc "Gui lai ma".
  const [choGuiLai, setChoGuiLai] = useState(0);
  const oMaRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (choGuiLai <= 0) return;
    const t = setTimeout(() => setChoGuiLai((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [choGuiLai]);

  // Nhay con tro thang vao o nhap ma - nguoi dung vua doc ma trong mail xong,
  // khong phai bam them mot cu nua.
  useEffect(() => {
    if (buoc === "ma") oMaRef.current?.focus();
  }, [buoc]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.register(email, password, nickname);
      setChoGuiLai(data.guiLaiSauGiay);
      setGhiChu(`Đã gửi mã xác thực tới ${data.email}. Mã có hiệu lực trong ${Math.round(data.ttlGiay / 60)} phút.`);
      setBuoc("ma");
    } catch (err) {
      setError(extractApiError(err, "Đăng ký thất bại"));
    } finally {
      setLoading(false);
    }
  }

  async function xacThuc(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.verifyRegistration(email, ma.trim());
      setAuth(data.accessToken, data.user);
      scheduleTokenRefresh(data.accessToken);
      navigate("/app");
    } catch (err) {
      const loi = extractApiError(err, "Không xác thực được");
      setError(loi);
      // Lan dang ky da bi huy (het han / sai qua nhieu lan) thi quay ve form,
      // dung de nguoi dung go mai vao mot cai ma khong con ton tai.
      if (/hết hạn|quá nhiều lần|het han|qua nhieu lan/i.test(loi)) {
        setBuoc("nhap");
        setMa("");
        setGhiChu(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function guiLai() {
    setError(null);
    try {
      const { data } = await authApi.resendRegistration(email);
      setChoGuiLai(data.guiLaiSauGiay);
      setGhiChu(`Đã gửi lại mã tới ${data.email}.`);
    } catch (err) {
      setError(extractApiError(err, "Không gửi lại được mã"));
    }
  }

  if (buoc === "ma") {
    return (
      <AuthLayout title="Xác thực email">
        <form onSubmit={xacThuc} className="auth-form">
          <div>
            <FieldGroupLabel>Nhập mã gửi tới email của bạn</FieldGroupLabel>
            <label className="auth-field">
              <input
                ref={oMaRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Mã 6 số"
                aria-label="Mã xác thực"
                value={ma}
                onChange={(e) => setMa(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                className="auth-input"
              />
            </label>
          </div>

          {ghiChu && <p className="auth-note">{ghiChu}</p>}
          <ErrorText message={error} />

          <button type="submit" disabled={loading || ma.length < 6} className="auth-btn-primary">
            {loading ? "Đang xác thực…" : "Xác thực và tạo tài khoản"}
          </button>

          <div className="auth-row-actions">
            <button type="button" className="auth-btn-link" onClick={guiLai} disabled={choGuiLai > 0}>
              {choGuiLai > 0 ? `Gửi lại mã sau ${choGuiLai}s` : "Gửi lại mã"}
            </button>
            <button
              type="button"
              className="auth-btn-link"
              onClick={() => {
                setBuoc("nhap");
                setMa("");
                setError(null);
                setGhiChu(null);
              }}
            >
              Đổi email
            </button>
          </div>
        </form>
        <p className="auth-footer">
          Chưa nhập mã thì chưa có tài khoản nào được tạo.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Đăng ký vào Calli">
      <form onSubmit={handleSubmit} className="auth-form">
        <div>
          <FieldGroupLabel>Đăng ký bằng email</FieldGroupLabel>
          <label className="auth-field">
            <input
              type="email"
              placeholder="Địa chỉ email"
              aria-label="Địa chỉ email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="auth-input"
            />
          </label>
        </div>

        <label className="auth-field auth-field-has-eye">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Mật khẩu (tối thiểu 8 ký tự)"
            aria-label="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="auth-input"
          />
          <button
            type="button"
            className="auth-eye"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            <IconEye open={showPassword} />
          </button>
        </label>

        <label className="auth-field">
          <input
            placeholder="Tên tài khoản"
            aria-label="Tên tài khoản"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            className="auth-input"
          />
        </label>

        <ErrorText message={error} />

        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading ? "Đang gửi mã…" : "Đăng ký"}
        </button>
      </form>
      <p className="auth-footer">
        Đã có tài khoản ? <Link to="/login">Đăng nhập</Link>
      </p>
    </AuthLayout>
  );
}
