using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Services;

// Ai dang giu quyen Chu phong - hai chieu.
//
// CHIEU DI - chu roi ma phong con nguoi: chi PHO PHONG dang o trong phong moi
// duoc len (vao som nhat neu co nhieu nguoi), ke ca khi ho la khach.
//
// KHONG CO PHO PHONG THI PHONG CU VO CHU, CO Y NHU VAY. He thong khong tu
// chon nguoi ke: chon ai lam chu la quyet dinh THAY MAT nguoi khac, ma may
// khong co can cu nao de chon dung. "Nguoi vao som nhat" chi la mot con so,
// khong noi len rang nguoi do dang duoc tin tuong; trao quyen duoi/duyet/ket
// thuc cho mot nguoi la xong thi khong rut lai duoc. Muon phong khong bao gio
// vo chu thi chu phong phong pho truoc - do la ca muc dich cua nut Pho nhom.
//
// Cai gia phai tra, ghi ra day cho ro: phong vo chu thi moi thu di qua
// RequireHostAsync dung lai - khong ai duyet duoc phong cho, khong ai duoi
// duoc nguoi, khong ai ket thuc duoc cuoc hop. Nang nhat la phong cho: nguoi
// vao bang LINK luon phai cho duyet nen ho ket lai o do cho toi khi chu that
// (hoac mot pho phong) quay lai. Cuoc hop van tu dong dong khi HET NGUOI
// (trigger trg_close_meeting_if_empty), nen khong co phong nao song mai.
// Frontend bao thang trang thai nay ra man hinh chu khong de nguoi ta cho mo.
//
// CHIEU VE - chu THAT (creator_id) quay lai thi doi lai quyen NGAY, ke ca khi
// phong dang vo chu; neu mot pho phong dang giu ho thi ho tro ve cho cu. Pho
// phong duoc dua len lam chu tam van giu nguyen hang co_host, nen ho tu dong
// tro lai lam pho phong - chu phong khong phai phong lai tu dau.
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

        var chuMoi = await ChonPhoPhongAsync(db, meetingId, conLai, ct);
        if (chuMoi is null)
        {
            logger.LogInformation(
                "Cuoc hop {MeetingId}: chu phong {ChuCu} da roi, khong co pho phong nao o lai - phong tam VO CHU",
                meetingId, chuCu);
            return null;
        }

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

    // Pho phong dang con o trong phong, vao som nhat neu co nhieu nguoi.
    // Tra ve null = khong co ai du tu cach ke -> phong vo chu (xem dau file).
    //
    // conLai da sap xep theo JoinedAt roi, nen Find lay dung nguoi vao som
    // nhat. Khach van duoc len: chinh chu phong da chon ho, khong phai may
    // doan.
    private static async Task<MeetingParticipant?> ChonPhoPhongAsync(
        MediaDbContext db, long meetingId, List<MeetingParticipant> conLai, CancellationToken ct)
    {
        var pho = await db.MeetingPermissions
            .Where(x => x.MeetingId == meetingId && x.PermissionType == PermissionType.CoHost)
            .Select(x => x.UserId)
            .ToListAsync(ct);

        return pho.Count == 0 ? null : conLai.Find(p => pho.Contains(p.UserId));
    }
}
