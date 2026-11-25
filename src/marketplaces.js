// Clients for official marketplace APIs. New listings show up here within
// minutes, long before search engines index them.
//
//   Etsy Open API v3   ETSY_API_KEY + ETSY_SHARED_SECRET  (x-api-key: keystring:secret)
//   eBay Browse API    EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (OAuth client credentials)
//
// Every call is counted against a daily cap per provider.
import { fetch } from 'undici';
import { apiDispatcher } from './fetcher.js';
import { now } from './db.js';

export class ApiError extends Error {}
export class QuotaError extends ApiError {}

export function createUsage(db) {
  const day = () => now().slice(0, 10);
  return {
    used: (provider) => db.one('SELECT count FROM api_usage WHERE day = ? AND provider = ?', day(), provider)?.count ?? 0,
    charge(provider, limit) {
      const used = db.one('SELECT count FROM api_usage WHERE day = ? AND provider = ?', day(), provider)?.count ?? 0;
      if (used >= limit) throw new QuotaError(`${provider}: daily API limit (${limit}) reached`);
      db.run(
        'INSERT INTO api_usage (day, provider, count) VALUES (?, ?, 1) ON CONFLICT(day, provider) DO UPDATE SET count = count + 1',
        day(),
        provider,
      );
    },
  };
}

async function callJson(url, init, label) {
  const res = await fetch(url, { dispatcher: apiDispatcher(), signal: AbortSignal.timeout(30_000), ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error_description || body.error?.message || (typeof body.error === 'string' ? body.error : '') || body.errors?.[0]?.message;
    throw new ApiError(`${label}: ${msg || `HTTP ${res.status}`}`);
  }
  return body;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ------------------------------------------------------------------ Etsy

export function etsyItems(listings) {
  return listings.map((l) => ({
    pageUrl: l.url || `https://www.etsy.com/listing/${l.listing_id}`,
    title: l.title || '',
    shopId: l.shop_id,
    imageUrls: (l.images || [])
      .slice(0, 2)
      .map((i) => i.url_570xN || i.url_fullxfull || i.url_794xN)
      .filter(Boolean),
  }));
}

export function createEtsy(cfg, usage) {
  if (!cfg.etsyApiKey || !cfg.etsySharedSecret) return null;
  const base = `${(cfg.etsyEndpoint || 'https://openapi.etsy.com').replace(/\/$/, '')}/v3/application`;
  const get = (path, params = {}) => {
    usage.charge('etsy', cfg.etsyDailyLimit);
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return callJson(`${base}${path}${qs ? `?${qs}` : ''}`, { headers: { 'x-api-key': `${cfg.etsyApiKey}:${cfg.etsySharedSecret}`, Accept: 'application/json' } }, 'Etsy');
  };
  const withImages = async (ids) => {
    const out = [];
    for (const part of chunk(ids, 100)) {
      if (!part.length) continue;
      const r = await get('/listings/batch', { listing_ids: part.join(','), includes: 'Images' });
      out.push(...(r.results || []));
    }
    return etsyItems(out);
  };
  return {
    name: 'Etsy',
    /** Newest active listings for a keyword phrase, with images. */
    async searchNewest(keywords, limit = 50) {
      const r = await get('/listings/active', { keywords, limit, sort_on: 'created', sort_order: 'desc' });
      return withImages((r.results || []).map((l) => l.listing_id));
    },
    async listing(id) {
      return get(`/listings/${encodeURIComponent(id)}`);
    },
    async shop(id) {
      return get(`/shops/${encodeURIComponent(id)}`);
    },
    /** A shop's newest active listings, with images. */
    async shopListings(shopId, limit = 100) {
      const r = await get(`/shops/${encodeURIComponent(shopId)}/listings/active`, { limit, sort_on: 'created', sort_order: 'desc' });
      return withImages((r.results || []).map((l) => l.listing_id));
    },
  };
}

// ------------------------------------------------------------------ eBay

export function ebayItems(summaries) {
  return summaries.map((s) => ({
    pageUrl: s.itemWebUrl,
    title: s.title || '',
    seller: s.seller?.username || null,
    imageUrls: [s.image?.imageUrl, s.additionalImages?.[0]?.imageUrl].filter(Boolean),
  })).filter((i) => i.pageUrl && i.imageUrls.length);
}

const EBAY_ART_CATEGORY = '550'; // "Art" (posters and prints live here)

export function createEbay(cfg, usage) {
  if (!cfg.ebayClientId || !cfg.ebayClientSecret) return null;
  const base = (cfg.ebayEndpoint || 'https://api.ebay.com').replace(/\/$/, '');
  let token = null;
  let tokenExpires = 0;

  async function accessToken() {
    if (token && Date.now() < tokenExpires - 60_000) return token;
    usage.charge('ebay', cfg.ebayDailyLimit);
    const body = await callJson(
      `${base}/identity/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.ebayClientId}:${cfg.ebayClientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString(),
      },
      'eBay auth',
    );
    token = body.access_token;
    tokenExpires = Date.now() + (Number(body.expires_in) || 7200) * 1000;
    return token;
  }

  async function call(path, init = {}) {
    const t = await accessToken();
    usage.charge('ebay', cfg.ebayDailyLimit);
    return callJson(
      `${base}/buy/browse/v1${path}`,
      { ...init, headers: { Authorization: `Bearer ${t}`, 'X-EBAY-C-MARKETPLACE-ID': cfg.ebayMarketplace, Accept: 'application/json', ...init.headers } },
      'eBay',
    );
  }

  return {
    name: 'eBay',
    async searchByImage(jpeg, limit = 50) {
      const r = await call(`/item_summary/search_by_image?limit=${limit}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: jpeg.toString('base64') }),
      });
      return ebayItems(r.itemSummaries || []);
    },
    async searchNewest(q, { seller, limit = 50 } = {}) {
      const params = new URLSearchParams({ limit: String(limit), sort: 'newlyListed' });
      if (q) params.set('q', q);
      else params.set('category_ids', EBAY_ART_CATEGORY);
      if (seller) params.set('filter', `sellers:{${seller}}`);
      const r = await call(`/item_summary/search?${params}`);
      return ebayItems(r.itemSummaries || []);
    },
    async itemByLegacyId(id) {
      return call(`/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(id)}`);
    },
  };
}
