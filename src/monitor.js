// Marketplace monitor: fetches shop/listing pages, extracts every product
// image, fingerprints them and compares against the artist's registered
// works. Watched pages are re-scanned on a schedule and the artist is
// e-mailed when new copies are found.
import { safeFetch, validateUrl, userAgent } from './fetcher.js';
import { fingerprint, sha256, SUSPECT_CROPS } from './imaging.js';
import { stampDigest } from './timestamp.js';
import { extractImageUrls, detectBlock, isShopify, shopifyJsonUrl, shopifyImages, normaliseImage } from './extract.js';
import { now } from './db.js';

export { extractImageUrls };

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

  const matchHooks = [];

  /**
   * Checks one image against registered artworks and records matches.
   * With a userId only that artist's works are compared (their own monitor);
   * without one, every publicly visible work is (repeat-offender scans).
   */
  function recordMatches(userId, pageUrl, imageUrl, buf, fp, source = 'monitor') {
    const hits = userId ? artworks.findMatches(fp, { userId }) : artworks.findMatches(fp);
    const created = [];
    const evidence = sha256(buf);
    for (const h of hits) {
      const t = now();
      const r = db.run(
        `INSERT INTO matches (user_id, artwork_id, page_url, image_url, distance, evidence_sha256, found_at, updated_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(artwork_id, image_url) DO NOTHING`,
        h.user_id, h.id, pageUrl, imageUrl, h.distance, evidence, t, t, source,
      );
      if (r.changes)
        created.push({ id: Number(r.lastInsertRowid), userId: h.user_id, artworkId: h.id, imageUrl, pageUrl, distance: h.distance, verified: true });
    }
    return { hits, created };
  }

  /** Lets other modules react to new matches (offender tracking, hot mode). */
  async function emitMatches(created, ctx = {}) {
    if (!created.length) return;
    for (const fn of matchHooks) {
      try {
        await fn(created, ctx);
      } catch (e) {
        log.warn?.('[monitor] match hook failed:', e.message);
      }
    }
  }

  /** E-mails each affected artist about their own new matches. */
  async function notifyAll(created) {
    const byUser = new Map();
    for (const c of created) byUser.set(c.userId, [...(byUser.get(c.userId) || []), c]);
    for (const [userId, list] of byUser) await notify(userId, list);
  }

  const opts = (extra) => ({ ...fetchOpts, ua: userAgent(cfg.baseUrl), ...extra });

  /** Finds the product image URLs for a page (HTML, Shopify JSON or a direct image). */
  async function imagesFor(rawUrl) {
    const page = await safeFetch(validateUrl(rawUrl, fetchOpts).href, opts({ maxBytes: 6 * 1024 * 1024, accept: 'text/html,image/*;q=0.9,*/*;q=0.5' }));
    const blocked = detectBlock(page);
    if (blocked) throw blocked;
    if (page.status >= 400) throw new Error(`The page answered with HTTP ${page.status}.`);
    if (/^image\//i.test(page.contentType)) return { page, imageUrls: [page.url], direct: page.body, source: 'image' };

    if (isShopify(page)) {
      try {
        const res = await safeFetch(shopifyJsonUrl(page.url), opts({ maxBytes: 8 * 1024 * 1024, accept: 'application/json' }));
        const urls = res.status === 200 ? shopifyImages(JSON.parse(res.body.toString('utf8'))) : [];
        if (urls.length) {
          const seen = new Set();
          const imageUrls = urls
            .map((u) => normaliseImage(new URL(u, page.url).href))
            .filter(({ key }) => !seen.has(key) && seen.add(key))
            .map(({ url }) => url)
            .slice(0, 250);
          return { page, imageUrls, source: 'shopify' };
        }
      } catch {
        /* fall back to HTML extraction */
      }
    }
    return { page, imageUrls: extractImageUrls(page.body.toString('utf8'), page.url), source: 'html' };
  }

  const fetchImage = async (url) => {
    const r = await safeFetch(url, opts({ maxBytes: 15 * 1024 * 1024, accept: 'image/avif,image/webp,image/*' }));
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return r.body;
  };

  /**
   * Downloads and checks a list of images: [{ pageUrl, imageUrl, buf? }].
   * Returns counts plus the matches created (not yet notified).
   */
  async function checkImages(items, { userId = null, source = 'monitor' } = {}) {
    let checked = 0;
    let failed = 0;
    const created = [];
    const hits = [];
    await pool(items, 6, async (it) => {
      try {
        const buf = it.buf ?? (await fetchImage(it.imageUrl));
        const fp = await fingerprint(buf, SUSPECT_CROPS);
        checked++;
        const r = recordMatches(userId, it.pageUrl, it.imageUrl, buf, fp, source);
        created.push(...r.created);
        hits.push(...r.hits.map((h) => ({ ...h, imageUrl: it.imageUrl })));
      } catch {
        failed++;
      }
    });
    return { checked, failed, created, hits };
  }

  async function scan(userId, rawUrl, { source = 'monitor' } = {}) {
    const { page, imageUrls, direct, source: via } = await imagesFor(rawUrl);
    if (!imageUrls.length)
      throw new Error(
        'No product images were found in the page. It is probably built with JavaScript in the browser ' +
          '(Temu search pages are, for example). Try the URLs of individual product pages instead.',
      );
    const items = imageUrls.map((imageUrl) => ({ pageUrl: page.url, imageUrl, buf: direct ?? undefined }));
    const r = await checkImages(items, { userId, source });
    if (!r.checked && r.failed) throw new Error(`Found ${r.failed} images, but none could be downloaded. The image server may block automated access.`);
    const html = /^text\/html/i.test(page.contentType) ? page.body.toString('utf8') : '';
    await emitMatches(r.created, { html, pageUrl: page.url });
    return { pageUrl: page.url, found: imageUrls.length, ...r, source: via };
  }

  async function notify(userId, created) {
    if (!created.length) return;
    const user = db.one('SELECT email, display_name FROM users WHERE id = ?', userId);
    const lines = created.map((c) => `- ${artworks.get(c.artworkId)?.title ?? c.artworkId}: ${c.pageUrl}`);
    await mailer.send({
      to: user.email,
      subject: `${cfg.siteName}: ${created.length} possible cop${created.length === 1 ? 'y' : 'ies'} of your work found`,
      text: `Hi ${user.display_name},\n\nWe found images that closely match your registered artworks:\n\n${lines.join('\n')}\n\nReview them and generate takedown notices here:\n${cfg.baseUrl}/dashboard/matches\n\n- ${cfg.siteName}`,
    });
  }

  async function scanWatch(w) {
    let status;
    try {
      const r = await scan(w.user_id, w.url);
      status = `OK - ${r.checked} image(s) checked, ${r.created.length} new match(es)`;
      await notify(w.user_id, r.created);
    } catch (e) {
      status = `${e.blocked ? 'Blocked' : 'Error'}: ${e.message}`;
    }
    db.run('UPDATE watches SET last_checked_at = ?, last_status = ? WHERE id = ?', now(), status, w.id);
    return status;
  }

  async function stampPending() {
    const rows = db.all(`SELECT id, sha256, ots_attempts FROM artworks WHERE ots_status IN ('queued','failed') AND ots_attempts < 12 LIMIT 20`);
    for (const r of rows) {
      try {
        const proof = await stampDigest(r.sha256, cfg.otsCalendars, { dispatcher: cfg.allowPrivateFetch ? null : undefined });
        db.run(`UPDATE artworks SET ots_status = 'pending', ots_proof = ?, ots_attempts = ots_attempts + 1 WHERE id = ?`, proof, r.id);
      } catch (e) {
        db.run(`UPDATE artworks SET ots_status = 'failed', ots_attempts = ots_attempts + 1 WHERE id = ?`, r.id);
        log.warn?.(`[ots] ${r.id}: ${e.message}`);
      }
    }
  }

  async function runDue() {
    const cutoff = new Date(Date.now() - cfg.rescanHours * 3600e3).toISOString();
    const due = db.all(
      `SELECT w.* FROM watches w JOIN users u ON u.id = w.user_id
       WHERE w.active = 1 AND u.suspended_at IS NULL AND (w.last_checked_at IS NULL OR w.last_checked_at < ?) LIMIT 50`,
      cutoff,
    );
    for (const w of due) await scanWatch(w);
    await stampPending();
    for (const job of jobs) await job();
  }

  const jobs = [];
  let timer = null;
  let running = false;
  return {
    scan,
    scanWatch,
    checkImages,
    emitMatches,
    notify,
    notifyAll,
    onMatches: (fn) => matchHooks.push(fn),
    recordMatches,
    stampPending,
    runDue,
    /** Extra work to run on each scheduler tick (e.g. web search). */
    addJob: (fn) => jobs.push(fn),
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
