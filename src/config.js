import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const env = process.env;
  const port = Number(env.PORT) || 3000;
  const cfg = {
    port,
    siteName: env.SITE_NAME || 'ARTGUARD',
    // Public base URL, used in watermarks, certificates and e-mails.
    baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dataDir: env.DATA_DIR || join(ROOT, 'data'),
    secret: env.APP_SECRET || null, // HMAC secret for signed image URLs; generated and persisted if missing
    production: env.NODE_ENV === 'production',
    smtpUrl: env.SMTP_URL || null, // e.g. smtps://user:pass@smtp.example.com
    mailFrom: env.MAIL_FROM || 'ARTGUARD <no-reply@localhost>',
    otsCalendars: (env.OTS_CALENDARS || 'https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    scheduler: env.DISABLE_SCHEDULER !== '1',
    adminEmail: env.ADMIN_EMAIL || null, // receives false-claim reports
    trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : 'loopback',
    // Reverse image search: 'google' (Cloud Vision Web Detection) or 'tineye'
    searchProvider: (env.SEARCH_PROVIDER || (env.GOOGLE_VISION_API_KEY ? 'google' : env.TINEYE_API_KEY ? 'tineye' : '')).toLowerCase(),
    googleVisionKey: env.GOOGLE_VISION_API_KEY || null,
    tineyeKey: env.TINEYE_API_KEY || null,
    searchIntervalDays: Number(env.SEARCH_INTERVAL_DAYS) || 7,
    searchMonthlyLimit: Number(env.SEARCH_MONTHLY_LIMIT) || 1000, // hard cap on paid API calls per calendar month
    previewMaxPx: 1000,
    maxUploadBytes: 40 * 1024 * 1024,
    maxArtworksPerUser: Number(env.MAX_ARTWORKS_PER_USER) || 500,
    maxWatchesPerUser: Number(env.MAX_WATCHES_PER_USER) || 50,
    rescanHours: Number(env.RESCAN_HOURS) || 24,
    ...overrides,
  };
  cfg.host = new URL(cfg.baseUrl).host;
  return cfg;
}
