import { useEffect, useState } from "react";
import { chatApi } from "../../api/chatApi";
import { Avatar } from "../../components/Avatar";
import type { FileMeta } from "../../types/chat";

// Panel phai cua man hinh chinh (Figma node 111:391, "Thanh menu" 416x1080):
// anh dai dien lon, ten, luoi file media da gui, va nut xoa o duoi cung.
export function ConversationInfo({
  conversationId,
  title,
  peerUserId,
  peerAvatarUpdatedAt,
  dangerLabel,
  onDanger,
}: {
  conversationId: number;
  title: string;
  // Chi co o chat 1-1. Nhom thi khong co "nguoi doi dien" nen hien chu cai
  // dau cua ten nhom.
  peerUserId?: number | null;
  peerAvatarUpdatedAt?: string | null;
  dangerLabel: string;
  onDanger?: () => void;
}) {
  const [media, setMedia] = useState<FileMeta[] | null>(null);

  useEffect(() => {
    let huy = false;
    void chatApi
      .listFiles(conversationId)
      .then((r) => {
        if (huy) return;
        // Chi lay anh/video - "file media" trong ban thiet ke la luoi hinh
        // vuong xem truoc, tai lieu khong co gi de xem truoc ca.
        setMedia(r.data.filter((f) => f.fileType === "image" || f.fileType === "video"));
      })
      .catch(() => {
        if (!huy) setMedia([]);
      });
    return () => {
      huy = true;
    };
  }, [conversationId]);

  async function mo(f: FileMeta) {
    try {
      const { data } = await chatApi.getDownloadUrl(f.id);
      window.open(data.uploadUrl, "_blank", "noopener");
    } catch {
      // Khong mo duoc thi thoi - khong dang chen mot bao loi vao ca panel.
    }
  }

  // Thiet ke ve luoi 3x3 = 9 o. Luon ve du 9 o de khung khong xo lech khi it
  // file; o thua la o giu cho xam nhu trong thiet ke.
  const oTrong = Math.max(0, 9 - (media?.length ?? 0));

  return (
    <div className="cw-info">
      <Avatar userId={peerUserId ?? 0} nickname={title} avatarUpdatedAt={peerAvatarUpdatedAt} size={170} />
      <p className="cw-info-name">{title}</p>

      <p className="cw-info-label">Danh sách file media đã gửi</p>
      <div className="cw-media">
        {media?.slice(0, 9).map((f) => (
          <button key={f.id} className="cw-media-cell" onClick={() => void mo(f)} title={f.fileName ?? "Tệp"}>
            {f.fileType === "image" ? <span aria-hidden="true" /> : <span aria-hidden="true" />}
          </button>
        ))}
        {Array.from({ length: oTrong }, (_, i) => (
          <span key={`trong-${i}`} className="cw-media-cell" aria-hidden="true" />
        ))}
      </div>

      {onDanger && (
        <button className="cw-danger" onClick={onDanger}>
          {dangerLabel}
        </button>
      )}
    </div>
  );
}
