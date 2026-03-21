# Deploying Photometrics

## One-time setup (2 minutes)

### 1. Deploy to Vercel

```bash
cd Photometrics
npm i -g vercel    # if not installed
vercel login       # authenticate with your Vercel account
vercel             # deploy (accept defaults: no framework, output dir ".")
vercel --prod      # promote to production
```

### 2. Add custom domain in Vercel

```bash
vercel domains add photometrics.ethanswilson.com
```

Or via Vercel dashboard: Project Settings → Domains → Add `photometrics.ethanswilson.com`

### 3. Add DNS record in Cloudflare

In your Cloudflare dashboard for `ethanswilson.com`:

| Type  | Name          | Target                  | Proxy |
|-------|---------------|-------------------------|-------|
| CNAME | photometrics  | cname.vercel-dns.com    | DNS only (grey cloud) |

**Important:** Set Cloudflare proxy to "DNS only" (grey cloud) so Vercel's SSL works.
If you want Cloudflare proxy (orange cloud), set SSL mode to "Full (strict)" in Cloudflare.

### 4. Wait for SSL

Vercel auto-provisions an SSL cert once DNS propagates (usually 1-5 minutes).

## Redeploying after changes

```bash
git push
vercel --prod
```

Or connect the GitHub repo in Vercel dashboard for auto-deploys on push.
