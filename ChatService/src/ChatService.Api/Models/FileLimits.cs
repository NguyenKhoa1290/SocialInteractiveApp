namespace ChatService.Api.Models;

// Tran kich thuoc cho TUNG tep - NGUON SU THAT DUY NHAT.
//
// Truoc day hai con so nay nam o hai noi: FileEndpoints khong co, con
// ConversationEndpoints tu giu mot ban rieng (VideoMaxBytes/VoiceMaxBytes) va
// kiem o buoc gan tep vao tin nhan. Gom ve day de khong bao gio lech nhau -
// hai ban sao cua cung mot luat thi som muon cung co mot ban bi sua quen.
//
// KIEM O HAI CHO, CO Y:
//
//   1. POST /files/upload-url - som nhat co the. Quan trong hon ve chi phi:
//      hang `files` duoc tao va storage_used_bytes bi tru NGAY o buoc nay
//      (xem AbandonedUploadCleanupService), va client bat dau day byte len
//      MinIO ngay sau do. Chan o buoc gan tin nhan thi da muon - byte da nam
//      tren dia va han muc da bi tru roi.
//   2. POST /conversations/{id}/messages - giu lai lam lop hai, cho nhung
//      hang `files` tao ra TRUOC khi co lop mot.
//
// ANH: dac ta khong cho con so rieng cho anh, va truoc day khong cho nao kiem
// ca - o buoc gan tin nhan cung chi kiem Video/Voice. Dung chung nguong voi
// video (50MB) chu khong bia mot con so moi: lay muc DA duoc duyet thi de bao
// ve hon, va no rong rai cho ca anh may dien thoai lan anh chup man hinh dai.
// Khong dat tran cho anh thi hai tran kia thanh vo nghia - chi viec khai
// fileType='image' la di qua het.
//
// TAI LIEU (FileType.File): khong co tran rieng, han muc nhom la tran cua no
// (UC-27). Chat 1-1 thi khong nhan tai lieu, chan o cho khac.
public static class FileLimits
{
    public const long VideoMaxBytes = 50L * 1024 * 1024;
    public const long VoiceMaxBytes = 25L * 1024 * 1024;
    public const long ImageMaxBytes = 50L * 1024 * 1024;

    // Doi byte sang chuoi nguoi doc duoc. O day chu khong o rieng
    // FileEndpoints: hai noi cung bao "vuot tran" thi phai bao giong het nhau.
    public static string DoiSangChuoi(long bytes) =>
        bytes >= 1024L * 1024 * 1024 ? $"{bytes / 1024.0 / 1024 / 1024:0.##} GB"
        : bytes >= 1024L * 1024 ? $"{bytes / 1024.0 / 1024:0.#} MB"
        : bytes >= 1024 ? $"{bytes / 1024.0:0} KB"
        : $"{bytes} B";

    // Tra ve null neu loai nay khong co tran rieng.
    public static (long Tran, string Ten)? ChoLoai(FileType loai) => loai switch
    {
        FileType.Video => (VideoMaxBytes, "Video"),
        FileType.Voice => (VoiceMaxBytes, "Tệp âm thanh"),
        FileType.Image => (ImageMaxBytes, "Ảnh"),
        _ => null,
    };
}
