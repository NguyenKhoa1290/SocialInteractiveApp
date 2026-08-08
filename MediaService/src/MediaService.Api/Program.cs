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

var liveKitOptions = builder.Configuration.GetSection("LiveKit").Get<LiveKitOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh LiveKit trong appsettings");
builder.Services.AddSingleton(liveKitOptions);
builder.Services.AddSingleton<LiveKitService>();

var rabbitMqOptions = builder.Configuration.GetSection("RabbitMq").Get<RabbitMqOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh RabbitMq trong appsettings");
builder.Services.AddSingleton(rabbitMqOptions);
builder.Services.AddSingleton<MeetingInviteNotificationPublisher>();

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

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapMeetingsEndpoints();
app.MapInvitesEndpoints();
app.MapParticipantsEndpoints();
app.MapMiniAppEndpoints();
app.MapMiniAppSessionEndpoints();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
