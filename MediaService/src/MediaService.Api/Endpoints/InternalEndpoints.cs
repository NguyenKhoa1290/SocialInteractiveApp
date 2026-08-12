using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// KHONG di qua API Gateway public - dung boi Chat Service (xem
// ChatService/Services/MediaServiceClient.cs).
public static class InternalEndpoints
{
    public static void MapInternalEndpoints(this WebApplication app)
    {
        // Chat Service hoi "nguoi nay co dang o trong cuoc hop do khong" de
        // quyet dinh cho vao luong THAO LUAN cua cuoc hop hay khong.
        //
        // Can thiet vi khach vang lai (vao bang link, khong co tai khoan,
        // KHONG thuoc workspace) van duoc nhan tin trong thao luan - kiem
        // tra thanh vien workspace san co cua Chat Service khong phu duoc
        // truong hop nay.
        //
        // Tra kem conversationId de Chat Service doi chieu cuoc hop co thuc
        // su thuoc dung hoi thoai dang mo hay khong (chan viec muon
        // meetingId cua mot cuoc hop khac de chen tin vao hoi thoai la).
        app.MapGet("/internal/meetings/{meetingId:long}/membership/{userId:long}", async (
            long meetingId, long userId, MediaDbContext db) =>
        {
            var meeting = await db.Meetings.FindAsync(meetingId);
            if (meeting is null)
                return Results.NotFound();

            // Host luon duoc tinh la nguoi trong phong, ke ca khi ho da roi
            // phong (vd dong tab) - ho van la chu cuoc hop.
            var isParticipant = meeting.HostId == userId || await db.MeetingParticipants
                .AnyAsync(p => p.MeetingId == meetingId && p.UserId == userId && p.LeftAt == null);

            return Results.Ok(new MeetingMembershipResponse(
                isParticipant,
                meeting.ConversationId,
                meeting.Status == MeetingStatus.Active ? "active" : "ended"));
        });
    }
}

public record MeetingMembershipResponse(bool IsParticipant, long? ConversationId, string Status);
