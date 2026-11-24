// Finding product images in shop pages.
//
// Tested against live pages (Nov 2026): Amazon search pages are server-
// rendered and work; Temu search pages are rendered client-side (no product
// images in the HTML); Etsy and Redbubble answer automated clients with a
// captcha / Cloudflare challenge. The monitor identifies itself honestly and
// reports such pages as blocked instead of trying to get around them.

export const MAX_IMAGES_PER_PAGE = 120;

const decode = (s) =>
  s
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const JUNK = /(sprite|logo|favicon|icon|badge|flag|avatar|placeholder|loading|spinner|pixel|blank|transparent|tracking|banner|button|arrow|star-rating|payment|social_share)/i;
const JUNK_PATHS = [
  /media-amazon\.com\/images\/G\//, // Amazon global UI assets
  /ssl-images-amazon\.com\/images\/G\//,
  /kwcdn\.com\/upload_aimg\//, // Temu UI assets
  /\/s\/files\/[^?]*\/(icons?|logos?)\//,
];

function isJunk(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (!/^https?:$/.test(u.protocol)) return true;
  if (/\.(svg|ico|gif)(\.|\?|$)/i.test(u.pathname)) return true;
  if (JUNK_PATHS.some((re) => re.test(url))) return true;
  return JUNK.test(u.pathname.split('/').pop() || '');
}

/**
 * Rewrites known CDN thumbnail URLs to a larger rendition, and returns a key
 * that identifies the underlying image so that several sizes of the same
 * picture are only downloaded once.
 */
export function normaliseImage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { url, key: url };
  }
  const host = u.hostname;
  // Amazon: /images/I/<ID>._AC_UL320_.jpg -> /images/I/<ID>._AC_SL800_.jpg
  let m = u.pathname.match(/^\/images\/I\/([^./]+)(?:\.[^/]*)?\.(jpe?g|png|webp)$/i);
  if (/media-amazon\.com$|ssl-images-amazon\.com$/.test(host) && m) {
    return { url: `https://m.media-amazon.com/images/I/${m[1]}._AC_SL800_.jpg`, key: `amazon:${m[1]}` };
  }
  // Shopify: name_200x200.jpg / name_small.jpg / ?width=200 -> width=800
  if (host === 'cdn.shopify.com' || /\/cdn\/shop\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(@\dx)?(?=\.[a-z]+$)/i, '');
    u.search = '';
    const key = `shopify:${u.pathname}`;
    u.searchParams.set('width', '800');
    return { url: u.href, key };
  }
  // Etsy: il_340x270.<id>_<hash>.jpg -> il_794xN.<id>_<hash>.jpg
  m = u.pathname.match(/\/il_[^./]+\.(\d+_[a-z0-9]+)\.(jpe?g|png|webp)$/i);
  if (/etsystatic\.com$/.test(host) && m) {
    u.pathname = u.pathname.replace(/il_[^./]+\./, 'il_794xN.');
    return { url: u.href, key: `etsy:${m[1]}` };
  }
  // Temu / kwcdn: strip resize parameters
  if (/kwcdn\.com$/.test(host)) {
    u.search = '';
    return { url: u.href, key: `kwcdn:${u.pathname}` };
  }
  return { url: u.href, key: `${host}${u.pathname}` };
}

