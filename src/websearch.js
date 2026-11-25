// Automatic reverse image search: finds copies of an artwork anywhere on the
// web, without the artist having to supply shop URLs.
//
// Providers (official APIs only):
//   google  - Google Cloud Vision "Web Detection" (GOOGLE_VISION_API_KEY)
//   tineye  - TinEye API (TINEYE_API_KEY)
//
// Every candidate the provider returns is downloaded and verified with our
// own perceptual fingerprints before it becomes a match, so "visually
// similar" suggestions never turn into false alarms. Exact matches the
// provider reports but that cannot be downloaded (blocked CDNs) are kept as
// "unverified" so the artist can check them by hand.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fetch } from 'undici';
import { safeFetch, userAgent, apiDispatcher } from './fetcher.js';
import { fingerprint, distance, sha256, SUSPECT_CROPS, MATCH_THRESHOLD } from './imaging.js';
import { now } from './db.js';

const MAX_CANDIDATES = 40;

export class SearchError extends Error {}

// ------------------------------------------------------------------ providers

function googleProvider(cfg) {
  const endpoint = (cfg.visionEndpoint || 'https://vision.googleapis.com').replace(/\/$/, '');
  return {
    name: 'Google Cloud Vision',
    async search(jpeg) {
      const res = await fetch(`${endpoint}/v1/images:annotate`, {
        method: 'POST',
        dispatcher: apiDispatcher(),
        signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.googleVisionKey },
        body: JSON.stringify({
          requests: [{ image: { content: jpeg.toString('base64') }, features: [{ type: 'WEB_DETECTION', maxResults: 50 }] }],
        }),
      });
      const body = await res.json().catch(() => ({}));
      const err = body.error || body.responses?.[0]?.error;
      if (!res.ok || err) throw new SearchError(`Google Vision: ${err?.message || `HTTP ${res.status}`}`);
      return parseGoogle(body.responses?.[0]?.webDetection || {});
    },
  };
}

export function parseGoogle(wd) {
  const out = [];
  for (const p of wd.pagesWithMatchingImages || []) {
    for (const img of p.fullMatchingImages || []) out.push({ pageUrl: p.url, imageUrl: img.url, full: true, title: p.pageTitle });
    for (const img of p.partialMatchingImages || []) out.push({ pageUrl: p.url, imageUrl: img.url, full: false, title: p.pageTitle });
  }
  // Images without a known page: the image URL is the best location we have.
  for (const img of wd.fullMatchingImages || []) out.push({ pageUrl: img.url, imageUrl: img.url, full: true });
  for (const img of wd.partialMatchingImages || []) out.push({ pageUrl: img.url, imageUrl: img.url, full: false });
  // visuallySimilarImages are deliberately ignored: they are other works.
  return out;
}

