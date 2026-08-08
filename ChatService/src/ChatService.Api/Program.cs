using System.Text;
using ChatService.Api.BackgroundServices;
using ChatService.Api.Data;
using ChatService.Api.Endpoints;
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

var kafkaOptions = builder.Configuration.GetSection("Kafka").Get<KafkaOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Kafka trong appsettings");
builder.Services.AddSingleton(kafkaOptions);
builder.Services.AddSingleton<KafkaProducerService>();

var minioOptions = builder.Configuration.GetSection("Minio").Get<MinioOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Minio trong appsettings");
builder.Services.AddSingleton(minioOptions);
builder.Services.AddSingleton<MinioStorageService>();

var workspaceClientOptions = builder.Configuration.GetSection("WorkspaceClient").Get<WorkspaceClientOptions>()
    ?? new WorkspaceClientOptions();
builder.Services.AddSingleton(workspaceClientOptions);
builder.Services.AddHttpClient<WorkspaceClient>();

var rabbitMqOptions = builder.Configuration.GetSection("RabbitMq").Get<RabbitMqOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh RabbitMq trong appsettings");
builder.Services.AddSingleton(rabbitMqOptions);
builder.Services.AddSingleton<StorageWarningPublisher>();

var storageWarningOptions = builder.Configuration.GetSection("StorageWarning").Get<StorageWarningOptions>()
    ?? new StorageWarningOptions();
builder.Services.AddSingleton(storageWarningOptions);
builder.Services.AddHostedService<StorageWarningService>();

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
    });
builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapConversationEndpoints();
app.MapFileEndpoints();
app.MapInternalEndpoints();
app.MapComplaintsEndpoints();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
