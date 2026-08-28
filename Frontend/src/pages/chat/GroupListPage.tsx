import { ChatWorkspace } from "./ChatWorkspace";
import { ConversationList } from "./ConversationList";
import "./chat.css";

// /app/groups - man CHAT NHOM khi chua chon nhom nao.
//
// Chat ca nhan va chat nhom la HAI MUC RIENG (Figma: "Man hinh chinh" node
// 111:391 va "Danh sach nhom" node 122:1248), khong tron chung mot danh sach.
// Icon thu hai tren thanh dieu huong - trong Figma ten la "Group" - dan toi day.
export function GroupListPage() {
  return (
    <ChatWorkspace
      hasActive={false}
      isGroup
      list={<ConversationList kind="group" />}
      chat={
        <div className="cw-blank">
          <p>Chọn một nhóm ở danh sách bên trái, hoặc tạo nhóm mới.</p>
        </div>
      }
    />
  );
}