function tineyeProvider(cfg) {
  const endpoint = (cfg.tineyeEndpoint || 'https://api.tineye.com').replace(/\/$/, '');
  return {
    name: 'TinEye',
    async search(jpeg) {
      const form = new FormData();
      form.append('image_upload', new Blob([jpeg], { type: 'image/jpeg' }), 'query.jpg');
      const res = await fetch(`${endpoint}/rest/search/?limit=100&backlink_limit=20&sort=score&order=desc`, {
        method: 'POST',
        dispatcher: apiDispatcher(),
        signal: AbortSignal.timeout(30_000),
        headers: { 'x-api-key': cfg.tineyeKey },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || (body.code && body.code !== 200))
        throw new SearchError(`TinEye: ${(body.messages || []).join(' ') || `HTTP ${res.status}`}`);
      return parseTineye(body);
    },
  };
}

export function parseTineye(body) {
  const out = [];
  for (const m of body.results?.matches || []) {
    const links = m.backlinks || [];
    if (!links.length && m.image_url) out.push({ pageUrl: m.image_url, imageUrl: m.image_url, full: true });
    for (const b of links) out.push({ pageUrl: b.backlink || b.url, imageUrl: b.url || m.image_url, full: true });
  }
  return out;
}

export function createProvider(cfg) {
  if (cfg.searchProvider === 'google' && cfg.googleVisionKey) return googleProvider(cfg);
  if (cfg.searchProvider === 'tineye' && cfg.tineyeKey) return tineyeProvider(cfg);
  return null;
}

// ------------------------------------------------------------------ runner

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export function createWebSearch({ db, cfg, artworks, monitor, provider = createProvider(cfg), log = console }) {
  const fetchOpts = { allowPrivate: !!cfg.allowPrivateFetch, ua: userAgent(cfg.baseUrl) };
  const month = () => now().slice(0, 7);

  const used = () => db.one('SELECT count FROM search_usage WHERE month = ?', month())?.count ?? 0;
  const remaining = () => Math.max(0, cfg.searchMonthlyLimit - used());
  const charge = () =>
    db.run('INSERT INTO search_usage (month, count) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET count = count + 1', month());

  /** The image sent to the provider: the original, downscaled, without our watermark (which would hurt matching). */
  async function queryImage(a) {
    const buf = await readFile(artworks.originalPath(a));
    return sharp(buf, { failOn: 'error', limitInputPixels: 200_000_000 })
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  function insert(a, c, dist, evidence, verified) {
    const t = now();
    const r = db.run(
      `INSERT INTO matches (user_id, artwork_id, page_url, image_url, distance, evidence_sha256, found_at, updated_at, source, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'search', ?) ON CONFLICT(artwork_id, image_url) DO NOTHING`,
      a.user_id, a.id, c.pageUrl, c.imageUrl, dist, evidence, t, t, verified ? 1 : 0,
    );
    return r.changes
      ? { id: Number(r.lastInsertRowid), userId: a.user_id, artworkId: a.id, pageUrl: c.pageUrl, imageUrl: c.imageUrl, distance: dist, verified }
      : null;
  }

  /** Searches the web for one artwork. Returns a summary; throws SearchError on provider/budget problems. */
  async function searchArtwork(artworkId) {
    if (!provider) throw new SearchError('Web search is not configured on this server.');
    const a = artworks.get(artworkId);
    if (!a) throw new SearchError('Artwork not found.');
    if (!remaining()) throw new SearchError("This month's web search budget has been used up. Searches resume next month.");

    const owner = db.one('SELECT website FROM users WHERE id = ?', a.user_id);
    const ignore = new Set([hostOf(cfg.baseUrl), hostOf(owner?.website || '')].filter(Boolean));
    const stored = { dhash: a.dhash, phashes: JSON.parse(a.phashes) };

    let candidates;
    try {
      const jpeg = await queryImage(a);
      charge();
      candidates = await provider.search(jpeg);
    } catch (e) {
      const status = `Error: ${e.message}`;
      db.run('UPDATE artworks SET last_searched_at = ?, last_search_status = ? WHERE id = ?', now(), status, a.id);
      throw e instanceof SearchError ? e : new SearchError(e.message);
    }

    // De-duplicate, drop our own site and the artist's own website, exact matches first.
    const seen = new Set();
    const list = candidates
      .filter((c) => c.imageUrl && /^https?:/i.test(c.imageUrl) && !ignore.has(hostOf(c.pageUrl)) && !ignore.has(hostOf(c.imageUrl)))
      .sort((x, y) => Number(y.full) - Number(x.full))
      .filter((c) => !seen.has(c.imageUrl) && seen.add(c.imageUrl))
      .slice(0, MAX_CANDIDATES);

    const created = [];
    let verified = 0;
    let unverified = 0;
    let rejected = 0;
    await pool(list, 6, async (c) => {
      let buf;
      try {
        const r = await safeFetch(c.imageUrl, { ...fetchOpts, maxBytes: 15 * 1024 * 1024, accept: 'image/avif,image/webp,image/*' });
        buf = r.status < 400 ? r.body : null;
      } catch {
        buf = null;
      }
      if (buf) {
        try {
          const d = distance(await fingerprint(buf, SUSPECT_CROPS), stored);
          if (d > MATCH_THRESHOLD) return void rejected++;
          verified++;
          const m = insert(a, c, d, sha256(buf), true);
          if (m) created.push(m);
          return;
        } catch {
          /* not an image we can read: fall through */
        }
      }
      if (!c.full) return void rejected++;
      unverified++;
      const m = insert(a, c, -1, '', false);
      if (m) created.push(m);
    });

    const status = `OK - ${candidates.length} result(s), ${verified} verified, ${unverified} unverified, ${created.length} new match(es)`;
    db.run('UPDATE artworks SET last_searched_at = ?, last_search_status = ? WHERE id = ?', now(), status, a.id);
    await monitor.emitMatches(created);
    await monitor.notify(a.user_id, created);
    return { results: candidates.length, verified, unverified, rejected, created, status };
  }

  /** Scheduled: searches artworks that opted in and are due, within budget. */
  async function searchDue(limit = 20) {
    if (!provider) return 0;
    const cutoff = new Date(Date.now() - cfg.searchIntervalDays * 864e5).toISOString();
    // Hot artworks (trending or just copied) are searched daily.
    const hotCutoff = new Date(Date.now() - 864e5 + 5 * 60e3).toISOString();
    const due = db.all(
      `SELECT a.id FROM artworks a JOIN users u ON u.id = a.user_id
       WHERE a.web_search = 1 AND a.hidden_at IS NULL AND u.suspended_at IS NULL
         AND (a.last_searched_at IS NULL OR a.last_searched_at < CASE WHEN a.hot_until > ? THEN ? ELSE ? END)
       ORDER BY (a.hot_until > ?) DESC, a.last_searched_at IS NOT NULL, a.last_searched_at LIMIT ?`,
      now(),
      hotCutoff,
      cutoff,
      now(),
      Math.min(limit, remaining()),
    );
    let n = 0;
    for (const { id } of due) {
      try {
        await searchArtwork(id);
        n++;
      } catch (e) {
        log.warn?.(`[websearch] ${id}: ${e.message}`);
        if (!remaining()) break;
      }
    }
    return n;
  }

  return {
    enabled: !!provider,
    providerName: provider?.name ?? null,
    used,
    remaining,
    searchArtwork,
    searchDue,
  };
}
