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
| **Takedowns** | Each match has a DMCA (17 U.S.C. § 512(c)(3)) or EU DSA (Art. 16) notice, pre-filled with the artist's details and evidence. It links to the right reporting channel for Etsy, Amazon, Temu, Shopify and Redbubble, or to a generic guide. Status workflow: new → confirmed → reported → removed / dismissed. |
| **Anti claim-jacking** | A work that is already registered by someone else, either as the exact file or a perceptual match, cannot be registered again. Anyone can report a false claim. |
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
npm test           # 32 unit and integration tests
```

Configuration is done with environment variables. See [`.env.example`](.env.example). For production:

```bash
docker build -t artguard .
docker run -p 3000:3000 -v artguard-data:/data --env-file .env artguard
```

Put it behind HTTPS (Caddy, nginx or Cloudflare) and set `BASE_URL` and `TRUST_PROXY`. **Back up the data volume.** It holds
the SQLite database, the originals and the signing key in `keys/`. Losing the key means new certificates cannot be
issued under the same identity. Existing ones stay verifiable with the published public key.

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
  mailer.js       SMTP (or console when not configured)
  views/          HTML views
public/           CSS, progressive-enhancement JS, favicon
test/             unit and integration tests (fake shop and fake OTS calendar)
```

## Roadmap ideas

- Reverse image search providers (e.g. TinEye API) so the monitor can discover shops without the artist supplying URLs.
- Invisible, screenshot-robust watermark (e.g. TrustMark) to read an artwork ID out of a stolen image.
- C2PA Content Credentials embedded in previews.
- An embedding-based index (CLIP) for heavier crops and mock-ups, and a vector index once the catalogue grows.
- Optional adversarial cloaking against style mimicry.
- Admin view for disputes, and paid plans (monitoring volume).
