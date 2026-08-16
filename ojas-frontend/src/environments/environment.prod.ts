export const environment = {
  production: true,
  // Same-origin, proxied to the Render API by the rewrite in vercel.json.
  // A cookie set for a cross-site API domain is a third-party cookie, which
  // Incognito/private browsing (and, increasingly, regular browsing) blocks
  // outright — the auth cookie would get silently dropped and every request
  // right after login would look signed-out. Routing through our own origin
  // makes it a first-party cookie instead, so this isn't just a workaround
  // for a niche browser mode; it's what makes cookie auth actually reliable.
  apiUrl: '/api',
};
