import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import wordmark from "../../assets/calli/calli-wordmark.svg";
import heroArt from "../../assets/calli/minhhoa-hero.webp";
import bizArt from "../../assets/calli/minhhoa-doanhnghiep.webp";
import icon1 from "../../assets/calli/icon-tinhnang-1.webp";
import icon2 from "../../assets/calli/icon-tinhnang-2.webp";
import icon3 from "../../assets/calli/icon-tinhnang-3.webp";
import "./landing.css";

// Ba the tinh nang. Chu lay nguyen van tu ban thiet ke, TRU cac loi chinh ta
// da bao voi chu du an: "dau cuoi" (Figma ghi "dau cuoi~"), "thuan tien".
const FEATURES = [
  {
    icon: icon1,
    title: "Tất cả trong một",
    body: "Nhắn tin, lưu trữ, gọi điện, hỗ trợ kỹ thuật, giải trí nằm ngay trong một nền tảng",
  },
  {
    icon: icon2,
    title: "Nhắn tin bảo mật",
    body: "Nhắn tin liên thiết bị bảo mật bằng các công nghệ mã hóa đầu cuối cho nhắn tin giữa các nhóm",
  },
  {
    icon: icon3,
    title: "Triết lý thiết kế tự do",
    body: "Tự do nhắn tin, gửi file, video, cuộc họp lên đến 24 giờ liên tục miễn phí",
  },
];

const NAV = [
  { href: "#gioi-thieu", label: "Giới thiệu" },
  { href: "#tinh-nang", label: "Tính năng" },
  { href: "#gia-tien", label: "Giá tiền" },
  { href: "#lien-he", label: "Liên hệ" },
];

const SOCIAL = [
  { label: "Facebook", href: "https://facebook.com" },
  { label: "Instagram", href: "https://instagram.com" },
  { label: "GitHub", href: "https://github.com" },
  { label: "Zalo", href: "https://zalo.me" },
];

// Trang chu. `overlay` la popup dang chong len (dang nhap / dang ky / quen mat
// khau...) - trang van duoc dung day du ben duoi de nguoi dung dong popup la
// thay ngay, va de dia chi /login van chia se duoc nhu mot lien ket binh thuong.
export function LandingPage({ overlay }: { overlay?: ReactNode }) {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // O nhap ten ngay tren hero di thang vao luong KHACH VANG LAI da co san o
  // backend - khong phai mot luong dang ky moi. Loi "Ten nguoi dung nay da ton
  // tai" trong ban thiet ke chinh la 409 ma /auth/guest tra ve.
  async function handleGuest(e: React.FormEvent) {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) return;
    setError(null);
    setLoading(true);
    try {
      const { data } = await authApi.guest(name);
      setAuth(data.accessToken, data.user);
      scheduleTokenRefresh(data.accessToken);
      navigate("/app");
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setError("Tên người dùng này đã tồn tại");
        return;
      }
      setError(extractApiError(err, "Không vào được, thử lại giúp tôi"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-logo" aria-label="Calli">
          <img src={wordmark} alt="Calli" />
        </Link>
        <nav className="lp-nav-menu" aria-label="Mục lục">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <Link to="/login" className="lp-btn-outline">
          Đăng nhập
        </Link>
      </header>

      <section className="lp-hero" id="gioi-thieu">
        <div className="lp-hero-text">
          <h1>
            Nền tảng gọi điện
            <br />
            Tương tác thông minh
          </h1>
          <p className="lp-hero-sub">
            Nền tảng tích hợp các dịch vụ trong một, chạy ngay trên website — hãy điền tên và bắt đầu ngay hôm nay
          </p>

          <form onSubmit={handleGuest} className="lp-hero-form">
            <input
              className="lp-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Tên người dùng"
              aria-label="Tên người dùng"
              maxLength={50}
            />
            {error && <p className="lp-error">{error}</p>}
            <button type="submit" className="lp-btn-arrow" disabled={loading || nickname.trim() === ""}>
              {loading ? "Đang vào…" : "Bắt đầu ngay"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M13.2 4.8 20.4 12l-7.2 7.2-1.7-1.7 4.3-4.3H3.6v-2.4h12.2l-4.3-4.3 1.7-1.7Z" />
              </svg>
            </button>
          </form>
        </div>
        <img className="lp-hero-art" src={heroArt} alt="" width={937} height={709} />
      </section>

      <section className="lp-features" id="tinh-nang">
        <h2>Tính năng nổi bật</h2>
        <div className="lp-cards">
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-card">
              <img src={f.icon} alt="" width={60} height={60} />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
        <Link to="/register" className="lp-btn-solid">
          Đăng ký ngay
        </Link>
      </section>

      <section className="lp-biz" id="gia-tien">
        <div className="lp-biz-text">
          <h2>
            Giải pháp cho doanh nghiệp nhỏ
            <br />
            và cá nhân
          </h2>
          <p>Sử dụng thuận tiện với cơ chế miniapp tiện dụng, nhỏ gọn và tiết kiệm thời gian</p>
        </div>
        <img className="lp-biz-art" src={bizArt} alt="" width={830} height={632} />
      </section>

      <div className="lp-stamp-wrap">
        {/* "Mua tem phieu" co trong ban thiet ke nhung he thong CHUA co chuc
            nang nay - de nut dan toi trang nap dung luong (thu gan nhat) thay
            vi mot lien ket chet. */}
        <Link to="/app" className="lp-stamp">
          Mua tem phiếu
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13.2 4.8 20.4 12l-7.2 7.2-1.7-1.7 4.3-4.3H3.6v-2.4h12.2l-4.3-4.3 1.7-1.7Z" />
          </svg>
        </Link>
      </div>

      <footer className="lp-footer" id="lien-he">
        <div className="lp-footer-cols">
          <div className="lp-footer-col">
            <h4>Hỗ trợ</h4>
            <Link to="/complaints">Gỡ khóa tài khoản</Link>
            <a href="https://github.com" target="_blank" rel="noreferrer noopener">
              Mã nguồn
            </a>
            <a href="#lien-he">Thông tin nhà sáng lập</a>
          </div>
          <div className="lp-footer-col lp-footer-social">
            <h4>Mạng xã hội cá nhân</h4>
            <div className="lp-social-row">
              {SOCIAL.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noreferrer noopener">
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
        <hr />
        <p className="lp-footer-domain">www.calli.vn</p>
      </footer>

      {overlay}
    </div>
  );
}
