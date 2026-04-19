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
  token: string;
  fullName: string;
  email: string;
  phone: string;
}

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
  notes: string;
  items: OrderItem[];
}

export interface OrderResponse {
  id: string;
  fullName: string;
  phone: string;
  address: string;
  notes: string;
  items: OrderItem[];
  totalAmount: number;
  status: string;
  createdAt: string;
}

export interface SavedAddress {
  label: string;
  fullAddress: string;
  isDefault: boolean;
}

export interface SaveAddressRequest {
  label: string;
  fullAddress: string;
  isDefault: boolean;
}

export interface UpdateProfileRequest {
  fullName: string;
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
