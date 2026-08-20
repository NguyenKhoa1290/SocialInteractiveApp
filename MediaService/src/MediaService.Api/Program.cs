using System.Text;
using MediaService.Api.Data;
using MediaService.Api.Endpoints;
using MediaService.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHttpClient();

builder.Services.AddDbContext<MediaDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("MediaDb")));

builder.Services.AddDbContext<MiniAppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("MiniAppDb")));

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis")
        ?? throw new InvalidOperationException("Thieu ConnectionStrings:Redis")));
builder.Services.AddSingleton<WaitingRoomStore>();

var identityClientOptions = builder.Configuration.GetSection("IdentityClient").Get<IdentityClientOptions>()
    ?? new IdentityClientOptions();
builder.Services.AddSingleton(identityClientOptions);
builder.Services.AddHttpClient<IdentityClient>();

var chatServiceClientOptions = builder.Configuration.GetSection("ChatServiceClient").Get<ChatServiceClientOptions>()
    ?? new ChatServiceClientOptions();
builder.Services.AddSingleton(chatServiceClientOptions);
builder.Services.AddHttpClient<ChatServiceClient>();

// Link moi hop gui cho nguoi khac phai la dia chi TRINH DUYET mo duoc. Mac
// dinh lay origin dau tien trong Cors:AllowedOrigins - theo dinh nghia do
// chinh la noi Frontend chay, nen khong phai khai bao them bien moi truong
// nao khi trien khai. Dat PublicWeb:BaseUrl neu muon ghi de.
var publicWebBaseUrl = builder.Configuration["PublicWeb:BaseUrl"]
    ?? builder.Configuration["Cors:AllowedOrigins:0"]
    ?? "http://localhost:5173";
builder.Services.AddSingleton(new PublicWebOptions { BaseUrl = publicWebBaseUrl.TrimEnd('/') });

var liveKitOptions = builder.Configuration.GetSection("LiveKit").Get<LiveKitOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh LiveKit trong appsettings");
builder.Services.AddSingleton(liveKitOptions);
builder.Services.AddSingleton<LiveKitService>();

// Media Service KHONG dung RabbitMQ nua. Truoc day co
// MeetingInviteNotificationPublisher day su kien "mo phong"/"moi hop" sang
// hai hang doi media.meeting-created + media.meeting-invite, nhung khong
// service nao consume ca - tin nhan chi nam do cho het han. Da bo han vi:
//  - Mo hop trong nhom (mode=in_chat) DA gui mot tin nhan he thong vao dung
//    nhom do (xem MeetingsEndpoints.cs, goi ChatServiceClient) - ca nhom
//    thay ngay, khong can them mot duong thong bao thu hai.
//  - Moi truc tiep (type=direct) chua bao gio duoc Frontend goi toi: giao
//    dien chi tao link moi (type=link) roi cho nguoi dung tu gui link di.
// JWT duoc PHAT HANH boi Identity Service - Media Service chi VALIDATE,
// dung chung SigningKey/Issuer/Audience voi cac service khac.
var jwtSigningKey = builder.Configuration["Jwt:SigningKey"]
    ?? throw new InvalidOperationException("Thieu Jwt:SigningKey trong appsettings");
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "identity-service";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "chat-app";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSigningKey)),
            ValidateLifetime = true,
        };
    });
builder.Services.AddAuthorization();

// CORS cho Frontend - cung mau voi Identity/WorkSpace/Chat Service. Thieu
// sot phat hien khi build Frontend F5: Media Service truoc do KHONG he co
// CORS (chi duoc test bang script server-side nen khong lo ra), Frontend goi
// tu http://localhost:5173 se bi trinh duyet chan o buoc preflight.
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy => policy
        .WithOrigins(corsOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapMeetingsEndpoints();
app.MapInvitesEndpoints();
app.MapParticipantsEndpoints();
app.MapMiniAppEndpoints();
app.MapMiniAppSessionEndpoints();
app.MapInternalEndpoints();
app.MapPresentationEndpoints();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
