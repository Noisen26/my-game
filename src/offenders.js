// Repeat offenders. Sellers of stolen posters rarely stop at one work, so
// when a copy is found, the seller's shop is remembered and re-scanned every
// day for copies of ANY registered artist's work.
import { safeFetch, userAgent } from './fetcher.js';
import { now } from './db.js';

// Sites where the domain itself says nothing about the seller.
const MARKETPLACE = /(^|\.)(amazon\.[a-z.]+|etsy\.com|ebay\.[a-z.]+|temu\.com|redbubble\.com|aliexpress\.[a-z.]+|alibaba\.com|shein\.com|walmart\.com|wish\.com|teepublic\.com|society6\.com|zazzle\.[a-z.]+|displate\.com|threadless\.com|spreadshirt\.[a-z.]+|cafepress\.com|fineartamerica\.com|pinterest\.[a-z.]+|instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com|tumblr\.com|deviantart\.com|artstation\.com|behance\.net|google\.[a-z.]+|bing\.com|yandex\.[a-z.]+|myshopify\.com)$/i;
const SHOPIFY_SUBDOMAIN = /(^|\.)myshopify\.com$/i;
// Image CDNs and hosting: an image there says nothing about who sells it.
const IMAGE_HOST = /(^|\.)(etsystatic\.com|ebayimg\.com|media-amazon\.com|ssl-images-amazon\.com|kwcdn\.com|alicdn\.com|pinimg\.com|fbcdn\.net|cdninstagram\.com|googleusercontent\.com|gstatic\.com|cloudfront\.net|akamaized\.net|imgix\.net|cloudinary\.com|wp\.com|squarespace-cdn\.com|wixstatic\.com|redbubble\.net|imgur\.com|shopifycdn\.com)$|^cdn\.shopify\.com$/i;

const AMAZON_SELLER = [/[?&](?:me|seller|merchant|merchantId)=([A-Z0-9]{10,16})\b/, /"(?:merchantId|sellerId)"\s*:\s*"([A-Z0-9]{10,16})"/, /data-merchant-id="([A-Z0-9]{10,16})"/];

