# Deploying to Cloudflare Workers

Use Node.js 22 or newer and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @openreel/web exec wrangler deploy --dry-run
pnpm --filter @openreel/web deploy
```

The web build compiles `apps/web/functions/` to `.worker/index.js`. The Worker handles `/api/proxy` and its children before assets; other requests use Workers Static Assets with an SPA fallback. The existing `_headers` file retains cross-origin isolation for FFmpeg and SharedArrayBuffer. Worker code is outside `dist` and cannot be downloaded as an asset.

For the image editor:

```sh
pnpm --filter @openreel/image build
pnpm --filter @openreel/image exec wrangler deploy --dry-run
pnpm --filter @openreel/image deploy
```

Use `pnpm deploy:preview` for a web Preview, or `pnpm --filter @openreel/image deploy:preview` after building the image editor. `wrangler preview` uses the current Git branch by default; append `--name pr-123` to select a stable Preview name. Preview configuration is separate from production.

For local Workers testing, build the selected app and run `pnpm --filter @openreel/web exec wrangler dev` (or the image workspace equivalent). Vite remains available for frontend development.

Before switching traffic, create the Workers in the intended account, grant the deployment token Workers Scripts Edit, and configure the existing custom domains on the corresponding Worker. Check the API proxy, cross-origin isolation headers and deep links on the Worker URL. Recreate any account-side settings not stored here, including R2 CORS origins for the new Preview URLs. Disable Pages automatic deployments only after validation; delete the old Pages project after traffic has moved.

Migration references: [Wrangler v3 to v4](https://developers.cloudflare.com/workers/wrangler/migration/update-v3-to-v4/) and [Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).
