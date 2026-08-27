import { ChatWorkspace } from "./ChatWorkspace";
import { ConversationList } from "./ConversationList";
import "./chat.css";

// /app - man hinh chinh khi CHUA chon hoi thoai nao.
//
// Dung chung bo cuc ba panel voi /app/chat/:id (xem ChatWorkspace): danh sach
// ben trai giu nguyen, chi khac la khung giua chua co gi. Truoc day day la
// mot trang rieng, mo mot cuoc tro chuyen la danh sach bien mat va phai bam
// "Ve danh sach chat" de quay lai.
export function ChatListPage() {
  return (
    <ChatWorkspace
      hasActive={false}
      list={<ConversationList />}
      chat={
        <div className="cw-blank">
          <p>Chọn một cuộc trò chuyện ở danh sách bên trái để bắt đầu nhắn tin.</p>
        </div>
      }
    />
  );
}
