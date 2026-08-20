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
  /** Set only when the customer explicitly picked one from the Coupons & Offers list. */
  couponCode?: string | null;
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
  subtotal: number;
  couponCode?: string | null;
  discountPercentage: number;
  discountAmount: number;
  deliveryCharge: number;
  deliveryDistanceKm: number;
  totalAmount: number;
  status: string;
  /** Only "COD" today - a field rather than an assumption so an online method can slot in later. */
  paymentMethod: string;
  paymentStatus: string;
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
  /** True while the account still has no password - the invite was sent but never accepted. */
  invitePending?: boolean;
  /** Set while an admin-approved device enrollment is standing by, so this account's next
   * device can enroll on password alone with no OTP email. Null once consumed or expired. */
  pendingDeviceApprovalExpiresAt?: string | null;
}

/** No password: the account is created dormant and the staff member sets their own via the
 * emailed invite, so an admin never handles someone else's credentials. */
export interface CreateStaffRequest {
  fullName: string;
  email: string;
  phone: string;
  role: Exclude<UserRole, 'customer'>;
}

export interface CreateStaffResponse extends StaffUserResponse {
  /** Populated outside Production only, so the flow can be walked without a working inbox. */
  devInviteToken?: string | null;
}

export interface AcceptInviteRequest {
  token: string;
  password: string;
}

export interface InvitePreviewResponse {
  fullName: string;
  email: string;
  role: UserRole;
}

export interface ResendInviteResponse {
  message: string;
  devInviteToken?: string | null;
}

/** Step one of moving a staff account to a new device: proves the password, triggers the code. */
export interface DeviceOtpRequest {
  email: string;
  password: string;
}

export interface DeviceOtpResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
  /** True when an admin already cleared this account's next device ahead of time - no code was
   * sent, and the caller should go straight to PreApprovedEnrollRequest instead. */
  preApproved?: boolean;
}

/** Step two: redeeming the code binds the calling browser as the account's one trusted device. */
export interface EnrollDeviceRequest {
  email: string;
  password: string;
  code: string;
}

/** Alternative to EnrollDeviceRequest for an account with a standing admin approval - no code,
 * since the trust comes from the admin's own action rather than proof of email control. */
export interface PreApprovedEnrollRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
  turnstileToken: string;
}

export interface ForgotPasswordResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real email set up. */
  devCode?: string | null;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

/** Customer-only: signing in with a phone number instead of email+password. 503s until MSG91 is
 * configured. */
export interface PhoneLoginRequest {
  phone: string;
  turnstileToken: string;
}

export interface PhoneLoginResponse {
  message: string;
  /** Populated outside Production only, so the flow can be tested without real MSG91 set up. */
  devCode?: string | null;
}

export interface PhoneLoginVerifyRequest {
  phone: string;
  code: string;
}

export interface StaffDeviceResponse {
  label: string;
  enrolledVia: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface UpdateOrderStatusRequest {
  status: string;
}

export interface AssignDeliveryPartnerRequest {
  deliveryPartnerId: string;
}

export interface SavedAddress {
  label: string;
  /** Empty for addresses saved before this field existed. */
  phone: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  mapLink?: string | null;
  isDefault: boolean;
}

export interface SaveAddressRequest {
  label: string;
  phone: string;
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

/** Topic always comes from a quick-reply button the widget rendered - there is no free-text
 * input. Undefined means "show the greeting and main menu" (the very first request). */
export interface ChatbotRequest {
  topic?: string;
}

export interface ChatbotQuickReply {
  label: string;
  topic: string;
}

/** Escalate is a display hint (surface the contact details more prominently), not a separate
 * channel - reply already contains everything the bot has to say. */
export interface ChatbotResponse {
  reply: string;
  escalate: boolean;
  quickReplies: ChatbotQuickReply[];
}
