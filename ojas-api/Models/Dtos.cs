namespace OjasApi.Models;

public record RegisterRequest(string FullName, string Email, string Phone, string Password);
public record LoginRequest(string Email, string Password);
public record AuthResponse(string Token, string FullName, string Email, string Phone);

public record SavedAddressDto(string Label, string FullAddress, bool IsDefault);
public record SaveAddressRequest(string Label, string FullAddress, bool IsDefault);
public record UpdateProfileRequest(string FullName, string Phone);
public record UserProfileResponse(string Id, string FullName, string Email, string Phone, DateTime CreatedAt, List<SavedAddressDto> SavedAddresses);

public record OrderItemDto(string ProductId, string ProductName, decimal Price, string Weight, int Quantity);
public record PlaceOrderRequest(string FullName, string Phone, string Address, string Notes, List<OrderItemDto> Items);
public record OrderResponse(string Id, string FullName, string Phone, string Address, string Notes, List<OrderItemDto> Items, decimal TotalAmount, string Status, DateTime CreatedAt);
