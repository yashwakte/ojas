using System.Security.Claims;
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

// Inert until a DSN exists, same posture as Brevo/MSG91 - nothing here needs to happen before
// the rest of the app works, and there's no external account to wait on to keep building.
// Create a free Sentry account, make a project, and set Sentry:Dsn to switch this on.
var sentryDsn = builder.Configuration["Sentry:Dsn"];
if (!string.IsNullOrWhiteSpace(sentryDsn))
{
    builder.WebHost.UseSentry(options =>
    {
        options.Dsn = sentryDsn;
        options.Environment = builder.Environment.EnvironmentName;
        // Traces are billed per-event on Sentry's free tier; errors are what actually matter
        // here, so this stays off rather than defaulting to a sample rate that quietly burns
        // quota the same way the earlier per-order email notification would have.
        options.TracesSampleRate = 0.0;
    });
}

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

// Unlike Brevo/MSG91 (which degrade gracefully when unconfigured), a missing CAPTCHA secret
// isn't safe to silently skip past - that would mean shipping with zero bot protection and no
// signal it happened. For local dev, use Cloudflare's documented dummy pair (site key
// 1x00000000000000000000AA / secret 1x0000000000000000000000000000000AA), which always
// passes and works on any domain including localhost.
var turnstileSecretKey = builder.Configuration["Turnstile:SecretKey"];
if (string.IsNullOrWhiteSpace(turnstileSecretKey))
    throw new InvalidOperationException("Turnstile:SecretKey must be set.");

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
builder.Services.AddScoped<OrderPaymentOutcomeService>();
builder.Services.AddScoped<DeliveryChargesService>();
builder.Services.AddScoped<CampaignBannerService>();
builder.Services.AddScoped<OtpService>();
builder.Services.AddScoped<DeviceService>();
builder.Services.AddScoped<StaffInviteService>();
builder.Services.AddScoped<ChatbotService>();
builder.Services.AddHttpClient<CashfreeService>();
builder.Services.AddScoped<WalletService>();

// Singletons: MediaService holds a byte-budgeted in-memory cache of the images the storefront
// asks for, which is only worth having if it outlives a single request.
builder.Services.AddSingleton<MediaService>();
builder.Services.AddSingleton<MediaMigrationService>();
builder.Services.AddHealthChecks().AddCheck<MongoHealthCheck>("mongodb");
// Real mail is only worth sending in Production. Everywhere else the OTP already comes back in
// the response as devCode and is shown in the UI, so a real send would just spend free-tier
// quota - set Email:SendInDevelopment=true to opt back in when deliverability itself is what
// you're testing.
if (builder.Environment.IsProduction() || builder.Configuration.GetValue<bool>("Email:SendInDevelopment"))
{
    // NotConfiguredEmailSender, not SmtpEmailSender, until a real HTTP-API-based provider
    // replaces it - confirmed live on Render that outbound SMTP is blocked on both 465 and 587
    // (both time out rather than fail fast), so SmtpEmailSender would just make every affected
    // request hang for MailKit's ~100s default timeout instead of failing immediately. Brevo is
    // suspended and unrecoverable, so there is currently no working email delivery at all.
    builder.Services.AddSingleton<IEmailSender, NotConfiguredEmailSender>();
}
else
{
    builder.Services.AddSingleton<IEmailSender, LoggingEmailSender>();
}
builder.Services.AddHttpClient<IPhoneOtpSender, Msg91PhoneOtpSender>();
builder.Services.AddHttpClient<ITurnstileVerifier, CloudflareTurnstileVerifier>();

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

// Names the account a response was served for - see the middleware that writes it, further down.
const string SessionIdentityHeader = "X-Ojas-User";

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
                            .AllowCredentials()
                            .WithExposedHeaders(SessionIdentityHeader);
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
        .AllowCredentials()
        .WithExposedHeaders(SessionIdentityHeader);
    });
});

// Rate Limiting
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Strict limit for auth endpoints: 5 requests per minute per IP.
    //
    // Outside Production this is deliberately loosened. The limit exists to slow credential
    // stuffing from the internet, which is not a threat on a developer's machine - whereas the
    // integration and Playwright suites hammer these endpoints from a single loopback IP and
    // would otherwise fail on the rate limiter rather than on anything real. Device enrolment
    // in particular costs two auth-policy calls (request a code, then redeem it).
    var authPermitLimit = builder.Environment.IsProduction() ? 5 : 50;
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = authPermitLimit,
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
    // The defaults would happily gzip a WebP. Already-compressed image bytes do not shrink;
    // the only results are wasted CPU on every image request and a response a shade larger
    // than the file itself. Compress the text, ship the pictures as they are.
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Except(
    [
        "image/webp", "image/png", "image/jpeg", "image/gif", "image/avif",
    ]);
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

