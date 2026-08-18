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

public record CreateStaffRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MinLength(10), MaxLength(128)] string Password,
	[Required] string Role);

public record AuthResponse(string Id, string FullName, string Email, string Phone, string Role, string CsrfToken = "");
public record AuthResult(string Token, AuthResponse User, string RefreshToken);

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

public record StaffUserResponse(string Id, string FullName, string Email, string Phone, string Role);

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
