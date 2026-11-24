// Protection against AI scraping and bulk downloading.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Known AI / dataset crawlers. User agents can be spoofed, but the major
// operators honour them, and blocking makes the legal reservation explicit.
export const AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'CCBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'GoogleOther', 'Bytespider', 'PerplexityBot', 'Amazonbot', 'Applebot-Extended',
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', 'Diffbot', 'ImagesiftBot', 'Omgilibot',
  'cohere-ai', 'Timpibot', 'img2dataset', 'DataForSeoBot', 'PetalBot', 'YouBot', 'AI2Bot', 'Scrapy',
];
// Generic scripting clients are only blocked on image routes.
const SCRIPT_CLIENTS = ['python-requests', 'python-urllib', 'aiohttp', 'curl/', 'Wget', 'Go-http-client', 'node-fetch', 'axios', 'HeadlessChrome'];

const re = (list) => new RegExp(list.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'i');
const AI_RE = re(AI_BOTS);
const SCRIPT_RE = re(SCRIPT_CLIENTS);

export function robotsTxt() {
  return [
    ...AI_BOTS.flatMap((b) => [`User-agent: ${b}`, 'Disallow: /', '']),
    'User-agent: *',
    'Disallow: /img/',
    'Disallow: /thumb/',
    'Disallow: /check',
    'Disallow: /verify',
    'Disallow: /dashboard',
    '',
  ].join('\n');
}

/** Machine-readable "no AI / no TDM" reservation on every response. */
export function optOutHeaders(_req, res, next) {
  res.set('X-Robots-Tag', 'noai, noimageai');
  // TDM Reservation Protocol (W3C CG): machine-readable opt-out under EU DSM Directive Art. 4(3)
  res.set('tdm-reservation', '1');
  res.set('tdm-policy', '/.well-known/tdmrep.json');
  next();
}

export function blockAiBots(req, res, next) {
  const ua = req.get('user-agent') || '';
  if (AI_RE.test(ua)) return res.status(403).type('text').send('AI crawlers are not permitted on this site.');
  next();
}

export function blockScriptsOnImages(req, res, next) {
  const ua = req.get('user-agent') || '';
  if (!ua || SCRIPT_RE.test(ua)) return res.status(403).type('text').send('Forbidden');
  next();
}

/** Simple sliding-window rate limit per IP (in memory). */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      kept.length ? hits.set(ip, kept) : hits.delete(ip);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => t > now - windowMs);
    list.push(now);
    hits.set(req.ip, list);
    if (list.length > max) return res.status(429).type('text').send('Too many requests. Please try again later.');
    next();
  };
}

/**
 * Image URLs are signed and expire after a few minutes, so there is no
 * stable address that can be shared, hot-linked from a shop or put into a
 * dataset.
 */
export function createSigner(secret = randomBytes(32).toString('hex'), ttlSec = 600) {
  const mac = (id, exp) => createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');
  return {
    sign(id, kind = 'img') {
      // round expiry to the minute so a page's URLs are stable and cacheable briefly
      const exp = Math.ceil((Date.now() / 1000 + ttlSec) / 60) * 60;
      return `/${kind}/${id}?exp=${exp}&sig=${mac(`${kind}:${id}`, exp)}`;
    },
    verify(id, exp, sig, kind = 'img') {
      if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() / 1000 || typeof sig !== 'string') return false;
      const a = Buffer.from(mac(`${kind}:${id}`, exp));
      const b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
