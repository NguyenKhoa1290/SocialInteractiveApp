using Microsoft.EntityFrameworkCore;
using SpamTrackingService.Api.BackgroundServices;
using SpamTrackingService.Api.Data;
using SpamTrackingService.Api.Endpoints;
using SpamTrackingService.Api.Services;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHttpClient();

builder.Services.AddDbContext<SpamTrackingDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("SpamTrackingDb")));

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis")
        ?? throw new InvalidOperationException("Thieu ConnectionStrings:Redis")));

var spamDetectionOptions = builder.Configuration.GetSection("SpamDetection").Get<SpamDetectionOptions>()
    ?? new SpamDetectionOptions();
builder.Services.AddSingleton(spamDetectionOptions);
builder.Services.AddSingleton<SpamDetector>();

var identityClientOptions = builder.Configuration.GetSection("IdentityClient").Get<IdentityClientOptions>()
    ?? new IdentityClientOptions();
builder.Services.AddSingleton(identityClientOptions);
builder.Services.AddHttpClient<IdentityClient>();

var rabbitMqOptions = builder.Configuration.GetSection("RabbitMq").Get<RabbitMqOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh RabbitMq trong appsettings");
builder.Services.AddSingleton(rabbitMqOptions);
builder.Services.AddSingleton<RabbitMqPublisher>();

var kafkaOptions = builder.Configuration.GetSection("Kafka").Get<KafkaOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh Kafka trong appsettings");
builder.Services.AddSingleton(kafkaOptions);
builder.Services.AddHostedService<ChatLogConsumerService>();

builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapViolationEndpoints();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
