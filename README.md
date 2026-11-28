# ARTGUARD

A portfolio and protection service for artists. Artists can show their work online without handing over a printable file.
They get independent proof of authorship, and the service finds copies on marketplaces and drafts the takedown notices.

## What it does

| | |
|---|---|
| **Original never exposed** | The full-resolution upload is stored privately and has no URL. Only a ≤1000 px, JPEG-compressed preview with a full-surface diagonal watermark is ever served. |
| **Copyright metadata** | EXIF `Artist`/`Copyright` with an explicit AI-training reservation. Original metadata such as GPS is stripped. |
| **AI-scraper blocking** | About 30 known AI and dataset crawlers get `403`. `robots.txt`, `ai.txt`, `X-Robots-Tag: noai` and TDMRep (`tdm-reservation: 1`, `/.well-known/tdmrep.json`) express the machine-readable reservation that disapplies the EU text-and-data-mining exception (Directive 2019/790 Art. 4(3)). |
| **Anti bulk download** | Image URLs are HMAC-signed and expire after 10 min. Previews and thumbnails use separate signatures. Scripting clients and headless browsers are refused on image routes. Requests are rate-limited per IP, and `Cross-Origin-Resource-Policy` stops hot-linking. |
| **Signed certificates** | Every registration is signed with the site's Ed25519 key. `/a/:id/certificate.json` can be verified by anyone against `/.well-known/signing-key.pem`. |
| **Blockchain timestamp** | The original's SHA-256 is submitted to public OpenTimestamps calendars and anchored in Bitcoin. The downloadable `.ots` proof is verifiable with the standard `ots` client and does not depend on this site existing. |
| **Verify** | `/verify` hashes a file *in the browser*, so the file itself is never uploaded, and confirms whether it is a registered original. |
| **Find copies** | Perceptual fingerprints (DCT pHash over several centre crops, mirrored variants and dHash) recognise resized, recompressed, recoloured, lightly cropped and mirrored copies, plus "poster in a frame" mock-ups. Anyone can check an image at `/check`. |
| **Marketplace monitor** | Artists add shop, listing or search-result URLs. The monitor extracts product images (og:image, JSON-LD, `img`/`srcset`/lazy attributes), compares them with the artist's works, re-scans every 24 h and e-mails new matches. |
| **Web search** | Reverse image search across the whole web through Google Cloud Vision (Web Detection) or TinEye. Artists opt in per artwork. Opted-in works are searched weekly, or on demand once a day. Every result is downloaded and checked with our own fingerprints before it becomes a match. Exact matches that cannot be downloaded are listed as *unverified*. There is a hard monthly cap on paid API calls. |
| **Repeat sellers** | When a copy is found, the seller's shop is remembered: an independent shop, Shopify store, Amazon seller storefront, Etsy shop or eBay seller. It is re-scanned every day for copies of *every* registered artist's work. A shop stops being scanned when all its matches are marked "Not a copy". Artists' own websites and image CDNs are never treated as shops. Admins can pause a shop under *Repeat sellers*. |
| **Close watch (hot mode)** | For a few weeks (`HOT_DAYS`, 28 by default), an artwork is searched daily instead of weekly. This turns on by itself when a copy is found or the artwork gets `HOT_VIEW_THRESHOLD` views on ARTGUARD in three days, and the artist can also switch it on. Views are counted once per visitor per day, and the artist's own views are excluded. |
| **New marketplace listings** | The newest Etsy listings (Open API v3, keyword search sorted by creation date) and eBay listings (Browse API image search plus newest-first keyword search) are checked every 3 days, or daily on close watch. Keywords are set per artwork and default to the title. eBay image search only runs for artworks with web-search consent. There are daily API caps per provider. |
| **Takedowns** | Each match has a DMCA (17 U.S.C. § 512(c)(3)) or EU DSA (Art. 16) notice, pre-filled with the artist's details and evidence. It links to the right reporting channel for Etsy, Amazon, Temu, Shopify and Redbubble, or to a generic guide. Status workflow: new → confirmed → reported → removed / dismissed. |
| **Anti claim-jacking** | A work that is already registered by someone else, either as the exact file or a perceptual match, cannot be registered again. Anyone can report a false claim. |
| **Moderation** | An admin area for false-claim disputes. Upholding a dispute hides the work (which lets the real author register it) and can also suspend the owner. Rejecting keeps the work. Both parties are e-mailed. There is also user search, suspend/lift, hide, unhide and delete for artworks, and an audit log of every action. Hidden works and suspended accounts disappear from the gallery, profiles, images, certificates, "Find copies" and the monitor. |
| **Plans and billing** | Free, Artist and Studio plans (`src/plans.js`) limit artworks, monitored pages, works on close watch, web-search frequency and marketplace searches. Limits apply both when adding things and in the scheduler. Payments use Stripe Checkout, and the Stripe Customer Portal handles plan changes, card updates, receipts and cancellation. Webhooks are signature-verified and idempotent. A downgrade never deletes anything. Admins can grant a plan for free, and `BETA_PLAN` grants one to every new account. |
| **E-mail verification** | A confirmation link (valid 48 h) is sent at signup and can be resent. A confirmed address is required to pay, to receive any e-mail alert, and to generate takedown notices (they give the artist's address as contact). Changing e-mail only takes effect once the new address is confirmed. A password reset also confirms the address. |
| **Accounts** | Sign-up and sign-in (scrypt), sessions, password reset by e-mail, public artist profiles, unlisted works, and account deletion that removes every file. |

### What it cannot do

Anything visible on a screen can be photographed. The goal is to make the copy that *can* be taken useless for printing, make
scraping hard and legally unambiguous, give artists strong evidence, and automate finding and reporting infringements.
Perceptual matching will miss heavy edits, large crops and works shown small inside busy photos.

## Running

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restart on file changes
npm test           # 87 unit and integration tests
```

Configuration is done with environment variables. See [`.env.example`](.env.example). For production:

```bash
docker build -t artguard .
docker run -p 3000:3000 -v artguard-data:/data --env-file .env artguard
```

Put it behind HTTPS (Caddy, nginx or Cloudflare) and set `BASE_URL` and `TRUST_PROXY`. **Back up the data volume.** It holds
the SQLite database, the originals and the signing key in `keys/`. Losing the key means new certificates cannot be
issued under the same identity. Existing ones stay verifiable with the published public key.

## Billing setup (Stripe)

1. In Stripe, create the products **Artist** and **Studio**, each with a monthly and a yearly recurring price matching `src/plans.js` (SEK 79/790 and SEK 199/1,990). Put the four price IDs in `STRIPE_PRICE_*`.
2. Add a webhook endpoint `https://<your domain>/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Configure the **Customer Portal**: allow cancelling, updating the payment method and invoice history, and allow switching between the four prices.
4. Set `STRIPE_SECRET_KEY`. Test everything with test-mode keys and the Stripe CLI (`stripe listen --forward-to localhost:3000/stripe/webhook`) before going live.
5. Taxes (VAT) and the EU right of withdrawal for digital services are **not** handled in code. Decide with an accountant or lawyer whether to turn on Stripe Tax, and adjust the terms.

During a beta, `BETA_PLAN=artist` gives every new account the Artist plan for free. Promotion codes created in Stripe can be entered at checkout.

## Administration

Admin rights are granted from the command line only. They are never granted by e-mail address, since addresses are not verified:

```bash
node scripts/admin.js grant you@example.com   # then sign in and open /admin
node scripts/admin.js revoke you@example.com
node scripts/admin.js list
```

Admins and `ADMIN_EMAIL` receive an e-mail for every new dispute.

## Marketplace monitor: live results (Nov 2026)

The monitor identifies itself as `ArtguardMonitor/1.0` (explained at `/bot`) and never disguises itself as a browser. When a site blocks it, the page is reported as **Blocked** and the artist is pointed to "Find copies" or the platform's report form.

| Site | Result |
|---|---|
| Amazon search and product pages | ✅ Works. 47 product images checked on a search page in about 4 s. A planted copy was found at distance 0 with no false positives. |
| Shopify stores | ✅ Read through the store's public product JSON (`/products/<handle>.json`, `/collections/<x>/products.json`). |
| Temu | ⚠️ Search pages are rendered in the browser and contain no product images. Individual product URLs may work. |
| Etsy | ⛔ Captcha (DataDome) for automated clients. Reported as blocked. |
| Redbubble | ⛔ Cloudflare challenge. Reported as blocked. |
| OpenTimestamps | ✅ Real proofs created. The official `ots info` client reads them. |

Etsy and eBay are covered through their official APIs (see below), not by scraping.

If your server can only reach the internet through a proxy, set `OUTBOUND_PROXY=http://proxy:port`. Node's `fetch` does not follow `HTTPS_PROXY` by itself.

## Security notes

- CSRF protection: double-submit token on every form, plus an `Origin` check. Session cookies are `HttpOnly; SameSite=Lax` (`Secure` on https).
- Strict CSP (`script-src 'self'`, no inline script), `X-Frame-Options: DENY`, HSTS in production.
- All HTML output goes through an auto-escaping template tag (`src/html.js`).
- The monitor's outbound fetches only allow http(s) on ports 80/443. They re-validate every redirect, cap response size, and refuse to *connect* to private, loopback or link-local addresses at DNS-resolution time, which defeats SSRF and DNS rebinding.
- Pages from other sites are never embedded. Found images are linked, not displayed.

## Structure

```
src/
  app.js          routes (public, auth, dashboard)
  server.js       entry point
  config.js       environment configuration
  db.js           SQLite schema and migrations
  security.js     passwords, sessions, CSRF, security headers
  antiscrape.js   bot blocking, opt-out headers, rate limiting, signed URLs
  imaging.js      preview, watermark, EXIF, fingerprints, matching
  artworks.js     registration, storage, claim-jacking guard
  timestamp.js    Ed25519 certificates, OpenTimestamps
  monitor.js      page scanning, image extraction, scheduler, alerts
  fetcher.js      SSRF-safe HTTP client
  takedown.js     DMCA / DSA notices, platform channels
  marketplaces.js Etsy Open API v3 and eBay Browse API clients, daily API caps
  offenders.js    repeat sellers: shop derivation and daily re-scans
  discovery.js    close watch (hot mode), view counting, marketplace sweeps
  plans.js        plan definitions and limits
  billing.js      Stripe Checkout, Customer Portal, webhooks
  emailverify.js  e-mail confirmation and address changes
  websearch.js    reverse image search (Google Vision / TinEye), verification, budget
  extract.js      product-image extraction, CDN normalisation, block detection, Shopify
  admin.js        moderation routes
  mailer.js       SMTP (or console when not configured)
  views/          HTML views
public/           CSS, progressive-enhancement JS, favicon
scripts/admin.js  grant/revoke admin rights
test/             unit and integration tests (fake shop and fake OTS calendar)
```

## Roadmap ideas

- Invisible, screenshot-robust watermark (e.g. TrustMark) to read an artwork ID out of a stolen image.
- C2PA Content Credentials embedded in previews.
- An embedding-based index (CLIP) for heavier crops and mock-ups, and a vector index once the catalogue grows.
- Optional adversarial cloaking against style mimicry.
