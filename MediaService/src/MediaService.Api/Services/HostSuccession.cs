using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Services;

// Ai dang giu quyen Chu phong - hai chieu.
//
// GAP DUOC VA: truoc day meetings.host_id la BAT BIEN ca phien (tai lieu muc
// 7.2 ghi dung nhu vay), nen chu roi phong = phong VO CHU. Moi thu di qua
// RequireHostAsync chet theo: khong ai duyet duoc phong cho, khong ai duoi
// duoc nguoi, khong ai ket thuc duoc cuoc hop. Nang nhat la phong cho - theo
// dac ta thi nguoi vao bang LINK luon phai cho duyet, chu di roi thi ho ket
// VINH VIEN o do. Ma cuoc hop chi tu dong dong khi HET NGUOI (trigger
// trg_close_meeting_if_empty), nen mot phong vo chu con song tiep hang gio.
//
// CHIEU DI - chu roi ma phong con nguoi, xet theo thu tu:
//
//   1. PHO PHONG dang o trong phong (vao som nhat neu co nhieu nguoi). Day la
//      nguoi chinh chu phong da chi dinh truoc, nen di truoc moi tieu chi may
//      moc khac - ke ca khi ho la khach.
//   2. Khong co pho phong nao -> nguoi VAO SOM NHAT con o lai, uu tien tai
//      khoan da dang ky; khach vao bang link chi len lam chu khi trong phong
//      khong con ai khac.
//
// CHIEU VE - chu THAT (creator_id) quay lai thi doi lai quyen NGAY, nguoi
// dang giu ho tro ve cho cu. Pho phong duoc dua len lam chu tam van giu nguyen
// hang co_host, nen ho tu dong tro lai lam pho phong - khong phai phong lai.
//
// GOI O DAU: moi cho co the lam chu bien mat (POST /leave, kick,
// ParticipantReconciler khi dong tab) va moi cho chu that co the tro lai (hai
// duong join). Ca hai ham deu TU kiem tra dieu kien nen goi thua la vo hai.
//
// KHONG dung cho truong hop chu chi MAT KET NOI: chung nao reconciler chua
// ket luan la ho da di (vang mat qua hai lan quan sat, cach nhau 60 giay) thi
// hang cua ho van left_at = NULL va khong ai dong gi. Dung tinh than "chu F5
// mot cai khong phai la nhuong quyen".
public static class HostSuccession
{
    // Chu da roi ma phong con nguoi -> trao quyen. Tra ve id chu moi, hoac
    // null neu khong can lam gi.
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
        if (!await DoiChuAsync(db, meetingId, chuCu, chuMoi.UserId, ct))
            return null;

        logger.LogInformation(
            "Cuoc hop {MeetingId}: chu phong {ChuCu} da roi, chuyen quyen cho {ChuMoi}",
            meetingId, chuCu, chuMoi.UserId);
        return chuMoi.UserId;
    }

    // Chu THAT quay lai -> doi lai quyen ngay. Tra ve true neu vua doi.
    //
    // Goi tu ca hai duong join, SAU khi da chac chan nguoi nay vao duoc phong.
    public static async Task<bool> ChuThatQuayLaiAsync(
        MediaDbContext db, Meeting phong, long callerId, ILogger logger, CancellationToken ct = default)
    {
        if (phong.CreatorId != callerId || phong.HostId == callerId)
            return false;
        if (phong.Status != MeetingStatus.Active)
            return false;

        var nguoiGiuHo = phong.HostId;
        if (!await DoiChuAsync(db, phong.Id, nguoiGiuHo, callerId, ct))
            return false;

        // Ban dang theo doi cua noi goi phai khop, khong thi cau tra loi cua
        // chinh request nay van mang host_id cu.
        phong.HostId = callerId;

        logger.LogInformation(
            "Cuoc hop {MeetingId}: chu phong that {Chu} da quay lai, lay lai quyen tu {NguoiGiuHo}",
            phong.Id, callerId, nguoiGiuHo);
        return true;
    }

    // Doi host_id + sua lai cot role cho khop. Tra ve false neu nguoi khac da
    // doi truoc.
    private static async Task<bool> DoiChuAsync(
        MediaDbContext db, long meetingId, long chuCu, long chuMoi, CancellationToken ct)
    {
        // MOT cau UPDATE co dieu kien host_id = chu cu: hai duong cung phat
        // hien mot luc (vd nguoi A goi /leave dung luc reconciler dang quet)
        // thi chi mot ben doi duoc, ben kia thay 0 dong va di ra. Khong bao
        // gio co canh hai nguoi cung tuong minh la chu.
        var doiDuoc = await db.Meetings
            .Where(m => m.Id == meetingId && m.HostId == chuCu && m.Status == MeetingStatus.Active)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.HostId, chuMoi), ct);
        if (doiDuoc == 0)
            return false;

        // Cot role chi la nhan hien thi, nhung phai dung: GET /participants
        // doc thang tu no. Ha nguoi giu ho xuong va nang nguoi moi len.
        //
        // CO Y khong dong toi hang co_host: mot pho phong duoc dua len lam chu
        // tam van GIU nguyen chuc pho, nen khi chu that quay lai la ho tu dong
        // tro ve lam pho - chu phong khong phai phong lai tu dau. Cho nao hien
        // thi thi da uu tien "Chu phong" truoc "Pho nhom" roi.
        var hang = await db.MeetingParticipants
            .Where(p => p.MeetingId == meetingId && (p.UserId == chuCu || p.UserId == chuMoi))
            .ToListAsync(ct);
        foreach (var p in hang)
            p.Role = p.UserId == chuMoi ? ParticipantRole.Host : ParticipantRole.Participant;

        await db.SaveChangesAsync(ct);
        return true;
    }

    // Pho phong truoc, roi moi den nguoi vao som nhat (uu tien tai khoan da
    // dang ky).
    //
    // FAIL-OPEN o buoc thu hai: Identity khong tra loi duoc thi
    // ResolveUsersAsync tra ve rong (no tu nuot loi), luc do lay luon nguoi
    // vao som nhat. Mot su co cua Identity khong duoc phep de cuoc hop nam lai
    // trang thai vo chu - do moi la cai dat hon.
    private static async Task<MeetingParticipant> ChonNguoiKeAsync(
        MediaDbContext db, long meetingId, List<MeetingParticipant> conLai,
        IdentityClient identity, CancellationToken ct)
    {
        // Pho phong duoc chi dinh thi khoi phai doan theo thu tu vao phong -
        // ke ca khi nguoi do la khach, vi chinh chu phong da chon ho.
        var pho = await db.MeetingPermissions
            .Where(x => x.MeetingId == meetingId && x.PermissionType == PermissionType.CoHost)
            .Select(x => x.UserId)
            .ToListAsync(ct);
        if (pho.Count > 0)
        {
            var ke = conLai.Find(p => pho.Contains(p.UserId));
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
