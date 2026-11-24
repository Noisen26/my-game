// Skydd mot AI-skrapning och massnedladdning.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Kända AI-/dataset-crawlers. Användaragenten kan förfalskas, men de stora
// aktörerna respekterar den, och det gör det juridiska förbehållet tydligt.
export const AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'CCBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'GoogleOther', 'Bytespider', 'PerplexityBot', 'Amazonbot', 'Applebot-Extended',
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', 'Diffbot', 'ImagesiftBot', 'Omgilibot',
  'cohere-ai', 'Timpibot', 'img2dataset', 'DataForSeoBot', 'PetalBot', 'YouBot', 'AI2Bot', 'Scrapy',
];
// Generiska skriptklienter blockeras bara på bildvägarna.
const SCRIPT_CLIENTS = ['python-requests', 'python-urllib', 'aiohttp', 'curl/', 'Wget', 'Go-http-client', 'node-fetch', 'axios', 'HeadlessChrome'];

const re = (list) => new RegExp(list.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'i');
const AI_RE = re(AI_BOTS);
const SCRIPT_RE = re(SCRIPT_CLIENTS);

export function robotsTxt() {
  return [
    ...AI_BOTS.flatMap((b) => [`User-agent: ${b}`, 'Disallow: /', '']),
    'User-agent: *',
    'Disallow: /img/',
    'Disallow: /check',
    '',
  ].join('\n');
}

/** Lägger på maskinläsbara "inget AI/TDM"-förbehåll på varje svar. */
export function optOutHeaders(_req, res, next) {
  res.set('X-Robots-Tag', 'noai, noimageai');
  // TDM Reservation Protocol (W3C CG): maskinläsbart förbehåll enligt EU DSM-direktivet art. 4.3
  res.set('tdm-reservation', '1');
  res.set('tdm-policy', '/.well-known/tdmrep.json');
  next();
}

export function blockAiBots(req, res, next) {
  const ua = req.get('user-agent') || '';
  if (AI_RE.test(ua)) return res.status(403).type('text').send('AI-crawlers är inte tillåtna på den här sajten.');
  next();
}

export function blockScriptsOnImages(req, res, next) {
  const ua = req.get('user-agent') || '';
  if (!ua || SCRIPT_RE.test(ua)) return res.status(403).type('text').send('Forbidden');
  next();
}

/** Enkel glidande hastighetsbegränsning per IP (i minnet). */
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
    if (list.length > max) return res.status(429).type('text').send('För många förfrågningar. Försök igen senare.');
    next();
  };
}

/**
 * Bild-URL:er signeras och slutar gälla efter några minuter. Det finns
 * alltså ingen stabil adress till bilden som kan delas, hotlänkas från
 * en butik eller läggas i ett dataset.
 */
export function createSigner(secret = process.env.URL_SECRET || randomBytes(32).toString('hex'), ttlSec = 600) {
  const mac = (id, exp) => createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');
  return {
    sign(id) {
      const exp = Math.floor(Date.now() / 1000) + ttlSec;
      return `/img/${id}?exp=${exp}&sig=${mac(id, exp)}`;
    },
    verify(id, exp, sig) {
      if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() / 1000 || typeof sig !== 'string') return false;
      const a = Buffer.from(mac(id, exp));
      const b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
