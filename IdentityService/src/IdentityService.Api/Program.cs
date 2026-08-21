using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using IdentityService.Api.BackgroundServices;
using IdentityService.Api.Data;
using IdentityService.Api.Endpoints;
using IdentityService.Api.Hubs;
using IdentityService.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHttpClient();
// Kenh day thong bao xuong tung nguoi - xem Hubs/NotificationHub.cs.
builder.Services.AddSignalR();

builder.Services.AddDbContext<IdentityDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("IdentityDb")));

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis")
        ?? throw new InvalidOperationException("Thieu ConnectionStrings:Redis")));
builder.Services.AddSingleton<RedisAuthStore>();

var smtpOptions = builder.Configuration.GetSection("Smtp").Get<SmtpOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Smtp trong appsettings");
builder.Services.AddSingleton(smtpOptions);
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<IOAuthVerifier, OAuthVerifier>();

var kafkaOptions = builder.Configuration.GetSection("Kafka").Get<KafkaOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Kafka trong appsettings");
builder.Services.AddSingleton(kafkaOptions);
builder.Services.AddSingleton<KafkaProducerService>();
builder.Services.AddHostedService<KafkaTopicInitializer>();
builder.Services.AddSingleton(sp => new ErrorLogPublisher(kafkaOptions, sp.GetRequiredService<ILogger<ErrorLogPublisher>>(), "identity-service"));

var guestCleanupOptions = builder.Configuration.GetSection("GuestCleanup").Get<GuestCleanupOptions>()
    ?? new GuestCleanupOptions();
builder.Services.AddSingleton(guestCleanupOptions);
builder.Services.AddHostedService<GuestCleanupService>();

// Bang notifications la bang duy nhat chi co duong ghi vao ma khong co duong
// xoa ra - xem ghi chu day du o NotificationCleanupService.cs.
var notificationCleanupOptions = builder.Configuration.GetSection("NotificationCleanup").Get<NotificationCleanupOptions>()
    ?? new NotificationCleanupOptions();
builder.Services.AddSingleton(notificationCleanupOptions);
builder.Services.AddHostedService<NotificationCleanupService>();

var rabbitMqOptions = builder.Configuration.GetSection("RabbitMq").Get<RabbitMqOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh RabbitMq trong appsettings");
builder.Services.AddSingleton(rabbitMqOptions);
builder.Services.AddHostedService<AccountLockedConsumerService>();
// Identity Service la dau moi notification cua toan he thong (roadmap muc 1
// va bang Publisher -> Consumer muc 8.1): consume moi hang doi thong bao roi
// day tiep qua WebSocket.
builder.Services.AddScoped<NotificationService>();
builder.Services.AddHostedService<NotificationConsumerService>();

var jwtOptions = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Jwt trong appsettings");
builder.Services.AddSingleton(jwtOptions);
builder.Services.AddSingleton<JwtTokenService>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Giu nguyen ten claim goc ("sub", khong bi remap thanh URI dai kieu
        // ClaimTypes.NameIdentifier) - endpoint doc claim bang principal.FindFirstValue("sub").
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey)),
            ValidateLifetime = true,
        };
        options.Events = new JwtBearerEvents
        {
            // Trinh duyet KHONG gui duoc header Authorization trong bat tay
            // WebSocket (gioi han cua chuan WebSocket), nen SignalR JS client
            // dinh token vao query string - cung cach Chat Service dang lam.
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs/notifications"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            },

            // Chan token da logout (nam trong blocklist Redis) - JWT von la
            // stateless nen phai check them lop nay moi request.
            OnTokenValidated = async ctx =>
            {
                var jti = ctx.Principal?.FindFirstValue(JwtRegisteredClaimNames.Jti);
                if (jti is null) return;

                var store = ctx.HttpContext.RequestServices.GetRequiredService<RedisAuthStore>();
                if (await store.IsBlocklistedAsync(jti))
                    ctx.Fail("Token da bi thu hoi (logout)");
            }
        };
    });
builder.Services.AddAuthorization();

// CORS cho Frontend (tu de xuat, thieu sot phat hien khi test dang nhap
// Guest tu Frontend chay o origin khac - localhost:5173 vs localhost:5194).
// Chi allow origin cu the (khong dung AllowAnyOrigin) - token nam trong
// header Authorization tu goi bang JS, khong phai cookie, nen khong can
// AllowCredentials.
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy => policy
        .WithOrigins(corsOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Kafka Error Log (tu de xuat, tai lieu roadmap muc 8.1) - publish moi
// unhandled exception, KHONG nuot loi (van throw tiep de middleware xu ly
// loi mac dinh cua ASP.NET Core tra ve 500 nhu binh thuong).
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

app.MapAuthEndpoints();
app.MapUsersEndpoints();
app.MapInternalEndpoints();
app.MapFriendsEndpoints();
app.MapNotificationsEndpoints();
app.MapHub<NotificationHub>("/hubs/notifications");

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