// Grandfather accounts that predate email-verification enforcement (non-blocking)
_ = Task.Run(async () =>
{
    try
    {
        using var scope = app.Services.CreateScope();
        var authService = scope.ServiceProvider.GetRequiredService<AuthService>();
        await authService.GrandfatherPreExistingUsersAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"⚠️ Could not grandfather pre-existing users for email verification: {ex.Message}");
    }
});

// Lift any image still stored as an inline base64 blob out into the media store (non-blocking).
// Documents that already reference a URL are untouched, so this settles to a no-op after the
// first run. Deliberately off the startup path: a slow pass over the catalog must not delay the
// instance becoming ready, and the storefront renders correctly either way - an unmigrated
// data: URL is still a perfectly valid image source, just a slow one.
_ = Task.Run(async () =>
{
    try
    {
        var migration = app.Services.GetRequiredService<MediaMigrationService>();
        await migration.RunAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"⚠️ Could not migrate inline images into the media store: {ex.Message}");
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

// Stamp every authenticated response with the account it was served for.
//
// Cookies belong to a browser profile, not to a tab. Sign into a second account in one tab and
// every other tab's cached user is now describing someone the cookie no longer refers to - so
// those tabs would happily render one person's name and menu above another person's orders,
// addresses and wallet. That is a data leak with no attacker in it, just two tabs.
//
// The client compares this header against whoever it thinks is signed in and resynchronises the
// moment they disagree, which means the mismatch is caught on the very first response rather
// than on a poll or a refresh. It costs no extra round trip, and it discloses nothing: the only
// id it ever names is the one belonging to the caller's own session.
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var userId = context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrWhiteSpace(userId))
            context.Response.Headers[SessionIdentityHeader] = userId;
        return Task.CompletedTask;
    });

    await next();
});

app.Use(async (context, next) =>
{
    // Login/register/logout/refresh establish or clear the session cookie itself, so a stale
    // still-valid auth cookie from a prior session must not block them with a CSRF check.
    // Refresh in particular: the frontend calls it reactively once the access token has
    // already expired (IsAuthenticated is false by then, so this exemption wouldn't even be
    // reached) - but nothing stops it from also being called while the old token is still
    // valid, and it shouldn't depend on that timing to behave consistently.
    // Password reset and staff device approval belong here for the same reason: they are
    // unauthenticated flows that establish or replace credentials, and each one can legitimately
    // be reached while a stale-but-still-valid auth cookie is sitting in the browser (an admin
    // whose device was revoked mid-session re-approving a device, or anyone resetting a password
    // without signing out first). Requiring a CSRF token there would reject the very request
    // meant to recover the account.
    var path = context.Request.Path;
    var isAuthBootstrapEndpoint = path.StartsWithSegments("/api/auth/login") ||
        path.StartsWithSegments("/api/auth/register") ||
        path.StartsWithSegments("/api/auth/logout") ||
        path.StartsWithSegments("/api/auth/refresh") ||
        path.StartsWithSegments("/api/auth/forgot-password") ||
        path.StartsWithSegments("/api/auth/reset-password") ||
        path.StartsWithSegments("/api/auth/device/send-otp") ||
        path.StartsWithSegments("/api/auth/device/enroll") ||
        path.StartsWithSegments("/api/auth/accept-invite") ||
        path.StartsWithSegments("/api/auth/phone-login");

    // Payment gateway callbacks are server-to-server and authenticated by the HMAC signature on
    // the request itself, never by a session. They happen to carry no auth cookie today, so the
    // check below would skip them anyway - but a webhook must not silently depend on that, and
    // it must keep working if one ever arrives alongside a cookie.
    var isGatewayWebhook = path.StartsWithSegments("/api/payments/cashfree/webhook");

    if (!isAuthBootstrapEndpoint &&
        !isGatewayWebhook &&
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

// Deliberately outside [Authorize]/rate-limiting - Render (or any external monitor) needs to
// reach this anonymously and frequently to know whether to restart the service.
app.MapHealthChecks("/health");

app.Run();

// Exposed so WebApplicationFactory<Program> in the test project can bootstrap this app in-memory.
public partial class Program { }
