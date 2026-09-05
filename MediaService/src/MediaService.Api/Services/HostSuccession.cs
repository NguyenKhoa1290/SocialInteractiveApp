using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Services;

// Chuyen quyen Chu phong khi chu roi di ma phong con nguoi.
//
// GAP DUOC VA: truoc day meetings.host_id la BAT BIEN ca phien (tai lieu muc
// 7.2 ghi dung nhu vay), nen chu roi phong = phong VO CHU. Moi thu di qua
// RequireHostAsync chet theo: khong ai duyet duoc phong cho, khong ai duoi
// duoc nguoi, khong ai ket thuc duoc cuoc hop, khong ai go duoc nguoi trinh
// bay bi ket, khong ai sua duoc cai dat phong. Nang nhat la phong cho - theo
// dac ta thi nguoi vao bang LINK luon phai cho duyet, chu di roi thi ho ket
// VINH VIEN o do. Ma cuoc hop chi tu dong dong khi HET NGUOI (trigger
// trg_close_meeting_if_empty), nen mot phong vo chu con song tiep hang gio.
//
// LUAT DA CHOT, xet theo thu tu:
//
//   1. DONG CHU PHONG dang o trong phong (vao som nhat neu co nhieu nguoi).
//      Day la nguoi chinh chu phong da chi dinh truoc, nen phai duoc uu tien
//      hon moi tieu chi may moc khac.
//   2. Khong co dong chu nao -> nguoi VAO SOM NHAT con o lai, uu tien tai
//      khoan da dang ky; khach vao bang link chi len lam chu khi trong phong
//      khong con ai khac - de mot nguoi la khong bong nhien nam quyen duoi
//      nguoi/ket thuc cuoc hop trong khi thanh vien that van dang ngoi day.
//
// GOI O DAU: moi cho co the lam chu bien mat - POST /leave, kick, va
// ParticipantReconciler (dong tab, duong hay gap nhat). Ham nay TU kiem tra
// "chu con trong phong khong" nen goi thua la vo hai.
//
// KHONG dung cho truong hop chu chi MAT KET NOI: chung nao reconciler chua
// ket luan la ho da di (vang mat qua hai lan quan sat, cach nhau 60 giay) thi
// hang cua ho van left_at = NULL va ham nay khong dong gi. Dung tinh than
// "chu F5 mot cai khong phai la nhuong quyen".
public static class HostSuccession
{
    // Tra ve id chu moi neu vua chuyen, null neu khong can chuyen.
    public static async Task<long?> ChuyenNeuChuDaRoiAsync(
        MediaDbContext db,
        long meetingId,
        IdentityClient identity,
        ILogger logger,
        CancellationToken ct = default)
    {
        // Doc lai tu CSDL chu khong dung ban dang theo doi trong context:
        // trigger trg_close_meeting_if_empty co the vua doi status ngay trong
        // cau SaveChanges truoc do ma EF khong hay biet.
        var phong = await db.Meetings.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == meetingId, ct);
        if (phong is null || phong.Status != MeetingStatus.Active)
            return null;

        var chuCu = phong.HostId;

        var conLai = await db.MeetingParticipants
            .Where(p => p.MeetingId == meetingId && p.LeftAt == null)
            .OrderBy(p => p.JoinedAt)
            .ThenBy(p => p.Id)
            .ToListAsync(ct);

        // Chu van dang ngoi day - khong co gi de lam. Day la duong di thuong
        // xuyen nhat: moi lan BAT KY ai roi phong deu goi vao ham nay.
        if (conLai.Exists(p => p.UserId == chuCu))
            return null;

        // Phong rong: trigger da (hoac sap) ket thuc cuoc hop. Trao quyen cho
        // mot cai phong khong con ai la vo nghia.
        if (conLai.Count == 0)
            return null;

        var chuMoi = await ChonNguoiKeAsync(db, meetingId, conLai, identity, ct);

        // Doi chu bang MOT cau UPDATE co dieu kien host_id = chu cu: hai
        // duong cung phat hien chu da di trong cung mot khoanh khac (vd nguoi
        // A goi /leave dung luc reconciler dang quet) thi chi mot ben doi
        // duoc, ben kia thay 0 dong va di ra. Khong bao gio co canh hai nguoi
        // cung tuong minh la chu.
        var doiDuoc = await db.Meetings
            .Where(m => m.Id == meetingId && m.HostId == chuCu && m.Status == MeetingStatus.Active)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.HostId, chuMoi.UserId), ct);
        if (doiDuoc == 0)
            return null;

        // Cot role chi de hien thi, nhung phai dung: GET /participants doc
        // thang tu no de gan nhan "Chu phong".
        //
        // CO Y khong ha hang cu cua chu cu xuong 'participant'. Hang do (da co
        // left_at) la dau vet "da tung la chu o phien nay", va POST /join dua
        // vao no de chu cu quay lai duoc: phong tuy chinh chi vao duoc bang
        // link moi, ma link thi chinh chu cu thuong khong giu.
        chuMoi.Role = ParticipantRole.Host;

        // Da la chu phong THAT thi hang co_host thanh thua - de lai chi lam
        // giao dien hien mot nguoi vua la chu vua la dong chu.
        var hangDongChu = await db.MeetingPermissions.FirstOrDefaultAsync(
            x => x.MeetingId == meetingId && x.UserId == chuMoi.UserId && x.PermissionType == PermissionType.CoHost, ct);
        if (hangDongChu is not null)
            db.MeetingPermissions.Remove(hangDongChu);

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Cuoc hop {MeetingId}: chu phong {ChuCu} da roi, chuyen quyen cho {ChuMoi}",
            meetingId, chuCu, chuMoi.UserId);
        return chuMoi.UserId;
    }

    // Dong chu phong truoc, roi moi den nguoi vao som nhat (uu tien tai khoan
    // da dang ky).
    //
    // FAIL-OPEN o buoc thu hai: Identity khong tra loi duoc thi
    // ResolveUsersAsync tra ve rong (no tu nuot loi), luc do lay luon nguoi
    // vao som nhat. Mot su co cua Identity khong duoc phep de cuoc hop nam lai
    // trang thai vo chu - do moi la cai dat hon.
    private static async Task<MeetingParticipant> ChonNguoiKeAsync(
        MediaDbContext db, long meetingId, List<MeetingParticipant> conLai,
        IdentityClient identity, CancellationToken ct)
    {
        // Dong chu duoc chi dinh thi khoi phai doan theo thu tu vao phong -
        // ke ca khi nguoi do la khach, vi chinh chu phong da chon ho.
        var dongChu = await db.MeetingPermissions
            .Where(x => x.MeetingId == meetingId && x.PermissionType == PermissionType.CoHost)
            .Select(x => x.UserId)
            .ToListAsync(ct);
        if (dongChu.Count > 0)
        {
            var ke = conLai.Find(p => dongChu.Contains(p.UserId));
            if (ke is not null)
                return ke;
        }

        if (conLai.Count == 1)
            return conLai[0];

        var users = await identity.ResolveUsersAsync(conLai.ConvertAll(p => p.UserId));
        var thanhVien = conLai.Find(p =>
            users.TryGetValue(p.UserId, out var u) &&
            !string.Equals(u.UserType, "guest", StringComparison.OrdinalIgnoreCase));

        return thanhVien ?? conLai[0];
    }
}
