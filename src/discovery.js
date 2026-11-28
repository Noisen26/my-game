// Finding new listings fast:
//  - Hot mode: an artwork that is trending on ARTGUARD, that has just been
//    copied, or that the artist marks as trending is searched daily instead
//    of weekly for a few weeks. That is when print-on-demand scrapers strike.
//  - Marketplace sweeps: the newest Etsy and eBay listings are searched
//    through their official APIs (keywords on Etsy; image + keywords on eBay)
//    and every result is verified with our own fingerprints.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { now } from './db.js';
import { PLANS, planSql } from './plans.js';

const DAY = 864e5;
const isHot = (a) => !!a.hot_until && a.hot_until > now();

/** Keyword phrases for marketplace searches: artist's keywords, else the title. */
export function phrasesFor(a) {
  const own = String(a.keywords || '')
    .split(/[,\n;]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length >= 3);
  return [...new Set(own.length ? own : [a.title])].slice(0, 3);
}

export function createDiscovery({ db, cfg, artworks, monitor, mailer, etsy, ebay, log = console }) {
  // ---------------------------------------------------------------- hot mode
  function setHot(artworkId, reason, days = cfg.hotDays) {
    // Each plan allows a number of works on close watch at the same time.
    const o = db.one('SELECT u.plan, u.id FROM artworks a JOIN users u ON u.id = a.user_id WHERE a.id = ?', artworkId);
    if (!o) return false;
    const others = db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ? AND id != ? AND hot_until > ?', o.id, artworkId, now()).n;
    if (others >= (PLANS[o.plan] || PLANS.free).hot) return false;
    const until = new Date(Date.now() + days * DAY).toISOString();
    const r = db.run(
      'UPDATE artworks SET hot_until = ?, hot_reason = ? WHERE id = ? AND (hot_until IS NULL OR hot_until < ?)',
      until, reason, artworkId, until,
    );
    return r.changes > 0 || !!db.one('SELECT 1 FROM artworks WHERE id = ? AND hot_until >= ?', artworkId, until);
  }
  const clearHot = (artworkId) => db.run(`UPDATE artworks SET hot_until = NULL, hot_reason = '' WHERE id = ?`, artworkId);

  // A first verified copy usually means more are coming: watch closely.
  monitor.onMatches(async (created) => {
    for (const id of new Set(created.filter((c) => c.verified !== false).map((c) => c.artworkId))) setHot(id, 'copy found');
  });

  // ---------------------------------------------------------------- views
  const seen = new Set();
  let seenDay = '';
  function recordView(artworkId, ip) {
    const day = now().slice(0, 10);
    if (day !== seenDay) {
      seen.clear();
      seenDay = day;
    }
    const key = createHash('sha256').update(`${day}|${ip}|${artworkId}`).digest('base64url').slice(0, 16);
    if (seen.has(key)) return;
    seen.add(key);
    db.run('INSERT INTO artwork_views (artwork_id, day, n) VALUES (?, ?, 1) ON CONFLICT(artwork_id, day) DO UPDATE SET n = n + 1', artworkId, day);
  }

  async function checkTrending() {
    const since = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    const rows = db.all(
      `SELECT v.artwork_id id, SUM(v.n) views FROM artwork_views v JOIN artworks a ON a.id = v.artwork_id
       WHERE v.day >= ? AND (a.hot_until IS NULL OR a.hot_until < ?) GROUP BY v.artwork_id HAVING views >= ?`,
      since, now(), cfg.hotViewThreshold,
    );
    for (const { id, views } of rows) {
      if (!setHot(id, 'trending')) continue;
      const a = artworks.get(id);
      const owner = db.one('SELECT email, display_name, email_verified_at FROM users WHERE id = ?', a.user_id);
      if (!owner.email_verified_at) continue;
      await mailer.send({
        to: owner.email,
        subject: `${cfg.siteName}: "${a.title}" is trending, so we're watching it closely`,
        text: `Hi ${owner.display_name},\n\n"${a.title}" had ${views} views in the last three days. Trending work is what print-on-demand ` +
          `scrapers copy, so for the next ${cfg.hotDays} days we search for copies of it every day instead of every week.\n\n` +
          `${cfg.baseUrl}/dashboard/artworks/${a.id}\n\n- ${cfg.siteName}`,
      });
    }
    return rows.length;
  }

  // ---------------------------------------------------------------- marketplace sweeps
  const enabled = !!(etsy || ebay);

  async function queryImage(a) {
    return sharp(await readFile(artworks.originalPath(a)), { failOn: 'error', limitInputPixels: 200_000_000 })
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  async function searchMarketplaces(artworkId) {
    const a = artworks.get(artworkId);
    if (!a) throw new Error('Artwork not found');
    const items = [];
    const errors = [];
    const phrases = phrasesFor(a);
    const run = async (label, fn) => {
      try {
        for (const it of await fn()) for (const imageUrl of it.imageUrls) items.push({ pageUrl: it.pageUrl, imageUrl, source: label });
      } catch (e) {
        errors.push(e.message);
      }
    };
    if (etsy) for (const q of phrases) await run('etsy', () => etsy.searchNewest(q));
    if (ebay) {
      // Image search sends a downscaled copy to eBay: only for artists who opted in to web search.
      if (a.web_search) await run('ebay', async () => ebay.searchByImage(await queryImage(a)));
      for (const q of phrases) await run('ebay', () => ebay.searchNewest(q));
    }
    const seenUrls = new Set();
    const unique = items.filter((i) => !seenUrls.has(i.imageUrl) && seenUrls.add(i.imageUrl));
    const created = [];
    let checked = 0;
    for (const source of ['etsy', 'ebay']) {
      const part = unique.filter((i) => i.source === source);
      if (!part.length) continue;
      const r = await monitor.checkImages(part, { userId: a.user_id, source });
      checked += r.checked;
      created.push(...r.created);
    }
    await monitor.emitMatches(created);
    await monitor.notifyAll(created);
    const status = `${errors.length && !checked ? 'Error' : 'OK'} - ${unique.length} listing image(s), ${checked} checked, ${created.length} new match(es)` +
      (errors.length ? ` (${errors.join('; ')})` : '');
    db.run('UPDATE artworks SET last_market_search_at = ?, last_market_status = ? WHERE id = ?', now(), status, a.id);
    return { checked, created, errors, status };
  }

  async function marketplaceDue(limit = 20) {
    if (!enabled) return 0;
    const t = Date.now();
    const normal = new Date(t - cfg.marketSearchIntervalDays * DAY).toISOString();
    const hot = new Date(t - DAY + 5 * 60e3).toISOString();
    const due = db.all(
      `SELECT a.id FROM artworks a JOIN users u ON u.id = a.user_id
       WHERE a.hidden_at IS NULL AND u.suspended_at IS NULL AND ${planSql('marketplaces')} = 1
         AND (a.last_market_search_at IS NULL
              OR a.last_market_search_at < CASE WHEN a.hot_until > ? THEN ? ELSE ? END)
       ORDER BY (a.hot_until > ?) DESC, a.last_market_search_at IS NOT NULL, a.last_market_search_at LIMIT ?`,
      now(), hot, normal, now(), limit,
    );
    let n = 0;
    for (const { id } of due) {
      const r = await searchMarketplaces(id);
      n++;
      if (r.errors.some((e) => /daily API limit/.test(e))) break;
    }
    return n;
  }

  return { enabled, isHot, setHot, clearHot, recordView, checkTrending, searchMarketplaces, marketplaceDue, providers: [etsy?.name, ebay?.name].filter(Boolean) };
}
