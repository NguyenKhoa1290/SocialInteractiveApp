using System.Text;
using ChatService.Api.BackgroundServices;
using ChatService.Api.Data;
using ChatService.Api.Endpoints;
using ChatService.Api.Hubs;
using ChatService.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHttpClient();

builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("ChatDb")));

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis")
        ?? throw new InvalidOperationException("Thieu ConnectionStrings:Redis")));
builder.Services.AddSingleton<ComplaintStore>();
builder.Services.AddSingleton<ChatCacheService>();

builder.Services.AddSignalR();
builder.Services.AddSingleton<PresenceTracker>();

var kafkaOptions = builder.Configuration.GetSection("Kafka").Get<KafkaOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Kafka trong appsettings");
builder.Services.AddSingleton(kafkaOptions);
builder.Services.AddSingleton<KafkaProducerService>();
builder.Services.AddSingleton(sp => new ErrorLogPublisher(kafkaOptions, sp.GetRequiredService<ILogger<ErrorLogPublisher>>(), "chat-service"));

var writeChatConsumerOptions = builder.Configuration.GetSection("WriteChatConsumer").Get<WriteChatConsumerOptions>()
    ?? new WriteChatConsumerOptions();
builder.Services.AddSingleton(writeChatConsumerOptions);
builder.Services.AddHostedService<WriteChatConsumerService>();

var minioOptions = builder.Configuration.GetSection("Minio").Get<MinioOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Minio trong appsettings");
builder.Services.AddSingleton(minioOptions);
builder.Services.AddSingleton<MinioStorageService>();

var workspaceClientOptions = builder.Configuration.GetSection("WorkspaceClient").Get<WorkspaceClientOptions>()
    ?? new WorkspaceClientOptions();
builder.Services.AddSingleton(workspaceClientOptions);
builder.Services.AddHttpClient<WorkspaceClient>();

// Chi dung cho luong thao luan cua cuoc hop - xem MediaServiceClient.cs.
var mediaServiceClientOptions = builder.Configuration.GetSection("MediaServiceClient").Get<MediaServiceClientOptions>()
    ?? new MediaServiceClientOptions();
builder.Services.AddSingleton(mediaServiceClientOptions);
builder.Services.AddHttpClient<MediaServiceClient>();

// Chi dung de lay ten nguoi gui trong thao luan cuoc hop (khach vang lai
// khong thuoc workspace) - xem IdentityClient.cs.
var identityClientOptions = builder.Configuration.GetSection("IdentityClient").Get<IdentityClientOptions>()
    ?? new IdentityClientOptions();
builder.Services.AddSingleton(identityClientOptions);
builder.Services.AddHttpClient<IdentityClient>();

var rabbitMqOptions = builder.Configuration.GetSection("RabbitMq").Get<RabbitMqOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh RabbitMq trong appsettings");
builder.Services.AddSingleton(rabbitMqOptions);
builder.Services.AddSingleton<StorageWarningPublisher>();
builder.Services.AddSingleton<ChatMessageNotificationPublisher>();

var storageWarningOptions = builder.Configuration.GetSection("StorageWarning").Get<StorageWarningOptions>()
    ?? new StorageWarningOptions();
builder.Services.AddSingleton(storageWarningOptions);
builder.Services.AddHostedService<StorageWarningService>();

var p2pCleanupOptions = builder.Configuration.GetSection("P2PCleanup").Get<P2PCleanupOptions>()
    ?? new P2PCleanupOptions();
builder.Services.AddSingleton(p2pCleanupOptions);
builder.Services.AddHostedService<P2PCleanupService>();

// JWT duoc PHAT HANH boi Identity Service - Chat Service chi VALIDATE, phai
// dung chung SigningKey/Issuer/Audience voi Identity Service.
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

        // SignalR: trinh duyet WebSocket khong gui duoc Authorization header
        // luc handshake - JWT client SDK tu dong gui qua query string
        // ?access_token=..., can doc lai tu day CHI cho duong dan cua hub.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/chat"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

// CORS cho Frontend - cung mau voi Identity/WorkSpace Service (F2 goi truc
// tiep Chat Service tu origin khac).
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy => policy
        .WithOrigins(corsOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()); // SignalR negotiate can gui credentials qua XHR
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Kafka Error Log (tu de xuat, tai lieu roadmap muc 8.1)
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        await context.RequestServices.GetRequiredService<ErrorLogPublisher>().PublishAsync(ex, context.Request.Path);
        throw;
    }
});

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapConversationEndpoints();
app.MapMeetingDiscussionEndpoints();
app.MapFileEndpoints();
app.MapInternalEndpoints();
app.MapComplaintsEndpoints();
app.MapKeysEndpoints();
app.MapHub<ChatHub>("/hubs/chat");

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
