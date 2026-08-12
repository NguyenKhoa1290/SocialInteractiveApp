import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { GuestPage } from "./pages/auth/GuestPage";
import { NicknamePage } from "./pages/auth/NicknamePage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { AccountLockedPage } from "./pages/auth/AccountLockedPage";
import { ComplaintsPage } from "./pages/ComplaintsPage";
import { WorkspaceListPage } from "./pages/workspace/WorkspaceListPage";
import { CreateWorkspacePage } from "./pages/workspace/CreateWorkspacePage";
import { WorkspaceMembersPage } from "./pages/workspace/WorkspaceMembersPage";
import { WorkspaceSettingsPage } from "./pages/workspace/WorkspaceSettingsPage";
import { FriendsPage } from "./pages/friends/FriendsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ChatListPage } from "./pages/chat/ChatListPage";
import { ChatRoomPage } from "./pages/chat/ChatRoomPage";
import { MeetingRoomPage } from "./pages/meeting/MeetingRoomPage";
import { JoinMeetingPage } from "./pages/meeting/JoinMeetingPage";
import { IptvManagePage } from "./pages/meeting/IptvManagePage";
import { MeetingDiscussionPage } from "./pages/meeting/MeetingDiscussionPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuthStore } from "./store/authStore";
import { useKeyStore } from "./store/keyStore";
import { scheduleTokenRefresh } from "./lib/tokenScheduler";
import { loadPersistedKey } from "./lib/crypto/keyPersistence";

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  // Phien duoc phuc hoi tu localStorage luc load trang (persist middleware) -
  // can lap lich refresh lai vi scheduler chi chay trong bo nho, khong song
  // qua lan reload. Private key E2EE cung nap lai tu localStorage neu con
  // "song" (chua qua han JWT) - tranh phai nhap lai PIN moi lan F5, xem
  // lib/crypto/keyPersistence.ts.
  useEffect(() => {
    if (accessToken) scheduleTokenRefresh(accessToken);
    if (user) {
      const cached = loadPersistedKey(user.id);
      if (cached) useKeyStore.getState().setKeys(cached.privateKey, cached.publicKey);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/guest" element={<GuestPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/account-locked" element={<AccountLockedPage />} />
        <Route
          path="/complaints"
          element={
            <ProtectedRoute>
              <ComplaintsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/nickname"
          element={
            <ProtectedRoute>
              <NicknamePage />
            </ProtectedRoute>
          }
        />
        {/* Dock duoi: Chat (mac dinh sau login) / Nhom / Ban be / Ca nhan */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <ChatListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/chat/:id"
          element={
            <ProtectedRoute>
              <ChatRoomPage />
            </ProtectedRoute>
          }
        />
        {/* Phong hop chiem toan man hinh - KHONG boc AppShell/dock, dung
            tinh than "dang goi thi khong dieu huong di cho khac". */}
        <Route
          path="/meetings/:id"
          element={
            <ProtectedRoute>
              <MeetingRoomPage />
            </ProtectedRoute>
          }
        />
        {/* KHONG boc ProtectedRoute: nguoi la bam link moi phai vao duoc du
            chua co tai khoan. Trang tu xu ly - da dang nhap thi vao thang,
            chua thi chi hoi mot cai biet danh roi tao phien Guest (UC-04). */}
        <Route path="/meetings/join/:token" element={<JoinMeetingPage />} />
        <Route
          path="/app/iptv"
          element={
            <ProtectedRoute>
              <IptvManagePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/chat/:id/meetings/:meetingId"
          element={
            <ProtectedRoute>
              <MeetingDiscussionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/friends"
          element={
            <ProtectedRoute>
              <FriendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspaces"
          element={
            <ProtectedRoute>
              <WorkspaceListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspaces/new"
          element={
            <ProtectedRoute>
              <CreateWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspaces/:id"
          element={
            <ProtectedRoute>
              <WorkspaceMembersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspaces/:id/settings"
          element={
            <ProtectedRoute>
              <WorkspaceSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
