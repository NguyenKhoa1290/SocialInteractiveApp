using MediaService.Api.Data;
using MediaService.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace MediaService.Api.Endpoints;

// UC-37 (Phase 6, Mini App IPTV). Danh sach kenh la CUA RIENG tung user
// (khong gan voi 1 cuoc hop cu the) - user tu quan ly truoc, khi vao hop
// thi chon 1 kenh de xem (xem MiniAppSessionEndpoints.cs cho phan gan voi
// 1 phien hop cu the).
public static class MiniAppEndpoints
{
    public static void MapMiniAppEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/miniapps/iptv").RequireAuthorization();

        group.MapGet("/channel-lists", async (System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            var userId = principal.GetUserId()!.Value;
            var lists = await db.IptvChannelLists.Where(l => l.UserId == userId).ToListAsync();
            return Results.Ok(lists.Select(IptvChannelListResponse.FromEntity));
        });

        group.MapPost("/channel-lists", async (CreateChannelListRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.BadRequest(new ErrorResponse("invalid_request", "name khong duoc trong"));

            var userId = principal.GetUserId()!.Value;
            var list = new IptvChannelList { UserId = userId, Name = req.Name, CreatedAt = DateTimeOffset.UtcNow };
            db.IptvChannelLists.Add(list);
            await db.SaveChangesAsync();

            return Results.Created($"/miniapps/iptv/channel-lists/{list.Id}", IptvChannelListResponse.FromEntity(list));
        });

        group.MapPost("/channel-lists/{listId:long}/groups", async (
            long listId, CreateChannelGroupRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.GroupName))
                return Results.BadRequest(new ErrorResponse("invalid_request", "groupName khong duoc trong"));

            var userId = principal.GetUserId()!.Value;
            var list = await db.IptvChannelLists.FindAsync(listId);
            if (list is null || list.UserId != userId)
                return Results.NotFound();

            var channelGroup = new IptvChannelGroup { ListId = listId, GroupName = req.GroupName };
            db.IptvChannelGroups.Add(channelGroup);
            await db.SaveChangesAsync();

            return Results.Created($"/miniapps/iptv/channel-lists/{listId}/groups/{channelGroup.Id}", null);
        });

        group.MapPost("/channel-lists/{listId:long}/groups/{groupId:long}/channels", async (
            long listId, long groupId, CreateChannelRequest req, System.Security.Claims.ClaimsPrincipal principal, MiniAppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.ChannelName) || string.IsNullOrWhiteSpace(req.StreamUrl))
                return Results.BadRequest(new ErrorResponse("invalid_request", "channelName va streamUrl khong duoc trong"));

            var userId = principal.GetUserId()!.Value;
            var list = await db.IptvChannelLists.FindAsync(listId);
            if (list is null || list.UserId != userId)
                return Results.NotFound();

            var channelGroup = await db.IptvChannelGroups.FirstOrDefaultAsync(g => g.Id == groupId && g.ListId == listId);
            if (channelGroup is null)
                return Results.NotFound();

            var channel = new IptvChannel
            {
                GroupId = groupId,
                ChannelName = req.ChannelName,
                StreamUrl = req.StreamUrl,
                AudioTrack = req.AudioTrack,
            };
            db.IptvChannels.Add(channel);
            await db.SaveChangesAsync();

            return Results.Created($"/miniapps/iptv/channel-lists/{listId}/groups/{groupId}/channels/{channel.Id}", null);
        });
    }
}
