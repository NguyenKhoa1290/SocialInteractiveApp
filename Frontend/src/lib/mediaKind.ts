// Doan loai tin nhan media tu chinh tep, dung chung cho nut gui gop o ca chat
// thuong (ChatRoomPage) lan thao luan cuoc hop (MeetingDiscussion).
//
// Uu tien MIME cua trinh duyet; MIME co the rong (vai dinh dang nhu .mkv,
// .flac tren mot so may khong duoc nhan), luc do doan theo duoi ten. Am thanh o
// he thong nay la loai tin "voice". Tra null neu khong phai media.
const DUOI_ANH = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"];
const DUOI_VIDEO = ["mp4", "webm", "mov", "mkv", "avi", "m4v", "3gp", "3g2", "mpeg", "mpg", "ogv"];
const DUOI_AM_THANH = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba", "amr", "mid", "midi"];

export function doanLoaiMedia(file: File): "image" | "video" | "voice" | null {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "voice";
  const duoi = file.name.toLowerCase().split(".").pop() ?? "";
  if (DUOI_ANH.includes(duoi)) return "image";
  if (DUOI_VIDEO.includes(duoi)) return "video";
  if (DUOI_AM_THANH.includes(duoi)) return "voice";
  return null;
}
