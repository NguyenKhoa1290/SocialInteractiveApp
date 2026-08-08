using System.Text;
using AdminService.Api.Endpoints;
using AdminService.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHttpClient();

var identityClientOptions = builder.Configuration.GetSection("IdentityClient").Get<IdentityClientOptions>()
    ?? new IdentityClientOptions();
builder.Services.AddSingleton(identityClientOptions);
builder.Services.AddHttpClient<IdentityClient>();

var spamTrackingClientOptions = builder.Configuration.GetSection("SpamTrackingClient").Get<SpamTrackingClientOptions>()
    ?? new SpamTrackingClientOptions();
builder.Services.AddSingleton(spamTrackingClientOptions);
builder.Services.AddHttpClient<SpamTrackingClient>();

var chatServiceClientOptions = builder.Configuration.GetSection("ChatServiceClient").Get<ChatServiceClientOptions>()
    ?? new ChatServiceClientOptions();
builder.Services.AddSingleton(chatServiceClientOptions);
builder.Services.AddHttpClient<ChatServiceClient>();

var rabbitMqOptions = builder.Configuration.GetSection("RabbitMq").Get<RabbitMqOptions>()
    ?? throw new InvalidOperationException("Thieu cau hinh RabbitMq trong appsettings");
builder.Services.AddSingleton(rabbitMqOptions);
builder.Services.AddSingleton<RabbitMqPublisher>();

var k8sOptions = builder.Configuration.GetSection("K8s").Get<K8sOptions>() ?? new K8sOptions();
builder.Services.AddSingleton(k8sOptions);
builder.Services.AddSingleton<K8sResourceService>();

// JWT duoc PHAT HANH boi Identity Service - Admin Service chi VALIDATE, dung
// chung SigningKey/Issuer/Audience. Ngoai ra bat buoc claim "role"=="admin"
// (chi duoc gan khi User.IsAdmin=true, xem JwtTokenService.cs ben Identity)
// - day la co che tu thiet ke vi tai lieu goc khong mo ta luong dang ky/gan
// quyen Admin.
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
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireClaim("role", "admin"));
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapUsersEndpoints();
app.MapComplaintsAdminEndpoints();
app.MapInfrastructureEndpoints();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
