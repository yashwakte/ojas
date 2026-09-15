import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import {
  adminGuard,
  customerGuard,
  deliveryGuard,
  roleHomeGuard,
  storefrontGuard,
} from './guards/role.guard';
// Type-only: the copy itself stays out of this file's download. See RouteSeoKey.
import type { RouteSeoKey } from './constants/seo';

/**
 * `data.preload` marks the screens StorefrontPreloadStrategy fetches ahead of time, once the
 * browser is idle. It is the storefront a customer moves between — browse, product, cart,
 * checkout — plus login, which is the gate in front of checkout.
 *
 * Deliberately NOT marked: the admin console and the delivery screens, which are the two largest
 * chunks in the build and are reachable by a handful of people, and the legal pages, which are
 * read once if ever. Preloading those would spend a customer's bandwidth on code they will
 * never run.
 *
 * `data.seo` is what SeoService tells search engines about the page: a key naming its copy (see
 * RouteSeoKey) for a page whose title never changes, 'page' for one that depends on what it loads,
 * and nothing at all for the screens that must stay out of search results (cart, checkout, staff).
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
    data: { seo: 'home' satisfies RouteSeoKey },
    canActivate: [roleHomeGuard],
  },
  {
    // `id` is the product's slug (modak-pith) — or its id, for links made before slugs existed,
    // which the page replaces with the slug.
    path: 'products/:id',
    loadComponent: () =>
      import('./pages/product-detail/product-detail').then((m) => m.ProductDetail),
    data: { preload: true, seo: 'page' satisfies RouteSeoKey },
    canActivate: [storefrontGuard],
  },
  {
    path: 'products',
    loadComponent: () => import('./pages/products/products').then((m) => m.Products),
    data: { preload: true, seo: 'page' satisfies RouteSeoKey },
    canActivate: [storefrontGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    data: { preload: true },
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
    data: { preload: true },
    canActivate: [storefrontGuard],
  },
  {
    path: 'checkout',
    loadComponent: () => import('./pages/checkout/checkout').then((m) => m.Checkout),
    data: { preload: true },
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
    data: { preload: true },
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
    data: { preload: true, seo: 'offers' satisfies RouteSeoKey },
    canActivate: [storefrontGuard],
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about').then((m) => m.About),
    data: { seo: 'about' satisfies RouteSeoKey },
    canActivate: [storefrontGuard],
  },
  // Policy pages. Deliberately unguarded - a payment gateway's compliance reviewer opens these
  // signed out, and a customer must be able to read the refund policy without an account. One
  // component serves all four; `slug` selects the content (see legal-content.ts).
  {
    path: 'contact',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'contact', seo: 'page' satisfies RouteSeoKey },
  },
  {
    path: 'terms',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'terms', seo: 'page' satisfies RouteSeoKey },
  },
  {
    path: 'refunds',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'refunds', seo: 'page' satisfies RouteSeoKey },
  },
  {
    path: 'privacy',
    loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal),
    data: { slug: 'privacy', seo: 'page' satisfies RouteSeoKey },
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
    // A real "not found" page rather than a redirect home. Sending every unknown address to the
    // home page is what Google calls a soft 404: a wrong or retired link answering with a real
    // page, which turns each one into a duplicate of the home page.
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound),
    data: { seo: 'not-found' satisfies RouteSeoKey },
  },
];
