using System.ComponentModel.DataAnnotations;

namespace OjasApi.Models;

public record RegisterRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MinLength(6), MaxLength(128)] string Password);

public record LoginRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password);

public record CreateStaffRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MinLength(6), MaxLength(128)] string Password,
	[Required] string Role);

public record AuthResponse(string Id, string FullName, string Email, string Phone, string Role, string CsrfToken = "");
public record AuthResult(string Token, AuthResponse User);

public record StaffUserResponse(string Id, string FullName, string Email, string Phone, string Role);

public record SavedAddressDto(string Label, string FullAddress, double Latitude, double Longitude, string? MapLink, bool IsDefault);
public record SaveAddressRequest(string Label, string FullAddress, [Required] double? Latitude, [Required] double? Longitude, bool IsDefault);
public record UpdateProfileRequest(string FullName, string Email, string Phone);
public record UserProfileResponse(string Id, string FullName, string Email, string Phone, DateTime CreatedAt, List<SavedAddressDto> SavedAddresses);

public record OrderItemDto(string ProductId, string ProductName, decimal Price, string Weight, int Quantity);
public record PlaceOrderRequest(string FullName, string Phone, string Address, [Required] double? Latitude, [Required] double? Longitude, string Notes, List<OrderItemDto> Items);
public record UpdateOrderStatusRequest([Required] string Status);
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
	decimal TotalAmount,
	string Status,
	DateTime CreatedAt,
	string? DeliveryPartnerId,
	string? DeliveryPartnerName,
	DateTime? UpdatedAt);
