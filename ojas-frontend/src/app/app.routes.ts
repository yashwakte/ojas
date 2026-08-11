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
    path: 'cart',
    loadComponent: () => import('./pages/cart/cart').then((m) => m.Cart),
    canActivate: [authGuard, customerGuard],
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
    path: 'offers',
    loadComponent: () => import('./pages/offers/offers').then((m) => m.Offers),
    canActivate: [storefrontGuard],
  },
  {
    path: 'admin/orders',
    loadComponent: () => import('./pages/admin-orders/admin-orders').then((m) => m.AdminOrders),
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
