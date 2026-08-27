import { ChatWorkspace } from "./ChatWorkspace";
import { ConversationList } from "./ConversationList";
import "./chat.css";

// /app - man CHAT CA NHAN khi chua chon hoi thoai nao. Chat nhom o /app/groups
// (xem GroupListPage) - hai muc rieng biet, khong tron danh sach.
//
// Dung chung bo cuc ba panel voi /app/chat/:id (xem ChatWorkspace): danh sach
// ben trai giu nguyen, chi khac la khung giua chua co gi. Truoc day day la
// mot trang rieng, mo mot cuoc tro chuyen la danh sach bien mat va phai bam
// "Ve danh sach chat" de quay lai.
export function ChatListPage() {
  return (
    <ChatWorkspace
      hasActive={false}
      list={<ConversationList kind="p2p" />}
      chat={
        <div className="cw-blank">
          <p>Chọn một cuộc trò chuyện ở danh sách bên trái để bắt đầu nhắn tin.</p>
        </div>
      }
    />
  );
}
