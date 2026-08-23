using MongoDB.Driver;
using OjasApi.Models;

namespace OjasApi.Services;

public interface IMongoDbService
{
    IMongoCollection<Product> Products { get; }
    IMongoCollection<User> Users { get; }
    IMongoCollection<Order> Orders { get; }
    IMongoCollection<DeliveryCharges> DeliveryCharges { get; }
    IMongoCollection<CampaignBanner> CampaignBanners { get; }
    IMongoCollection<OtpCode> OtpCodes { get; }
    IMongoCollection<RefreshToken> RefreshTokens { get; }
    IMongoCollection<StaffDevice> StaffDevices { get; }
    IMongoCollection<StaffInvite> StaffInvites { get; }
    IMongoCollection<WalletTransaction> WalletTransactions { get; }
}
