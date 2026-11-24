// Marketplace monitor: fetches shop/listing pages, extracts every product
// image, fingerprints them and compares against the artist's registered
// works. Watched pages are re-scanned on a schedule and the artist is
// e-mailed when new copies are found.
import { safeFetch, validateUrl } from './fetcher.js';
import { fingerprint, sha256, SUSPECT_CROPS } from './imaging.js';
import { stampDigest } from './timestamp.js';
import { now } from './db.js';

const MAX_IMAGES_PER_PAGE = 60;
const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\\//g, '/');

/** Pulls candidate product-image URLs out of an HTML page. */
export function extractImageUrls(htmlText, base) {
  const found = [];
  const push = (u) => {
    if (!u) return;
    try {
      const abs = new URL(decode(u.trim()), base);
      if (/^https?:$/.test(abs.protocol) && !/\.(svg|ico|gif)(\?|$)/i.test(abs.pathname)) found.push(abs.href);
    } catch {
      /* ignore */
    }
  };
  // Social/meta images first: on product pages these are the main product photo.
  for (const m of htmlText.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi))
    push(m[0].match(/content=["']([^"']+)["']/i)?.[1]);
  for (const m of htmlText.matchAll(/<link[^>]+rel=["']image_src["'][^>]*>/gi)) push(m[0].match(/href=["']([^"']+)["']/i)?.[1]);
  // JSON-LD / inline JSON "image" fields (Shopify, Etsy, Amazon, WooCommerce)
  for (const m of htmlText.matchAll(/"image"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
    for (const u of m[1].matchAll(/"(https?:[^"]+|\/\/[^"]+)"/g)) push(u[1]);
  }
  for (const m of htmlText.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    for (const attr of ['data-zoom-image', 'data-old-hires', 'data-large_image', 'data-full', 'data-src', 'src']) {
      const v = tag.match(new RegExp(`\\s${attr}=["']([^"']+)["']`, 'i'))?.[1];
      if (v && !v.startsWith('data:')) {
        push(v);
        break;
      }
    }
    const srcset = tag.match(/\s(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
    if (srcset) {
      // take the largest candidate
      const last = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
      push(last);
    }
  }
  return [...new Set(found)].slice(0, MAX_IMAGES_PER_PAGE);
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export function createMonitor({ db, cfg, artworks, mailer, log = console }) {
  const fetchOpts = { allowPrivate: !!cfg.allowPrivateFetch };

  /** Check one image buffer against a user's artworks and record matches. */
  function recordMatches(userId, pageUrl, imageUrl, buf, fp) {
    const hits = artworks.findMatches(fp, { userId });
    const created = [];
    const evidence = sha256(buf);
    for (const h of hits) {
      const t = now();
      const r = db.run(
        `INSERT INTO matches (user_id, artwork_id, page_url, image_url, distance, evidence_sha256, found_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(artwork_id, image_url) DO NOTHING`,
        userId, h.id, pageUrl, imageUrl, h.distance, evidence, t, t,
      );
      if (r.changes) created.push({ id: Number(r.lastInsertRowid), artworkId: h.id, imageUrl, pageUrl, distance: h.distance });
    }
    return { hits, created };
  }

  async function scan(userId, rawUrl) {
    const page = await safeFetch(validateUrl(rawUrl, fetchOpts).href, { ...fetchOpts, maxBytes: 4 * 1024 * 1024, accept: 'text/html,image/*;q=0.9,*/*;q=0.5' });
    if (page.status >= 400) throw new Error(`The page answered with HTTP ${page.status}.`);
    let imageUrls;
    let direct = null;
    if (/^image\//i.test(page.contentType)) {
      imageUrls = [page.url];
      direct = page.body;
    } else {
      imageUrls = extractImageUrls(page.body.toString('utf8'), page.url);
    }
    let checked = 0;
    let failed = 0;
    const created = [];
    const hits = [];
    await pool(imageUrls, 4, async (imgUrl) => {
      try {
        const buf =
          direct ??
          (await safeFetch(imgUrl, { ...fetchOpts, maxBytes: 15 * 1024 * 1024, accept: 'image/avif,image/webp,image/*' })).body;
        const fp = await fingerprint(buf, SUSPECT_CROPS);
        checked++;
        const r = recordMatches(userId, page.url, imgUrl, buf, fp);
        created.push(...r.created);
        hits.push(...r.hits.map((h) => ({ ...h, imageUrl: imgUrl })));
      } catch {
        failed++;
      }
    });
    return { pageUrl: page.url, found: imageUrls.length, checked, failed, created, hits };
  }

  async function notify(userId, created) {
    if (!created.length) return;
    const user = db.one('SELECT email, display_name FROM users WHERE id = ?', userId);
    const lines = created.map((c) => `- ${artworks.get(c.artworkId)?.title ?? c.artworkId}: ${c.pageUrl}`);
    await mailer.send({
      to: user.email,
      subject: `${cfg.siteName}: ${created.length} possible cop${created.length === 1 ? 'y' : 'ies'} of your work found`,
      text: `Hi ${user.display_name},\n\nOur monitor found images that closely match your registered artworks:\n\n${lines.join('\n')}\n\nReview them and generate takedown notices here:\n${cfg.baseUrl}/dashboard/matches\n\n- ${cfg.siteName}`,
    });
  }

  async function scanWatch(w) {
    let status;
    try {
      const r = await scan(w.user_id, w.url);
      status = `OK - ${r.checked} image(s) checked, ${r.created.length} new match(es)`;
      await notify(w.user_id, r.created);
    } catch (e) {
      status = `Error: ${e.message}`;
    }
    db.run('UPDATE watches SET last_checked_at = ?, last_status = ? WHERE id = ?', now(), status, w.id);
    return status;
  }

  async function stampPending() {
    const rows = db.all(`SELECT id, sha256, ots_attempts FROM artworks WHERE ots_status IN ('queued','failed') AND ots_attempts < 12 LIMIT 20`);
    for (const r of rows) {
      try {
        const proof = await stampDigest(r.sha256, cfg.otsCalendars);
        db.run(`UPDATE artworks SET ots_status = 'pending', ots_proof = ?, ots_attempts = ots_attempts + 1 WHERE id = ?`, proof, r.id);
      } catch (e) {
        db.run(`UPDATE artworks SET ots_status = 'failed', ots_attempts = ots_attempts + 1 WHERE id = ?`, r.id);
        log.warn?.(`[ots] ${r.id}: ${e.message}`);
      }
    }
  }

  async function runDue() {
    const cutoff = new Date(Date.now() - cfg.rescanHours * 3600e3).toISOString();
    const due = db.all('SELECT * FROM watches WHERE active = 1 AND (last_checked_at IS NULL OR last_checked_at < ?) LIMIT 50', cutoff);
    for (const w of due) await scanWatch(w);
    await stampPending();
  }

  let timer = null;
  let running = false;
  return {
    scan,
    scanWatch,
    notify,
    recordMatches,
    stampPending,
    runDue,
    start(intervalMs = 15 * 60 * 1000) {
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          await runDue();
        } catch (e) {
          log.error?.('[monitor]', e);
        } finally {
          running = false;
        }
      };
      timer = setInterval(tick, intervalMs);
      timer.unref();
      setTimeout(tick, 5000).unref();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
