export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  weight: string;
  isAvailable: boolean;
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
}

export interface LoginRequest {
  email: string;
  password: string;
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
