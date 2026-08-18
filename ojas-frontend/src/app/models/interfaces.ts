export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  discount: number;
  category: string;
  imageUrl: string;
  galleryImageUrls: string[];
  weight: string;
  isAvailable: boolean;
  /** Units on hand. null means stock isn't tracked for this product yet. */
  stockQuantity: number | null;
  lowStockThreshold: number;
  ingredients: string;
  benefits: string;
  storageInfo: string;
  createdAt: string;
  updatedAt: string;
}

/** Purchasable = admin has it enabled AND it isn't a tracked product at zero. */
export function isPurchasable(product: Product): boolean {
  return product.isAvailable && (product.stockQuantity === null || product.stockQuantity > 0);
}

export function isOutOfStock(product: Product): boolean {
  return product.stockQuantity !== null && product.stockQuantity <= 0;
}

export function isLowStock(product: Product): boolean {
  return (
    product.stockQuantity !== null &&
    product.stockQuantity > 0 &&
    product.stockQuantity <= product.lowStockThreshold
  );
}

export interface CreateProductRequest {
  name: string;
  description: string;
  price: number;
  discount: number;
  category: string;
  imageUrl: string;
  galleryImageUrls: string[];
  weight: string;
  isAvailable: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number;
  ingredients: string;
  benefits: string;
  storageInfo: string;
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {
  id: string;
}

export interface DeliveryChargesConfig {
  id: string;
  warehouseAddress: string;
  warehouseLatitude: number;
  warehouseLongitude: number;
  freeDeliveryUpToKm: number;
  perKmChargeAfterFree: number;
  /** Serviceable radius from the warehouse; 0 means no limit. */
  maxDeliveryRadiusKm: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDeliveryChargesRequest {
  warehouseAddress?: string;
  warehouseLatitude?: number;
  warehouseLongitude?: number;
  freeDeliveryUpToKm?: number;
  perKmChargeAfterFree?: number;
  maxDeliveryRadiusKm?: number;
  isActive?: boolean;
}

export interface DeliveryChargeCalculation {
  distanceKm: number;
  charge: number;
  isFree: boolean;
  /** False when the location sits outside the serviceable radius. */
  isServiceable: boolean;
  maxRadiusKm: number;
}

export interface CampaignBannerConfig {
  id: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  backgroundImageUrl: string;
  isActive: boolean;
  featuredSectionTitle: string;
  featuredProductIds: string[];
  fallbackBestsellerProductIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCampaignBannerRequest {
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  backgroundImageUrl?: string;
  isActive?: boolean;
  featuredSectionTitle?: string;
  featuredProductIds?: string[];
  fallbackBestsellerProductIds?: string[];
}

export interface AuthResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  csrfToken?: string;
}

export type UserRole = 'customer' | 'admin' | 'delivery';

export interface RegisterRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  turnstileToken: string;
}

/** Returned by /register while the account awaits OTP verification - not a session yet. */
export interface RegisterPendingResponse {
  email: string;
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
}

export interface VerifyEmailOtpRequest {
  email: string;
  code: string;
}

export interface ResendEmailOtpRequest {
  email: string;
}

export interface ResendEmailOtpResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
  turnstileToken: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  productId: string;
  productName: string;
  price: number;
  weight: string;
  quantity: number;
}

export interface PlaceOrderRequest {
  fullName: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  notes: string;
  items: OrderItem[];
}

/** Same shape as placing an order — the server recomputes totals either way. */
export type UpdateMyOrderRequest = PlaceOrderRequest;

/** Statuses at which a customer may still edit or cancel; mirrors the API. */
export const CUSTOMER_EDITABLE_STATUSES = ['Pending', 'Confirmed'];

export function isOrderEditable(status: string): boolean {
  return CUSTOMER_EDITABLE_STATUSES.some((s) => s.toLowerCase() === status.toLowerCase());
}

export interface OrderResponse {
  id: string;
  fullName: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  addressMapLink?: string | null;
  notes: string;
  items: OrderItem[];
  deliveryCharge: number;
  deliveryDistanceKm: number;
  totalAmount: number;
  status: string;
  createdAt: string;
  deliveryPartnerId?: string | null;
  deliveryPartnerName?: string | null;
  updatedAt?: string | null;
}

export interface StaffUserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
}

export interface CreateStaffRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: Exclude<UserRole, 'customer'>;
}

export interface UpdateOrderStatusRequest {
  status: string;
}

export interface AssignDeliveryPartnerRequest {
  deliveryPartnerId: string;
}

export interface SavedAddress {
  label: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  mapLink?: string | null;
  isDefault: boolean;
}

export interface SaveAddressRequest {
  label: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
}

export interface UpdateProfileRequest {
  fullName: string;
  email: string;
  phone: string;
}

export interface UserProfileResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  createdAt: string;
  savedAddresses: SavedAddress[];
}
