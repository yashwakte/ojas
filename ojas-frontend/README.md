# OjasFrontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.0.6.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Deployment configuration

`vercel.json` holds two things worth understanding before editing it.

**`headers` — why `/images/*` is cached for a day.** Vercel serves files from `public/` with
`must-revalidate` by default, which costs a round trip to the edge on every page view just to be
told the picture has not changed. These files change only when someone deliberately replaces the
artwork, so a day of hard caching with a week of `stale-while-revalidate` behind it means a
returning visitor's images appear instantly while a replacement still rolls out on its own within
a day.

**`rewrites` — why `/api/*` points at the Render API.** It makes the API same-origin, so the auth
cookie is first-party rather than a third-party cookie that private browsing blocks outright. It
is also what resolves the origin-independent `/api/media/{hash}.webp` URLs that uploaded images
are stored as. `proxy.conf.mjs` gives `ng serve` the same behaviour locally; without it, uploaded
images 404 in development while working perfectly in production.

**Do not put comment keys in this file.** JSON has no comments, and Vercel validates `vercel.json`
against a strict schema that rejects unknown properties outright — a `"//"` key inside a `headers`
entry fails the build with `should NOT have additional property`. Explanations belong here
instead.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
