# Deployment Checklist for app.openreel.video

## Pre-Deployment

- [ ] Build passes successfully: `pnpm build`
- [ ] All tests pass: `pnpm test:run`
- [ ] TypeScript checks pass: `pnpm typecheck`
- [ ] Git repository is clean or changes are committed

## Cloudflare Setup (First Time Only)

### 1. Install and Authenticate Wrangler

```bash
cd apps/web
npx wrangler login
```

### 2. Create Cloudflare Pages Project

```bash
npx wrangler pages project create openreel
```

### 3. Configure Custom Domain

In Cloudflare Dashboard:
1. Go to **Pages** → **openreel** → **Custom domains**
2. Click **Set up a custom domain**
3. Enter: `app.openreel.video`
4. Cloudflare will automatically configure DNS

**Important**: Ensure your `openreel.video` domain is already added to Cloudflare.

## Deployment Steps

### Option 1: Quick Deploy (from root)

```bash
pnpm deploy
```

### Option 2: Manual Deploy (from apps/web)

```bash
pnpm build
pnpm deploy
```

### Option 3: Preview Deploy

```bash
pnpm deploy:preview
```

## Post-Deployment Verification

### 1. Check Deployment Status

```bash
npx wrangler pages deployment list --project-name=openreel
```

### 2. Verify Site Access

- [ ] Visit https://app.openreel.video
- [ ] Site loads without errors
- [ ] No console errors in browser DevTools

### 3. Verify Headers

Open DevTools → Network → Select any request → Check Response Headers:
- [ ] `Cross-Origin-Opener-Policy: same-origin`
- [ ] `Cross-Origin-Embedder-Policy: require-corp`

### 4. Test Core Features

- [ ] Import media file
- [ ] Add emoji to timeline
- [ ] Apply transform (move, scale, rotate)
- [ ] Apply entry/exit transitions
- [ ] Export video (this tests WebCodecs and FFmpeg.wasm)
- [ ] Download exported video

### 5. Test Routing

- [ ] Direct URL access works (not just homepage)
- [ ] Browser back/forward buttons work

## Troubleshooting

### Deployment Failed

```bash
# Check authentication
npx wrangler whoami

# Re-authenticate if needed
npx wrangler logout
npx wrangler login

# Try again
pnpm deploy
```

### SharedArrayBuffer Issues

If you see "SharedArrayBuffer is not defined":
1. Check headers in Network tab
2. Hard reload browser (Cmd+Shift+R / Ctrl+Shift+F5)
3. Clear site data in DevTools → Application → Clear storage

### 404 on Routes

If direct URLs show 404:
1. Verify `_redirects` file exists in `dist/`
2. Check Cloudflare Pages → Functions tab
3. Redeploy if needed

## Rollback

If deployment has issues:

```bash
# List deployments
npx wrangler pages deployment list --project-name=openreel

# The previous deployment is still accessible at its unique URL
# You can promote it back in Cloudflare Dashboard
```

Go to Cloudflare Dashboard → Pages → openreel → Deployments → Select previous deployment → Rollback

## Environment-Specific Notes

### Production
- Deployed to: `app.openreel.video`
- Branch: `main`
- Command: `pnpm deploy`

### Preview
- Deployed to: `[unique-id].openreel.pages.dev`
- Branch: `preview`
- Command: `pnpm deploy:preview`

## Support

For deployment issues:
- Check logs: Cloudflare Pages → openreel → Deployments → [Latest] → View logs
- Wrangler docs: https://developers.cloudflare.com/pages/
- OpenReel issues: https://github.com/Augani/openreel-video/issues