/** Works out which shop a page belongs to. Needs page HTML for Amazon, and API clients for Etsy and eBay. */
export async function deriveShop(pageUrl, { html = '', etsy, ebay, fetchHtml } = {}) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) {
    const find = (text) => AMAZON_SELLER.map((re) => text.match(re)?.[1]).find(Boolean);
    let id = find(u.search);
    if (!id && !html && fetchHtml && /\/(dp|gp\/product)\//.test(u.pathname)) html = await fetchHtml(pageUrl).catch(() => '');
    id = id || find(html || '');
    return id ? { kind: 'amazon', ref: id, url: `${u.origin}/s?me=${id}`, label: `Amazon seller ${id}` } : null;
  }

  if (host === 'etsy.com' || host.endsWith('.etsy.com')) {
    const listing = u.pathname.match(/\/listing\/(\d+)/)?.[1];
    if (!listing || !etsy) return null;
    const l = await etsy.listing(listing);
    if (!l?.shop_id) return null;
    let label = `Etsy shop ${l.shop_id}`;
    let url = `https://www.etsy.com/shop/${l.shop_id}`;
    try {
      const s = await etsy.shop(l.shop_id);
      if (s?.shop_name) label = `Etsy: ${s.shop_name}`;
      if (s?.url) url = s.url;
    } catch {
      /* label is cosmetic */
    }
    return { kind: 'etsy', ref: String(l.shop_id), url, label };
  }

  if (/(^|\.)ebay\.[a-z.]+$/.test(host)) {
    let seller = u.pathname.match(/^\/usr\/([^/?#]+)/)?.[1];
    const item = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/)?.[1];
    if (!seller && item && ebay) seller = (await ebay.itemByLegacyId(item))?.seller?.username;
    return seller ? { kind: 'ebay', ref: decodeURIComponent(seller), url: `https://www.ebay.com/usr/${seller}`, label: `eBay: ${decodeURIComponent(seller)}` } : null;
  }

  // Independent web shop (including Shopify stores on their own domain).
  if ((MARKETPLACE.test(host) && !SHOPIFY_SUBDOMAIN.test(host)) || IMAGE_HOST.test(host)) return null;
  if (!/^https?:$/.test(u.protocol)) return null;
  return { kind: 'web', ref: u.origin.toLowerCase(), url: `${u.origin}/`, label: host };
}

const hostOnly = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export function createOffenders({ db, cfg, monitor, etsy, ebay, log = console }) {
  const fetchOpts = { allowPrivate: !!cfg.allowPrivateFetch, ua: userAgent(cfg.baseUrl) };
  const ownHost = new URL(cfg.baseUrl).host;
  const fetchHtml = async (url) => {
    const r = await safeFetch(url, { ...fetchOpts, maxBytes: 6 * 1024 * 1024, accept: 'text/html' });
    return r.status < 400 ? r.body.toString('utf8') : '';
  };

  /** Called for every batch of new matches: remember the shops they were found in. */
  async function noteMatches(created, ctx = {}) {
    const byPage = new Map();
    for (const c of created) if (c.pageUrl && c.pageUrl !== c.imageUrl) byPage.set(c.pageUrl, [...(byPage.get(c.pageUrl) || []), c]);
    for (const [pageUrl, list] of byPage) {
      if (new URL(pageUrl).host === ownHost) continue;
      // Never treat an artist's own website as an offender.
      const ownSites = db
        .all(`SELECT website FROM users WHERE id IN (${list.map(() => '?').join(',')}) AND website != ''`, ...list.map((c) => c.userId))
        .map((u) => hostOnly(u.website));
      if (ownSites.includes(hostOnly(pageUrl))) continue;
      let shop;
      try {
        shop = await deriveShop(pageUrl, { html: ctx.pageUrl === pageUrl ? ctx.html : '', etsy, ebay, fetchHtml });
      } catch (e) {
        log.warn?.(`[offenders] ${pageUrl}: ${e.message}`);
      }
      if (!shop) continue;
      const t = now();
      db.run(
        `INSERT INTO offenders (kind, ref, url, label, first_seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind, ref) DO NOTHING`,
        shop.kind, shop.ref, shop.url, shop.label, t,
      );
      const o = db.one('SELECT id FROM offenders WHERE kind = ? AND ref = ?', shop.kind, shop.ref);
      for (const c of list) db.run('UPDATE matches SET offender_id = ? WHERE id = ? AND offender_id IS NULL', o.id, c.id);
      refresh(o.id);
    }
  }

  /** Recounts an offender's matches; a shop whose every match was dismissed stops being scanned. */
  function refresh(offenderId) {
    if (!offenderId) return;
    const n = db.one(`SELECT COUNT(*) n FROM matches WHERE offender_id = ? AND status != 'dismissed'`, offenderId).n;
    const o = db.one('SELECT active, last_status FROM offenders WHERE id = ?', offenderId);
    // A moderator's manual pause sticks; otherwise follow the matches.
    const paused = o && !o.active && o.last_status.startsWith('Paused by');
    db.run('UPDATE offenders SET match_count = ?, active = ? WHERE id = ?', n, paused ? 0 : n > 0 ? 1 : 0, offenderId);
  }

  async function scanOffender(o) {
    let status;
    try {
      let r;
      if (o.kind === 'etsy') {
        if (!etsy) throw new Error('Etsy API not configured');
        const items = (await etsy.shopListings(o.ref)).flatMap((it) => it.imageUrls.map((imageUrl) => ({ pageUrl: it.pageUrl, imageUrl })));
        r = await monitor.checkImages(items, { source: 'offender' });
        await monitor.emitMatches(r.created);
      } else if (o.kind === 'ebay') {
        if (!ebay) throw new Error('eBay API not configured');
        const items = (await ebay.searchNewest(null, { seller: o.ref, limit: 100 })).flatMap((it) => it.imageUrls.map((imageUrl) => ({ pageUrl: it.pageUrl, imageUrl })));
        r = await monitor.checkImages(items, { source: 'offender' });
        await monitor.emitMatches(r.created);
      } else {
        r = await monitor.scan(null, o.url, { source: 'offender' });
      }
      await monitor.notifyAll(r.created);
      status = `OK - ${r.checked} image(s) checked, ${r.created.length} new match(es)`;
    } catch (e) {
      status = `${e.blocked ? 'Blocked' : 'Error'}: ${e.message}`;
    }
    db.run('UPDATE offenders SET last_checked_at = ?, last_status = ? WHERE id = ?', now(), status, o.id);
    return status;
  }

  async function scanDue() {
    const cutoff = new Date(Date.now() - cfg.offenderRescanHours * 3600e3).toISOString();
    const due = db.all(
      `SELECT * FROM offenders WHERE active = 1 AND (last_checked_at IS NULL OR last_checked_at < ?)
       ORDER BY last_checked_at IS NOT NULL, last_checked_at LIMIT ?`,
      cutoff,
      cfg.offendersPerTick,
    );
    for (const o of due) await scanOffender(o);
    return due.length;
  }

  monitor.onMatches(noteMatches);
  return { noteMatches, refresh, scanOffender, scanDue };
}
