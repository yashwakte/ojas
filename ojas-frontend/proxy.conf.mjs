// Makes `ng serve` answer /api/* the way Vercel's rewrite does in production, by forwarding it
// to the locally running API.
//
// Uploaded images are stored as origin-independent paths (`/api/media/{hash}.webp`) so that one
// database is correct on ojas-atta.vercel.app, on ojasaata.com and on localhost alike. In
// production Vercel's rewrite resolves that against the Render API. Without the equivalent here,
// a browser on :4200 resolves it against the dev server, which answers index.html or a 404 —
// so every admin-uploaded image is broken in local development while being fine in production.
//
// Change `target` if the API is started on a port other than the launchSettings default.
export default {
  '/api': {
    target: 'https://localhost:7126',
    // The API's local HTTPS certificate is the ASP.NET Core dev cert, which this proxy has no
    // reason to verify.
    secure: false,
  },
};
