using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Services;

// "Ai duoc dieu khien cuoc hop nay" - chu phong THAT, hoac dong chu phong.
//
// VI SAO CO DONG CHU PHONG: chu roi phong thi HostSuccession trao quyen cho
// nguoi vao som nhat con o lai - dung de phong khong bao gio vo chu, nhung
// nguoi duoc trao la ai thi hoan toan do thu tu vao phong quyet dinh. Dong chu
// phong la duong de chu phong NOI TRUOC ai se thay minh, va cung la de co hai
// nguoi cung cam trich trong luc hop (duyet phong cho, duoi nguoi) thay vi don
// het vao mot nguoi.
//
// RANH GIOI: dong chu co du quyen dieu khien cuoc hop, nhung chu phong THAT
// giu rieng ba dieu, va ca ba deu la de khong ai lat duoc chu phong:
//
//   1. Chi chu phong phong/thu duoc chinh quyen dong chu (POST/DELETE
//      permissions voi co_host).
//   2. Khong ai duoi duoc chu phong.
//   3. Khong ai thu duoc mic/camera/chia se man hinh cua chu phong (luat cu,
//      da co tu truoc).
public static class HostAuthorization
{
    public static async Task<bool> LaDongChuAsync(
        MediaDbContext db, long meetingId, long userId, CancellationToken ct = default) =>
        await db.MeetingPermissions.AnyAsync(
            p => p.MeetingId == meetingId && p.UserId == userId && p.PermissionType == PermissionType.CoHost, ct);

    // Chu phong that thi khoi hoi CSDL - duong nay chay o moi thao tac quan
    // tri nen bot duoc mot cau truy van la bot that.
    public static async Task<bool> DieuKhienDuocAsync(
        MediaDbContext db, Meeting meeting, long userId, CancellationToken ct = default) =>
        meeting.HostId == userId || await LaDongChuAsync(db, meeting.Id, userId, ct);
}
