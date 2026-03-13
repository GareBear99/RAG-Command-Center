# Cloudflare Worker API — Setup Guide

Backend API for R&G Command Center, deployed on Cloudflare Workers with KV storage.

## Architecture

```
GitHub Pages (static frontend)
  ├── index.html, deals.html, directory.html   (public)
  ├── command-center.html, listings.html, etc.  (internal)
  └── data/bootstrap.js                        (static data)

Cloudflare Worker (API backend)
  ├── POST /api/inquiries       → persist public inquiries
  ├── GET  /api/inquiries       → list inquiries (internal)
  ├── PUT  /api/inquiries/:id   → update inquiry status
  ├── POST /api/events          → analytics collection
  ├── POST /api/proxy           → CORS proxy for data feeds
  ├── GET  /api/stats           → global statistics
  └── GET  /api/health          → health check
```

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`

## Deployment Steps

### 1. Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser window. Authorize Wrangler to access your Cloudflare account.

### 2. Create the KV Namespace

```bash
wrangler kv:namespace create "RG_DATA"
```

Copy the `id` value from the output.

### 3. Update wrangler.toml

Replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in `wrangler.toml` with the actual KV namespace ID from step 2.

### 4. Deploy the Worker

```bash
wrangler deploy
```

The Worker will be live at: `https://rg-command-center-api.<your-subdomain>.workers.dev`

### 5. Test the Deployment

```bash
# Health check
curl https://rg-command-center-api.<your-subdomain>.workers.dev/api/health

# Submit a test inquiry
curl -X POST https://rg-command-center-api.<your-subdomain>.workers.dev/api/inquiries \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","intent":"Buy a home","market":"Vancouver"}'

# Get stats
curl https://rg-command-center-api.<your-subdomain>.workers.dev/api/stats
```

## Connecting the Frontend

Once the Worker is deployed, update the frontend to send inquiries to the API.

In `assets/js/public.js`, the `setupInquiryForm()` function currently stores inquiries in localStorage. To also send them to the Worker API, add a fetch call:

```javascript
// Inside the form submit handler, after GRR.addInquiry():
const API_BASE = 'https://rg-command-center-api.<your-subdomain>.workers.dev';
fetch(`${API_BASE}/api/inquiries`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
}).catch(() => {}); // fire-and-forget; localStorage is the primary store
```

## API Reference

### POST /api/inquiries
Create a new inquiry from the public site.

**Body:**
- `name` (required) — Contact name
- `email` (required) — Contact email
- `phone` — Phone number
- `intent` — Inquiry intent (e.g. "Buy a home")
- `market` — Target market (e.g. "Vancouver")
- `budget` — Budget range
- `timeline` — Timeline
- `notes` — Free-text notes
- `listing_id` — Associated listing ID or "general"
- `source` — Source identifier (default: "public_website")
- `branch_hint` — Queue routing hint

### GET /api/inquiries
List stored inquiries. Supports `?limit=50&offset=0`.

### PUT /api/inquiries/:id
Update an inquiry's `status` or `notes`.

### POST /api/events
Collect an analytics event.

**Body:**
- `type` (required) — One of: `pageview`, `search`, `filter`, `listing_view`, `inquiry_start`, `inquiry_submit`, `map_view`
- `page` — Page URL or name
- `payload` — Arbitrary metadata object

### POST /api/proxy
CORS proxy for external listing data feeds. Used by Settings connectors when direct browser fetch is blocked by CORS.

**Body:**
- `url` (required) — Target endpoint URL
- `method` — HTTP method (default: GET)
- `auth_header` — Authorization header name
- `auth_value` — Authorization header value

### GET /api/stats
Returns global statistics (total inquiries, today's event count).

### GET /api/health
Returns `{ status: "ok" }`.

## Rate Limiting

All endpoints except `/api/health` and `/api/stats` are rate-limited per IP:

- **Inquiries:** 5/min, 30/hr, 100/day
- **Fetch:** 60/min, 600/hr, 3,000/day
- **Events:** 30/min, 500/hr, 5,000/day
- **Proxy:** 10/min, 60/hr, 200/day

Progressive timeouts apply on violations (1min → 5min → 15min → 1hr → 2hr).

## Custom Domain (Optional)

To use a custom domain like `api.rgcommandcenter.com`:

1. Add the domain to Cloudflare DNS
2. Uncomment and update the `[env.production]` routes section in `wrangler.toml`
3. Redeploy with `wrangler deploy`

## Cloudflare + GitHub Pages

The static site runs on GitHub Pages at `garebear99.github.io/RG-Command-Center/`. Cloudflare can optionally sit in front via DNS proxy:

1. In Cloudflare DNS, add a CNAME record pointing your custom domain to `garebear99.github.io`
2. In GitHub repo Settings → Pages → Custom domain, enter your domain
3. Cloudflare automatically provides SSL, caching, and DDoS protection

Without a custom domain, GitHub Pages and the Cloudflare Worker operate independently — the frontend calls the Worker API via fetch, and GitHub Pages handles static hosting with its own CDN.
