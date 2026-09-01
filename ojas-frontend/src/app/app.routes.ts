import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import {
  adminGuard,
  customerGuard,
  deliveryGuard,
  roleHomeGuard,
  storefrontGuard,
} from './guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
    canActivate: [roleHomeGuard],
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./pages/product-detail/product-detail').then((m) => m.ProductDetail),
    canActivate: [storefrontGuard],
  },
  {
    path: 'products',
    loadComponent: () => import('./pages/products/products').then((m) => m.Products),
    canActivate: [storefrontGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    canActivate: [storefrontGuard],
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register').then((m) => m.Register),
    canActivate: [storefrontGuard],
  },
  {
    // Deliberately unguarded: an invite link must open regardless of who is currently signed in
    // on that browser, including a staff member whose own session is still active.
    path: 'accept-invite',
    loadComponent: () => import('./pages/accept-invite/accept-invite').then((m) => m.AcceptInvite),
  },
  {
    path: 'cart',
    // Guests may build a cart freely; the login gate is at checkout.
    loadComponent: () => import('./pages/cart/cart').then((m) => m.Cart),
    canActivate: [storefrontGuard],
  },
  {
    path: 'checkout',
    loadComponent: () => import('./pages/checkout/checkout').then((m) => m.Checkout),
    canActivate: [authGuard, customerGuard],
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile),
    canActivate: [authGuard, customerGuard],
  },
  {
    path: 'my-orders',
    loadComponent: () => import('./pages/my-orders/my-orders').then((m) => m.MyOrders),
    canActivate: [authGuard, customerGuard],
  },
  {
    path: 'wallet',
    loadComponent: () => import('./pages/wallet/wallet').then((m) => m.Wallet),
    canActivate: [authGuard, customerGuard],
  },
  {
    path: 'offers',
    loadComponent: () => import('./pages/offers/offers').then((m) => m.Offers),
    canActivate: [storefrontGuard],
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about').then((m) => m.About),
    canActivate: [storefrontGuard],
  },
  // Policy pages. Deliberately unguarded - a payment gateway's compliance reviewer opens these
  // signed out, and a customer must be able to read the refund policy without an account. One
  // component serves all four; `slug` selects the content (see legal-content.ts).
  {
    path: 'contact',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'contact' },
  },
  {
    path: 'terms',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'terms' },
  },
  {
    path: 'refunds',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'refunds' },
  },
  {
    path: 'privacy',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'privacy' },
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin-dashboard/admin-dashboard').then((m) => m.AdminDashboard),
    canActivate: [adminGuard],
  },
  {
    path: 'delivery/orders',
    loadComponent: () =>
      import('./pages/delivery-orders/delivery-orders').then((m) => m.DeliveryOrders),
    canActivate: [deliveryGuard],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
