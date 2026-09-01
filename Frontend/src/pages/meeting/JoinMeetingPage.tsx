import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { meetingApi } from "../../api/mediaApi";
import { authApi } from "../../api/authApi";
import { useAuthStore } from "../../store/authStore";
import { scheduleTokenRefresh } from "../../lib/tokenScheduler";
import { extractApiError } from "../../lib/apiError";
import type { MeetingPreview } from "../../types/media";
import "./meeting.css";

// Nhip poll khi dang o phong cho. Media Service chua co WebSocket - token
// LiveKit duoc host duyet se nam trong Redis va CHI DOC DUOC 1 LAN qua
// GET /meetings/{id} (xem MeetingsEndpoints.cs), nen phai poll.
const POLL_MS = 3000;

export function JoinMeetingPage() {
  const { token: inviteToken } = useParams();
  const navigate = useNavigate();
  const nickname = useAuthStore((s) => s.user?.nickname);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [preview, setPreview] = useState<MeetingPreview | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "joining" | "pending" | "denied" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<number | null>(null);
  // Chi dung cho nguoi CHUA dang nhap - nguoi da dang nhap vao thang bang
  // biet danh san co, khong hoi lai gi ca.
  const [guestNickname, setGuestNickname] = useState("");

  useEffect(() => {
    if (!inviteToken) return;
    meetingApi
      .previewInvite(inviteToken)
      .then((res) => {
        setPreview(res.data);
        setPhase("ready");
      })
      .catch((err) => {
        setPhase("error");
        setError(extractApiError(err, "Link mời không hợp lệ hoặc đã hết hạn"));
      });
  }, [inviteToken]);

  // Nguoi la (chua co tai khoan): chi hoi DUNG MOT cai biet danh roi tao
  // phien Guest (UC-04, Identity Service da co san) de co JWT ma vao phong -
  // khong bat dang ky email/mat khau. Nguoi da dang nhap thi khong thay
  // form nay, bam la vao thang.
  async function handleGuestJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!guestNickname.trim()) return;
    setPhase("joining");
    setError(null);
    try {
      const { data } = await authApi.guest(guestNickname.trim());
      setAuth(data.accessToken, data.user);
      scheduleTokenRefresh(data.accessToken);
      await joinWith(data.user.nickname);
    } catch (err) {
      setPhase("ready");
      setError(extractApiError(err, "Không vào được cuộc họp"));
    }
  }

  async function handleJoin() {
    setPhase("joining");
    setError(null);
    try {
      await joinWith(nickname);
    } catch (err) {
      setPhase("error");
      setError(extractApiError(err, "Không vào được cuộc họp"));
    }
  }

  // Nem loi ra ngoai cho noi goi xu ly - 2 luong goi no can bao loi khac
  // nhau (nguoi la thi quay ve form nhap biet danh de sua, vd trung ten).
  async function joinWith(displayName: string | undefined) {
    if (!inviteToken) return;
    const res = await meetingApi.joinByInvite(inviteToken, displayName);
    setMeetingId(res.data.meetingId);
    if (res.data.status === "approved" && res.data.livekitToken) {
      navigate(`/meetings/${res.data.meetingId}`, {
        replace: true,
        state: { livekitToken: res.data.livekitToken, livekitUrl: res.data.livekitUrl },
      });
      return;
    }
    setPhase("pending");
  }

  // Poll cho host duyet.
  const poll = useCallback(async () => {
    if (meetingId === null) return;
    try {
      const res = await meetingApi.get(meetingId);
      if (res.data.callerStatus === "approved" && res.data.livekitToken) {
        navigate(`/meetings/${meetingId}`, {
          replace: true,
          state: { livekitToken: res.data.livekitToken, livekitUrl: res.data.livekitUrl },
        });
      } else if (res.data.callerStatus === "denied") {
        setPhase("denied");
      }
    } catch {
      // loi tam thoi - vong poll sau se thu lai
    }
  }, [meetingId, navigate]);

  useEffect(() => {
    if (phase !== "pending") return;
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, poll]);

  return (
    <div className="meet-page meet-center">
      {phase === "loading" && <p>Đang kiểm tra link mời…</p>}

      {error && <p className="meet-error">{error}</p>}

      {phase === "ready" && preview && (
        <div className="meet-join-card">
          <h2>Tham gia cuộc họp</h2>
          <p>
            Chủ phòng: <strong>{preview.hostNickname}</strong>
          </p>
          <p>Đang có {preview.participantCount} người trong phòng.</p>
          {preview.requiresApproval && <p className="meet-note">Bạn sẽ phải chờ chủ phòng duyệt.</p>}

          {accessToken ? (
            <>
              <p className="meet-note">
                Bạn đang đăng nhập là <strong>{nickname}</strong>.
              </p>
              <button onClick={handleJoin}>Vào phòng</button>
            </>
          ) : (
            <form className="meet-join-form" onSubmit={handleGuestJoin}>
              <p className="meet-note">Bạn chưa đăng nhập - chỉ cần cho biết tên hiển thị trong phòng họp.</p>
              <input
                placeholder="Tên của bạn"
                value={guestNickname}
                onChange={(e) => setGuestNickname(e.target.value)}
                maxLength={50}
                autoFocus
                required
              />
              <button type="submit" disabled={!guestNickname.trim()}>
                Vào phòng
              </button>
            </form>
          )}
        </div>
      )}

      {phase === "joining" && <p>Đang vào phòng…</p>}

      {phase === "pending" && (
        <div className="meet-join-card">
          <h2>Đang chờ chủ phòng duyệt</h2>
          <p className="meet-note">Giữ nguyên trang này, bạn sẽ tự động vào phòng khi được duyệt.</p>
        </div>
      )}

      {phase === "denied" && (
        <div className="meet-join-card">
          <h2>Chủ phòng đã từ chối</h2>
          <button onClick={() => navigate("/app")}>Về trang chính</button>
        </div>
      )}
    </div>
  );
}
