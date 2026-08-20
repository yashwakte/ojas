using System.ComponentModel.DataAnnotations;

namespace OjasApi.Models;

public record RegisterRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MinLength(10), MaxLength(128)] string Password,
	[Required] string TurnstileToken);

public record LoginRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password,
	[Required] string TurnstileToken);

/// <summary>No password: the account is created dormant and the staff member sets their own
/// when they accept the emailed invite, so an admin never learns their credentials.</summary>
public record CreateStaffRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required] string Role);

public record AcceptInviteRequest(
	[Required] string Token,
	[Required, MinLength(10), MaxLength(128)] string Password);

/// <summary>Shown on the invite screen before the password is set, so the person can see whose
/// account they're activating without the token itself revealing anything if it leaks.</summary>
public record InvitePreviewResponse(string FullName, string Email, string Role);

public record AuthResponse(string Id, string FullName, string Email, string Phone, string Role, string CsrfToken = "");

/// <summary>RawDeviceId is set only when a session also binds a new staff device, so the
/// controller knows to write the device cookie; null for ordinary customer sessions.</summary>
public record AuthResult(string Token, AuthResponse User, string RefreshToken, string? RawDeviceId = null);

public enum LoginOutcome
{
	Success,
	InvalidCredentials,
	NeedsEmailVerification,
	/// <summary>Password was correct, but this staff account is bound to a different device.</summary>
	NeedsDeviceEnrollment,
}

public record LoginServiceResult(LoginOutcome Outcome, AuthResult? Auth = null);

public record DeviceOtpRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password);

public record EnrollDeviceRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password,
	[Required, RegularExpression(@"^\d{6}$")] string Code);

/// <summary>No Code field, by design: trust here comes from an admin's own authenticated
/// approval rather than proof of email control, so there's nothing for a code to add.</summary>
public record PreApprovedEnrollRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password);

public record ForgotPasswordRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required] string TurnstileToken);

/// <summary>The new password is held to the same 10-character floor as registration - a reset
/// must never be a way to downgrade an account to a weaker password than signup allows.</summary>
public record ResetPasswordRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, RegularExpression(@"^\d{6}$")] string Code,
	[Required, MinLength(10), MaxLength(128)] string NewPassword);

public record StaffDeviceResponse(
	string Label,
	string EnrolledVia,
	DateTime CreatedAt,
	DateTime LastSeenAt);

/// <summary>Customer-only: signing in with a phone number instead of email+password. Requires
/// Turnstile since, unlike device/reset flows, nothing here already proves the caller controls
/// a password - this is the sole anonymous entry point into the flow.</summary>
public record PhoneLoginRequest(
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required] string TurnstileToken);

public record PhoneLoginVerifyRequest(
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, RegularExpression(@"^\d{6}$")] string Code);

/// <summary>Returned by /register while the account is awaiting OTP verification - deliberately
/// not an AuthResponse, since no session exists until the code is verified.</summary>
public record RegisterPendingResponse(string Email, string Message, string? DevCode = null);

public record VerifyEmailOtpRequest(
	[Required, EmailAddress] string Email,
	[Required, RegularExpression(@"^\d{6}$")] string Code);

public record ResendEmailOtpRequest([Required, EmailAddress] string Email);

public record SendPhoneOtpRequest([Required] string Phone);

public record VerifyPhoneOtpRequest(
	[Required] string Phone,
	[Required, RegularExpression(@"^\d{6}$")] string Code);

/// <summary>InvitePending is true while the account still has no password - i.e. the invite was
/// sent but never accepted. The admin UI surfaces it so a stalled onboarding is visible.</summary>
public record StaffUserResponse(
	string Id,
	string FullName,
	string Email,
	string Phone,
	string Role,
	bool InvitePending = false,
	DateTime? PendingDeviceApprovalExpiresAt = null);

public record SavedAddressDto(string Label, string FullAddress, double Latitude, double Longitude, string? MapLink, bool IsDefault);
public record SaveAddressRequest(string Label, string FullAddress, [Required] double? Latitude, [Required] double? Longitude, bool IsDefault);
public record UpdateProfileRequest(string FullName, string Email, string Phone);
public record UserProfileResponse(string Id, string FullName, string Email, string Phone, DateTime CreatedAt, List<SavedAddressDto> SavedAddresses);

public record OrderItemDto(string ProductId, string ProductName, decimal Price, string Weight, int Quantity);
public record PlaceOrderRequest(string FullName, string Phone, string Address, [Required] double? Latitude, [Required] double? Longitude, string Notes, List<OrderItemDto> Items);
public record UpdateOrderStatusRequest([Required] string Status);
public record UpdateMyOrderRequest(
	string FullName,
	string Phone,
	string Address,
	[Required] double? Latitude,
	[Required] double? Longitude,
	string Notes,
	List<OrderItemDto> Items);
public record AssignDeliveryPartnerRequest([Required] string DeliveryPartnerId);
public record OrderResponse(
	string Id,
	string FullName,
	string Phone,
	string Address,
	double Latitude,
	double Longitude,
	string? AddressMapLink,
	string Notes,
	List<OrderItemDto> Items,
	decimal DeliveryCharge,
	double DeliveryDistanceKm,
	decimal TotalAmount,
	string Status,
	string PaymentMethod,
	string PaymentStatus,
	DateTime CreatedAt,
	string? DeliveryPartnerId,
	string? DeliveryPartnerName,
	DateTime? UpdatedAt);

public record DeliveryChargeCalculationResponse(
	double DistanceKm,
	decimal Charge,
	bool IsFree,
	bool IsServiceable,
	double MaxRadiusKm);

/// <summary>Topic always comes from a quick-reply button the frontend rendered - there is no
/// free-text input, so nothing here is ever guessed from typed text. Null/absent means "show the
/// greeting and main menu" (the very first request when the widget opens).</summary>
public record ChatbotRequest(string? Topic);

public record ChatbotQuickReply(string Label, string Topic);

/// <summary>Escalate is a hint for the UI (e.g. show the "talk to a human" contact details more
/// prominently) - it's not a separate channel, the reply text already contains everything the
/// bot has to say.</summary>
public record ChatbotResponse(string Reply, bool Escalate, List<ChatbotQuickReply> QuickReplies);
