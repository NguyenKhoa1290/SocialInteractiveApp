using ChatService.Api.Data;
using ChatService.Api.Endpoints;
using ChatService.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ChatService.Api.Hubs;

// WebSocket realtime cho tin nhan + presence - tu de xuat de hoan thanh
// muc "WebSocket (Signal IR) cho realtime tin nhan/presence" con thieu
// trong tai lieu roadmap muc 6.4 (tai lieu goc khong dac ta chi tiet giao
// thuc). Dung ASP.NET Core SignalR (co san trong shared framework, khong
// can NuGet package rieng) thay vi raw WebSocket vi co san reconnect/group
// broadcast, phu hop quy mo du an.
//
// Client join "group" theo tung conversationId (LAZY - khong tu dong join
// het moi conversation luc ket noi, vi WorkSpace Service chua co endpoint
// "liet ke workspace cua chinh minh" de biet truoc can join group nao).
// Client tu goi JoinConversation(id) khi mo man hinh chat tuong ung.
[Authorize]
public class ChatHub(ChatDbContext db, WorkspaceClient workspaceClient, MediaServiceClient mediaClient, PresenceTracker presence) : Hub
{
    public static string GroupName(long conversationId) => $"conversation-{conversationId}";

    // Group RIENG cho luong thao luan cua tung cuoc hop - KHONG dung chung
    // group voi conversation, vi khach vang lai duoc nghe thao luan nhung
    // TUYET DOI khong duoc nghe len luong chat chinh cua nhom.
    public static string MeetingGroupName(long meetingId) => $"meeting-{meetingId}";

    public override async Task OnConnectedAsync()
    {
        var userId = GetUserId();
        var isFirstConnection = presence.AddConnection(userId, Context.ConnectionId);
        if (isFirstConnection)
            await Clients.Others.SendAsync("UserOnline", userId);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = GetUserId();
        var wentOffline = presence.RemoveConnection(userId, Context.ConnectionId);
        if (wentOffline)
            await Clients.Others.SendAsync("UserOffline", userId);

        await base.OnDisconnectedAsync(exception);
    }

    // Client goi khi mo 1 cuoc tro chuyen - server tu verify quyen thanh
    // vien (tai su dung dung logic voi REST API, khong lam lai) truoc khi
    // cho join group, tranh client tu xung conversationId bat ky de nghe
    // len tin nhan khong thuoc ve minh.
    public async Task JoinConversation(long conversationId)
    {
        var userId = GetUserId();
        var conversation = await db.Conversations.FindAsync(conversationId);
        if (conversation is null)
            return;

        if (!await ConversationEndpoints.IsMemberAsync(conversation, userId, workspaceClient))
            return;

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(conversationId));
    }

    public Task LeaveConversation(long conversationId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(conversationId));

    // Tai su dung DUNG logic phan quyen cua REST API (khong lam lai) - xem
    // MeetingDiscussionEndpoints.CanAccessAsync: thanh vien nhom luon vao
    // duoc, khach vang lai chi khi dang thuc su o trong cuoc hop dang dien ra.
    public async Task JoinMeetingDiscussion(long conversationId, long meetingId)
    {
        var userId = GetUserId();
        var conversation = await db.Conversations.FindAsync(conversationId);
        if (conversation is null)
            return;

        if (!await MeetingDiscussionEndpoints.CanAccessAsync(conversation, meetingId, userId, workspaceClient, mediaClient))
            return;

        await Groups.AddToGroupAsync(Context.ConnectionId, MeetingGroupName(meetingId));
    }

    public Task LeaveMeetingDiscussion(long meetingId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, MeetingGroupName(meetingId));

    public bool IsOnline(long userId) => presence.IsOnline(userId);

    private long GetUserId()
    {
        var sub = Context.User!.FindFirst("sub")!.Value;
        return long.Parse(sub);
    }
}
