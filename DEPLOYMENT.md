# 🚀 Deployment Guide

End-to-end deployment notes from the 2026-04-23 session.

## Target infrastructure

| Layer | Service | Status |
|---|---|---|
| **Domain** | `rollingstyle.org` (Hostinger) | ✅ purchased |
| **DNS** | Cloudflare (zone `38496b13e7cad03a7797633c654683ee`) | ⏳ propagating |
| **Compute** | Cloudflare Workers | ⏳ pending `wrangler deploy` |
| **Database** | Cloudflare D1 (SQLite) | ⏳ pending `wrangler d1 create` |
| **Object storage** | Cloudflare R2 (bucket `style-mitgalgel-photos`) | ⏳ pending `wrangler r2 bucket create` |
| **Auth OTP** | WhatsApp Baileys bot (972504247932 — listener) | ✅ running, `/send-otp` endpoint |

## DNS migration log

**From:** Hostinger DNS (`ns1.dns-parking.com`, `ns2.dns-parking.com`)
**To:** Cloudflare (`hasslo.ns.cloudflare.com`, `ligia.ns.cloudflare.com`)

Records preserved during import:
- MX → `mx1.hostinger.com`, `mx2.hostinger.com`
- TXT → SPF, DMARC, Brevo verification
- CNAMEs → Brevo DKIM, Hostinger mail DKIM

Records that will need to change after Worker deploy:
- `rollingstyle.org` A → (remove, replaced by Worker custom-domain binding)
- `www.rollingstyle.org` CNAME `base44.onrender.com` → (remove)

## Setup commands (run once)

```bash
cd D:/yupoo/style-mitgalgel
npm install
npx wrangler login

# DB
npx wrangler d1 create style_mitgalgel
# → paste database_id into wrangler.toml

# Storage
npx wrangler r2 bucket create style-mitgalgel-photos

# Schema
npx wrangler d1 execute style_mitgalgel --remote --file=schema.sql

# Deploy
npx wrangler deploy

# Custom domain
# → Cloudflare Dashboard → Workers → style-mitgalgel → Triggers → Add Custom Domain → rollingstyle.org
```

## Environment / secrets

`wrangler.toml` → `[vars]` section:

| Key | Example value |
|---|---|
| `WHATSAPP_BOT_URL` | `https://bot.internal/send-otp` (POST `{ phone, message }`) |
| `SITE_NAME` | `סטייל מתגלגל` |

The Baileys bot (`pinterest-bot/whatsapp-baileys/bot.js`) needs a new `/send-otp` HTTP listener that forwards `phone` + `message` to WhatsApp.

## Smoke test after deploy

1. `curl https://rollingstyle.org/` → returns `index.html` with DEMO banner off
2. `curl https://rollingstyle.org/api/items` → `{ "items": [], "page": 1, "has_more": false }`
3. Upload a test item from `/upload.html` with phone `972...` → OTP arrives in WhatsApp → item visible on homepage
4. Open `/item.html?id=1` → WhatsApp link opens chat with seller's phone

## Rollback

To revert rollingstyle.org to the Base44 site: switch Hostinger nameservers back to `ns1.dns-parking.com` / `ns2.dns-parking.com`. Original DNS records were preserved in Cloudflare and also exist in Hostinger DNS history.