/** Pulls candidate product-image URLs out of an HTML page, best first. */
export function extractImageUrls(htmlText, base) {
  const scored = new Map(); // key -> { url, score }
  const add = (raw, score) => {
    if (!raw) return;
    let abs;
    try {
      abs = new URL(decode(raw.trim()), base).href;
    } catch {
      return;
    }
    if (isJunk(abs)) return;
    const { url, key } = normaliseImage(abs);
    const prev = scored.get(key);
    if (!prev || prev.score < score) scored.set(key, { url, score, order: prev?.order ?? scored.size });
  };

  // Social/meta images: on product pages this is the main product photo.
  for (const m of htmlText.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi))
    add(m[0].match(/content=["']([^"']+)["']/i)?.[1], 100);
  for (const m of htmlText.matchAll(/<link[^>]+rel=["']image_src["'][^>]*>/gi)) add(m[0].match(/href=["']([^"']+)["']/i)?.[1], 90);
  // JSON-LD / inline JSON "image" fields (Shopify, Etsy, WooCommerce, Amazon)
  for (const m of htmlText.matchAll(/"(?:image|images|imageUrl|thumbnail|hiRes|large)"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
    for (const u of m[1].matchAll(/"((?:https?:)?(?:\\?\/){2}[^"]+)"/g)) add(u[1], 80);
  }
  for (const m of htmlText.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const w = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] || 0);
    const h = Number(tag.match(/\sheight=["']?(\d+)/i)?.[1] || 0);
    if ((w && w < 80) || (h && h < 80)) continue;
    const productish = /class=["'][^"']*(product|s-image|listing|item|gallery|zoom)/i.test(tag) ? 15 : 0;
    for (const attr of ['data-zoom-image', 'data-old-hires', 'data-large_image', 'data-full', 'data-src', 'src']) {
      const v = tag.match(new RegExp(`\\s${attr}=["']([^"']+)["']`, 'i'))?.[1];
      if (v && !v.startsWith('data:')) {
        add(v, 50 + productish);
        break;
      }
    }
    const srcset = tag.match(/\s(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
    if (srcset) add(srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop(), 50 + productish);
  }
  for (const m of htmlText.matchAll(/<source\b[^>]*srcset=["']([^"']+)["']/gi))
    add(m[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop(), 45);
  // Last resort: any image URL anywhere in the page text (embedded app state).
  for (const m of htmlText.matchAll(/(?:https?:)?(?:\\?\/){2}[a-z0-9.-]+\.[a-z]{2,}(?:\\?\/[^\s"'<>()\\]*)*?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>\\]*)?/gi))
    add(m[0], 10);

  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_IMAGES_PER_PAGE)
    .map((c) => c.url);
}

// ---------------------------------------------------------------- blocking

const CHALLENGE = [
  /<title>\s*Just a moment/i, // Cloudflare
  /cf-chl|challenge-platform/i,
  /captcha-delivery\.com|datadome/i, // DataDome (Etsy)
  /px-captcha|perimeterx/i,
  /<title>\s*Robot Check/i, // Amazon
  /api-services-support@amazon\.com/i,
  /Access Denied<\/(?:title|h1)>/i,
];

export class BlockedError extends Error {
  constructor(host, status) {
    super(
      `${host} blocks automated access${status ? ` (HTTP ${status})` : ''}. ` +
        'ARTGUARD does not try to get around that. Save the product image and check it under "Find copies", ' +
        "or report the listing directly with the platform's form.",
    );
    this.blocked = true;
  }
}

export function detectBlock(page) {
  const host = new URL(page.url).hostname.replace(/^www\./, '');
  const text = /^text\/html/i.test(page.contentType) ? page.body.subarray(0, 200_000).toString('utf8') : '';
  if ([401, 403, 429, 503].includes(page.status) || CHALLENGE.some((re) => re.test(text))) return new BlockedError(host, page.status >= 400 ? page.status : 0);
  return null;
}

// ---------------------------------------------------------------- Shopify

/** Shopify stores expose public product JSON; it lists every product image. */
export function isShopify(page) {
  const text = page.body.subarray(0, 300_000).toString('utf8');
  return /cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(text);
}

export function shopifyJsonUrl(pageUrl) {
  const u = new URL(pageUrl);
  const product = u.pathname.match(/^(.*\/products\/[^/]+?)(?:\.json)?\/?$/);
  if (product) return `${u.origin}${product[1]}.json`;
  const collection = u.pathname.match(/^(\/collections\/[^/]+)/);
  return `${u.origin}${collection ? collection[1] : ''}/products.json?limit=250`;
}

export function shopifyImages(json) {
  const products = json.product ? [json.product] : json.products || [];
  return products.flatMap((p) => (p.images || []).map((i) => i.src)).filter(Boolean);
}
