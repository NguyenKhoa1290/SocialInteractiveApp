using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Services;

// Dong chu phong ("pho phong") - nguoi DIEU PHOI, khong phai chu phong thu hai.
//
// VI SAO CO: chu roi phong thi HostSuccession trao quyen cho nguoi vao som
// nhat con o lai - dung de phong khong bao gio vo chu, nhung nguoi duoc trao
// la ai thi hoan toan do thu tu vao phong quyet dinh. Dong chu la duong de chu
// phong NOI TRUOC ai se thay minh, va de bot viec truc phong cho khi chinh chu
// phong dang ban trinh bay.
//
// DONG CHU LAM DUOC DUNG BA VIEC:
//
//   1. Duyet / tu choi nguoi o phong cho.
//   2. Tat mic ca phong (mot lan, moi nguoi bat lai duoc).
//   3. Tat camera ca phong (mot lan).
//
// va la NGUOI KE VI THU NHAT khi chu phong roi di (xem HostSuccession).
//
// NGOAI RA KHONG GI KHAC - day la ranh gioi co y, khong phai thieu sot:
//
//   - KHONG ket thuc duoc cuoc hop. Chung nao chu phong con day thi chi ho
//     dong duoc phong; ma khi chu phong roi that thi dong chu duoc dua len
//     lam chu, luc do bam duoc. Khong can duong tat nao o giua.
//   - KHONG cam duoc ai (no_mic / no_camera / no_screen_share). "Tat" khac
//     "cam": tat la mot lan, cam la thu quyen - thu quyen la viec cua chu phong.
//   - KHONG duoi nguoi, KHONG sua cai dat phong, KHONG phong dong chu khac,
//     KHONG dung trinh bay cua nguoi khac.
//   - KHONG duoc mien tru cai dat chung cua phong: allow_mic = false thi dong
//     chu cung khong bat duoc mic, y het moi nguoi.
public static class HostAuthorization
{
    public static async Task<bool> LaDongChuAsync(
        MediaDbContext db, long meetingId, long userId, CancellationToken ct = default) =>
        await db.MeetingPermissions.AnyAsync(
            p => p.MeetingId == meetingId && p.UserId == userId && p.PermissionType == PermissionType.CoHost, ct);

    // Chu phong that thi khoi hoi CSDL.
    public static async Task<bool> DieuKhienDuocAsync(
        MediaDbContext db, Meeting meeting, long userId, CancellationToken ct = default) =>
        meeting.HostId == userId || await LaDongChuAsync(db, meeting.Id, userId, ct);
}
