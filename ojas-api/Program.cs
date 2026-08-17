using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using OjasApi.Data;
using OjasApi.Models;
using OjasApi.Services;

var builder = WebApplication.CreateBuilder(args);

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be set and at least 32 characters.");

var jwtIssuer = builder.Configuration["Jwt:Issuer"];
if (string.IsNullOrWhiteSpace(jwtIssuer))
    throw new InvalidOperationException("Jwt:Issuer must be set.");

var jwtAudience = builder.Configuration["Jwt:Audience"];
if (string.IsNullOrWhiteSpace(jwtAudience))
    throw new InvalidOperationException("Jwt:Audience must be set.");

var mongoConnectionString = builder.Configuration["MongoDb:ConnectionString"];
if (string.IsNullOrWhiteSpace(mongoConnectionString))
    throw new InvalidOperationException("MongoDb:ConnectionString must be set.");

var productionOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>()
    ?? ["https://ojas-atta.vercel.app"];

var allowVercelPreviewOrigins = builder.Configuration.GetValue("Cors:AllowVercelPreviewOrigins", false);

// MongoDB
builder.Services.Configure<MongoDbSettings>(
    builder.Configuration.GetSection("MongoDb"));
builder.Services.AddSingleton<MongoDbService>();
builder.Services.AddSingleton<IMongoDbService>(sp => sp.GetRequiredService<MongoDbService>());
builder.Services.AddScoped<ProductService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<DeliveryChargesService>();
builder.Services.AddScoped<CampaignBannerService>();

// JWT Authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.SaveToken = false;
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (string.IsNullOrWhiteSpace(context.Token) &&
                    context.Request.Cookies.TryGetValue("ojas_auth", out var cookieToken))
                {
                    context.Token = cookieToken;
                }

                return Task.CompletedTask;
            }
        };
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtKey))
        };
    });

// CORS for Angular frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy.WithOrigins(
                "http://localhost:4200",
                "https://localhost:4200"
              )
              .AllowAnyHeader()
                            .AllowAnyMethod()
                            .AllowCredentials();
    });

    options.AddPolicy("AllowProduction", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (productionOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
                return true;

            if (!allowVercelPreviewOrigins)
                return false;

            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                return false;

            return uri.Scheme == Uri.UriSchemeHttps && uri.Host.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase);
        })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
    });
});

// Rate Limiting
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Strict limit for auth endpoints: 5 requests per minute per IP
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // General API limit: 60 requests per minute per IP. High enough that a legitimate
    // admin session bulk-creating/editing products in one sitting doesn't get caught in
    // the same net as scraping or enumeration abuse.
    options.AddPolicy("general", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
});

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});

builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
{
    options.Level = System.IO.Compression.CompressionLevel.Fastest;
});

builder.Services.Configure<GzipCompressionProviderOptions>(options =>
{
    options.Level = System.IO.Compression.CompressionLevel.Fastest;
});

var app = builder.Build();

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});

// Health check endpoint
app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTime.UtcNow }));

// Seed products (non-blocking)
_ = Task.Run(async () =>
{
    try
    {
        using var scope = app.Services.CreateScope();
        var productService = scope.ServiceProvider.GetRequiredService<ProductService>();
        await productService.SeedAsync(SeedData.GetProducts());
        await productService.MigrateLegacyProductsAsync();
        Console.WriteLine("✅ Product seed data loaded successfully.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"⚠️ Could not seed products: {ex.Message}");
    }
});

if (app.Environment.IsProduction())
    app.UseCors("AllowProduction");
else
    app.UseCors("AllowAngular");

app.UseHttpsRedirection();

if (app.Environment.IsProduction())
    app.UseHsts();

app.UseResponseCompression();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Security headers
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' https://*.tile.openstreetmap.org data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    await next();
});

app.UseRateLimiter();

app.UseAuthentication();

app.Use(async (context, next) =>
{
    // Login/register/logout establish or clear the session cookie itself, so a stale
    // still-valid auth cookie from a prior session must not block them with a CSRF check.
    var path = context.Request.Path;
    var isAuthBootstrapEndpoint = path.StartsWithSegments("/api/auth/login") ||
        path.StartsWithSegments("/api/auth/register") ||
        path.StartsWithSegments("/api/auth/logout");

    if (!isAuthBootstrapEndpoint &&
        context.User.Identity?.IsAuthenticated == true &&
        (HttpMethods.IsPost(context.Request.Method) ||
         HttpMethods.IsPut(context.Request.Method) ||
         HttpMethods.IsPatch(context.Request.Method) ||
         HttpMethods.IsDelete(context.Request.Method)))
    {
        var csrfCookie = context.Request.Cookies["ojas_csrf"];
        var csrfHeader = context.Request.Headers["X-CSRF-Token"].ToString();
        if (string.IsNullOrWhiteSpace(csrfCookie) || csrfCookie != csrfHeader)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "Invalid CSRF token." });
            return;
        }
    }

    await next();
});

app.UseAuthorization();
app.MapControllers();

app.Run();

// Exposed so WebApplicationFactory<Program> in the test project can bootstrap this app in-memory.
public partial class Program { }
