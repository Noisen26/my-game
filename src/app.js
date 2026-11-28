import express from 'express';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { loadConfig, ROOT } from './config.js';
import { openDb, now } from './db.js';
import { html } from './html.js';
import { loadSecrets, verifyCertificate } from './timestamp.js';
import { createArtworks, UserError } from './artworks.js';
import { createMonitor } from './monitor.js';
import { createMailer } from './mailer.js';
import { fingerprint, SUSPECT_CROPS } from './imaging.js';
import { validateUrl } from './fetcher.js';
import { buildNotice, platformFor, NOTICE_TYPES } from './takedown.js';
import {
  createSessions, csrfCheck, securityHeaders, requireUser, safeNext,
  hashPassword, verifyPassword, newToken, tokenHash,
} from './security.js';
import { optOutHeaders, blockAiBots, blockScriptsOnImages, rateLimit, robotsTxt, createSigner } from './antiscrape.js';
import { layout, flash, notFound } from './views/layout.js';
import * as pub from './views/public.js';
import * as auth from './views/auth.js';
import * as dash from './views/dashboard.js';
import { createAdminRouter } from './admin.js';
import { createWebSearch } from './websearch.js';
import { createUsage, createEtsy, createEbay } from './marketplaces.js';
import { createOffenders } from './offenders.js';
import { createDiscovery } from './discovery.js';
import { createBilling } from './billing.js';
import { createEmailVerification } from './emailverify.js';
import { PLANS, planOf, syncPlan } from './plans.js';
import * as billView from './views/billing.js';

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const HANDLE_RE = /^[a-zA-Z0-9_-]{3,30}$/;
const RESERVED = new Set(['admin', 'dashboard', 'api', 'static', 'login', 'signup', 'support', 'help', 'about', 'artguard', 'art-guard']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.dataDir);
  const secrets = loadSecrets(cfg);
  const mailer = createMailer(cfg);
  const artworks = createArtworks({ db, cfg, secrets });
  const monitor = createMonitor({ db, cfg, artworks, mailer, log: cfg.quiet ? {} : console });
  const websearch = createWebSearch({ db, cfg, artworks, monitor, provider: cfg.searchProviderOverride, log: cfg.quiet ? {} : console });
  const usage = createUsage(db);
  const etsy = cfg.etsyClientOverride ?? createEtsy(cfg, usage);
  const ebay = cfg.ebayClientOverride ?? createEbay(cfg, usage);
  const quietLog = cfg.quiet ? {} : console;
  const offenders = createOffenders({ db, cfg, monitor, etsy, ebay, log: quietLog });
  const discovery = createDiscovery({ db, cfg, artworks, monitor, mailer, etsy, ebay, log: quietLog });
  const billing = createBilling({ db, cfg, mailer, log: quietLog });
  const emailVerify = createEmailVerification({ db, cfg, mailer });
  monitor.addJob(() => offenders.scanDue());
  monitor.addJob(() => discovery.checkTrending());
  monitor.addJob(() => discovery.marketplaceDue());
  monitor.addJob(() => websearch.searchDue());
  const sessions = createSessions(db, { secure: cfg.baseUrl.startsWith('https://') });
  const signer = createSigner(createHash('sha256').update(`img:${secrets.appSecret}`).digest('hex'));
  const csrf = csrfCheck(cfg);
  const lim = (o) => rateLimit({ ...o, max: o.max * (cfg.rateLimitMultiplier || 1) });

  const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 20 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
  }).single('image');
  const uploadAny = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 5 } }).single('file');

  const authLimit = lim({ windowMs: 15 * 60 * 1000, max: 30 });
  const heavyLimit = lim({ windowMs: 10 * 60 * 1000, max: 40 });

  const thumb = (id) => signer.sign(id, 'thumb');
  // Hidden or suspended works are only visible to their owner and to admins.
  const canSee = (req, a) => !!a && (artworks.isVisible(a) || req.user?.id === a.user_id || !!req.user?.is_admin);
  const preview = (id) => signer.sign(id, 'img');

  const render = (req, res, opts, status = 200) =>
    res.status(status).send(
      String(layout({ cfg, user: req.user, csrf: req.csrf, path: req.path }, { ...opts, body: html`${flash(req.query.msg)}${opts.body}` })),
    );

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy ?? 'loopback');
  app.locals.ctx = { cfg, db, mailer, monitor, artworks, secrets, websearch, offenders, discovery, usage, billing, emailVerify };

  app.use(securityHeaders(cfg));
  app.use(optOutHeaders);

  // Machine-readable reservations and public key
  app.get('/robots.txt', (_q, r) => r.type('text').send(robotsTxt()));
  app.get('/ai.txt', (_q, r) => r.type('text').send('# No AI training or text and data mining permitted\nUser-Agent: *\nDisallow: *\nDisallow: /\n'));
  app.get('/.well-known/tdmrep.json', (_q, r) => r.json([{ location: '/', 'tdm-reservation': 1 }]));
  app.get('/.well-known/signing-key.pem', (_q, r) => r.type('text').set('X-Key-Id', secrets.keyId).send(secrets.publicPem));
  app.get('/healthz', (_q, r) => r.json({ ok: true }));
  // Stripe webhooks: raw body for signature verification, no CSRF (authenticated by signature).
  app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), ah((req, res) => billing.webhook(req, res)));

  app.use(blockAiBots);
  app.use('/static', express.static(join(ROOT, 'public'), { maxAge: cfg.production ? '7d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(sessions.middleware);
  app.use((req, res, next) => {
    // Pages may contain one-time content and signed URLs; never cache them in shared caches.
    res.set('Cache-Control', 'private, no-cache');
    next();
  });

  // ------------------------------------------------------------------ images
  const serveImage = (kind, pathFor) => [
    blockScriptsOnImages,
    lim({ windowMs: 10 * 60 * 1000, max: 400 }),
    (req, res) => {
      const { id } = req.params;
      if (!canSee(req, artworks.get(id)) || !signer.verify(id, req.query.exp, req.query.sig, kind)) return res.status(403).end();
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=600',
        'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Robots-Tag': 'noai, noimageai, noindex',
      });
      createReadStream(pathFor(id)).on('error', () => res.status(404).end()).pipe(res);
    },
  ];
  app.get('/img/:id', ...serveImage('img', artworks.previewPath));
  app.get('/thumb/:id', ...serveImage('thumb', artworks.thumbPath));

  // ------------------------------------------------------------------ public pages
  app.get('/', (req, res) => render(req, res, { title: '', body: pub.home({ cfg, recent: artworks.recentPublic(8), thumb, user: req.user }), wide: true }));
  app.get('/how-it-works', (req, res) => render(req, res, { title: 'How it works', body: pub.howItWorks({ cfg }) }));
  app.get('/bot', (req, res) => render(req, res, { title: 'ArtguardMonitor', body: pub.botPage({ cfg }) }));
  app.get('/terms', (req, res) => render(req, res, { title: 'Terms', body: pub.legalPage({ cfg, which: 'terms' }) }));
  app.get('/privacy', (req, res) => render(req, res, { title: 'Privacy', body: pub.legalPage({ cfg, which: 'privacy' }) }));

  app.get('/gallery', (req, res) => {
    const per = 24;
    const pages = Math.max(1, Math.ceil(artworks.countPublic() / per));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    render(req, res, { title: 'Gallery', body: pub.gallery({ items: artworks.recentPublic(per, (page - 1) * per), thumb, page, pages }) });
  });

  app.get('/artist/:handle', (req, res) => {
    const artist = db.one('SELECT * FROM users WHERE handle = ? AND suspended_at IS NULL', String(req.params.handle));
    if (!artist) return render(req, res, { title: 'Not found', body: notFound() }, 404);
    render(req, res, { title: artist.display_name, body: pub.artistPage({ artist, items: artworks.publicByUser(artist.id), thumb }) });
  });

  app.get('/a/:id', (req, res) => {
    const a = artworks.get(req.params.id);
    if (!canSee(req, a)) return render(req, res, { title: 'Not found', body: notFound() }, 404);
    const isOwner = req.user?.id === a.user_id;
    if (!isOwner && !req.user?.is_admin) discovery.recordView(a.id, req.ip);
    const certValid = verifyCertificate(secrets, a.certificate, a.signature);
    render(req, res, { title: a.title, description: `${a.title} by ${a.display_name}`, body: pub.artworkPage({ cfg, a, src: preview(a.id), isOwner, csrf: req.csrf, certValid }) });
  });

  app.get('/a/:id/certificate.json', (req, res) => {
    const a = artworks.get(req.params.id);
    if (!canSee(req, a)) return res.status(404).json({ error: 'not found' });
    res.set('Content-Disposition', `attachment; filename="certificate-${a.id}.json"`).json({
      payload: JSON.parse(a.certificate),
      payloadCanonical: a.certificate,
      signature: a.signature,
      algorithm: 'Ed25519',
      publicKey: `${cfg.baseUrl}/.well-known/signing-key.pem`,
      howToVerify: 'Verify the Ed25519 signature (base64) over the UTF-8 bytes of payloadCanonical using the public key.',
    });
  });

  app.get('/a/:id/proof.ots', (req, res) => {
    const a = artworks.get(req.params.id);
    if (!canSee(req, a) || !a.ots_proof) return res.status(404).type('text').send('No timestamp proof available yet.');
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${a.id}.ots"` }).send(Buffer.from(a.ots_proof));
  });

  app.post('/a/:id/dispute', authLimit, csrf, ah(async (req, res) => {
    const a = artworks.get(req.params.id);
    if (!canSee(req, a)) return render(req, res, { title: 'Not found', body: notFound() }, 404);
    const name = str(req.body.name, 100);
    const email = str(req.body.email, 200);
    const message = str(req.body.message, 4000);
    if (!name || !EMAIL_RE.test(email) || !message) return res.redirect(303, `/a/${a.id}`);
    const disputeId = Number(db.run('INSERT INTO disputes (artwork_id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)', a.id, name, email, message, now()).lastInsertRowid);
    const admins = new Set([cfg.adminEmail, ...db.all('SELECT email FROM users WHERE is_admin = 1').map((u) => u.email)].filter(Boolean));
    for (const to of admins)
      await mailer.send({
        to,
        subject: `${cfg.siteName}: new dispute about "${a.title}"`,
        text: `Review: ${cfg.baseUrl}/admin/disputes/${disputeId}\nArtwork: ${cfg.baseUrl}/a/${a.id}\nFrom: ${name} <${email}>\n\n${message}`,
      });
    res.redirect(303, `/a/${a.id}?msg=dispute-sent`);
  }));

  // ------------------------------------------------------------------ find copies / verify
  app.get('/check', (req, res) => render(req, res, { title: 'Find copies', body: pub.checkPage({ csrf: req.csrf, thumb }) }));
  app.post('/check', heavyLimit, uploadImage, csrf, ah(async (req, res) => {
    const fail = (error) => render(req, res, { title: 'Find copies', body: pub.checkPage({ csrf: req.csrf, thumb, error }) }, 400);
    if (!req.file) return fail('Choose an image to check.');
    let fp;
    try {
      fp = await fingerprint(req.file.buffer, SUSPECT_CROPS);
    } catch {
      return fail('The file could not be read as an image.');
    }
    const matches = artworks
      .findMatches(fp)
      .map((m) => ({ ...artworks.get(m.id), distance: m.distance }))
      .filter((a) => a.visibility === 'public' || a.user_id === req.user?.id);
    render(req, res, { title: 'Find copies', body: pub.checkPage({ csrf: req.csrf, thumb, result: { matches } }) });
  }));

  app.get('/verify', (req, res) => render(req, res, { title: 'Verify', body: pub.verifyPage({ cfg, csrf: req.csrf, keyId: secrets.keyId }) }));
  app.post('/verify', heavyLimit, uploadAny, csrf, (req, res) => {
    let sha = str(req.body.sha256, 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) sha = req.file ? createHash('sha256').update(req.file.buffer).digest('hex') : '';
    if (!sha) return render(req, res, { title: 'Verify', body: pub.verifyPage({ cfg, csrf: req.csrf, keyId: secrets.keyId, error: 'Choose a file to verify.' }) }, 400);
    render(req, res, { title: 'Verify', body: pub.verifyPage({ cfg, csrf: req.csrf, keyId: secrets.keyId, result: { sha, matches: artworks.bySha(sha) } }) });
  });

  // ------------------------------------------------------------------ auth
  app.get('/signup', (req, res) => (req.user ? res.redirect('/dashboard') : render(req, res, { title: 'Sign up', body: auth.signupPage({ csrf: req.csrf }) })));
  app.post('/signup', authLimit, csrf, ah(async (req, res) => {
    const values = { display_name: str(req.body.display_name, 80), handle: str(req.body.handle, 30), email: str(req.body.email, 200).toLowerCase() };
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const fail = (error) => render(req, res, { title: 'Sign up', body: auth.signupPage({ csrf: req.csrf, error, values }) }, 400);
    if (!values.display_name) return fail('Enter your artist name.');
    if (!HANDLE_RE.test(values.handle) || RESERVED.has(values.handle.toLowerCase())) return fail('Choose a different profile address (3–30 letters, numbers, - or _).');
    if (!EMAIL_RE.test(values.email)) return fail('Enter a valid e-mail address.');
    if (password.length < 10 || password.length > 200) return fail('Your password must be at least 10 characters.');
    if (req.body.terms !== '1') return fail('You need to accept the terms.');
    if (db.one('SELECT 1 FROM users WHERE handle = ?', values.handle)) return fail('That profile address is taken.');
    if (db.one('SELECT 1 FROM users WHERE email = ?', values.email)) return fail('An account with that e-mail already exists. Try signing in.');
    const comp = PLANS[cfg.signupPlan] ? cfg.signupPlan : null;
    const r = db.run(
      'INSERT INTO users (email, password_hash, handle, display_name, created_at, comp_plan) VALUES (?, ?, ?, ?, ?, ?)',
      values.email, await hashPassword(password), values.handle, values.display_name, now(), comp,
    );
    const userId = Number(r.lastInsertRowid);
    syncPlan(db, userId);
    await emailVerify.send(db.one('SELECT * FROM users WHERE id = ?', userId));
    sessions.login(res, userId);
    res.redirect(303, '/dashboard?msg=welcome');
  }));

  app.get('/verify-email', (req, res) => {
    const r = emailVerify.consume(req.query.token);
    if (r.error) return render(req, res, { title: 'Verify e-mail', body: html`<div class="empty"><h1>Could not verify</h1><p>${r.error}</p></div>` }, 400);
    res.redirect(303, req.user?.id === r.userId ? '/dashboard?msg=email-verified' : '/login?msg=email-verified');
  });

  app.get('/pricing', (req, res) =>
    render(req, res, { title: 'Pricing', body: billView.pricingPage({ cfg, user: req.user, billing, csrf: req.csrf, interval: req.query.interval === 'yearly' ? 'yearly' : 'monthly' }), wide: true }),
  );

  app.get('/login', (req, res) =>
    req.user ? res.redirect('/dashboard') : render(req, res, { title: 'Sign in', body: auth.loginPage({ csrf: req.csrf, next: safeNext(req.query.next) }) }),
  );
  app.post('/login', authLimit, csrf, ah(async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const user = db.one('SELECT * FROM users WHERE email = ?', email);
    const ok = user ? await verifyPassword(String(req.body.password || ''), user.password_hash) : (await hashPassword('timing-equaliser'), false);
    if (!ok)
      return render(req, res, { title: 'Sign in', body: auth.loginPage({ csrf: req.csrf, next: safeNext(req.body.next), email, error: 'Wrong e-mail or password.' }) }, 401);
    if (user.suspended_at)
      return render(req, res, { title: 'Sign in', body: auth.loginPage({ csrf: req.csrf, next: '/dashboard', email, error: 'This account has been suspended. Contact support if you think this is a mistake.' }) }, 403);
    sessions.login(res, user.id);
    res.redirect(303, safeNext(req.body.next));
  }));

  app.post('/logout', csrf, (req, res) => {
    sessions.logout(req, res);
    res.redirect(303, '/?msg=signed-out');
  });

  app.get('/forgot', (req, res) => render(req, res, { title: 'Reset password', body: auth.forgotPage({ csrf: req.csrf }) }));
  app.post('/forgot', authLimit, csrf, ah(async (req, res) => {
    const user = db.one('SELECT * FROM users WHERE email = ?', str(req.body.email, 200).toLowerCase());
    if (user) {
      const token = newToken();
      db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', tokenHash(token), user.id, Date.now() + 3600e3);
      await mailer.send({
        to: user.email,
        subject: `Reset your ${cfg.siteName} password`,
        text: `Hi ${user.display_name},\n\nUse this link within one hour to choose a new password:\n${cfg.baseUrl}/reset?token=${token}\n\nIf you didn't ask for this, you can ignore this e-mail.\n\n- ${cfg.siteName}`,
      });
    }
    res.redirect(303, '/login?msg=reset-sent');
  }));
  app.get('/reset', (req, res) => render(req, res, { title: 'New password', body: auth.resetPage({ csrf: req.csrf, token: str(req.query.token, 100) }) }));
  app.post('/reset', authLimit, csrf, ah(async (req, res) => {
    const token = str(req.body.token, 100);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const row = db.one('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?', tokenHash(token), Date.now());
    const fail = (error) => render(req, res, { title: 'New password', body: auth.resetPage({ csrf: req.csrf, token, error }) }, 400);
    if (!row) return fail('This reset link is invalid or has expired. Request a new one.');
    if (password.length < 10 || password.length > 200) return fail('Your password must be at least 10 characters.');
    const hash = await hashPassword(password);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, row.user_id);
      db.run('DELETE FROM password_resets WHERE user_id = ?', row.user_id);
      db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), row.user_id);
    });
    sessions.logoutEverywhere(row.user_id);
    res.redirect(303, '/login?msg=reset-done');
  }));

  // ------------------------------------------------------------------ dashboard
  const d = express.Router();
  d.use(requireUser);
  const dash_ = (req, res, title, body, status) => render(req, res, { title, body }, status);
  const byId = (userId) => Object.fromEntries(artworks.byUser(userId).map((a) => [a.id, a]));

  d.get('/', (req, res) => {
    const u = req.user.id;
    const stats = {
      artworks: db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ?', u).n,
      watches: db.one('SELECT COUNT(*) n FROM watches WHERE user_id = ? AND active = 1', u).n,
      newMatches: db.one(`SELECT COUNT(*) n FROM matches WHERE user_id = ? AND status = 'new'`, u).n,
      removed: db.one(`SELECT COUNT(*) n FROM matches WHERE user_id = ? AND status = 'removed'`, u).n,
    };
    const recentMatches = db.all('SELECT * FROM matches WHERE user_id = ? ORDER BY found_at DESC LIMIT 8', u);
    dash_(req, res, 'Dashboard', dash.overview({ user: req.user, stats, recentMatches, artworksById: byId(u) }));
  });

  d.get('/artworks', (req, res) => dash_(req, res, 'Artworks', dash.artworksList({ items: artworks.byUser(req.user.id), thumb })));

  d.get('/upload', (req, res) => dash_(req, res, 'Register artwork', dash.uploadPage({ csrf: req.csrf, searchEnabled: websearch.enabled })));
  d.post('/upload', heavyLimit, uploadImage, csrf, ah(async (req, res) => {
    const values = {
      title: str(req.body.title, 120), year: str(req.body.year, 10), medium: str(req.body.medium, 80),
      description: str(req.body.description, 2000), visibility: req.body.visibility === 'unlisted' ? 'unlisted' : 'public',
      webSearch: req.body.web_search === '1',
      keywords: str(req.body.keywords, 300),
    };
    const fail = (error, conflict) => dash_(req, res, 'Register artwork', dash.uploadPage({ csrf: req.csrf, error, values, conflict, searchEnabled: websearch.enabled }), 400);
    if (!req.file) return fail('Choose an image file (JPEG, PNG, WebP or TIFF).');
    if (!values.title) return fail('Give your artwork a title.');
    const limit = planOf(req.user).artworks;
    if (db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ?', req.user.id).n >= limit)
      return fail(`Your ${planOf(req.user).name} plan includes ${limit} artworks. Upgrade under Billing to register more.`);
    try {
      const a = await artworks.register(req.user, req.file.buffer, values);
      monitor.stampPending().catch(() => {}); // submit timestamp in the background
      res.redirect(303, `/a/${a.id}?msg=uploaded`);
    } catch (e) {
      if (e instanceof UserError) return fail(e.message, e.conflict);
      throw e;
    }
  }));

  const ownArtwork = (req, res, next) => {
    const a = artworks.get(req.params.id);
    if (!a || a.user_id !== req.user.id) return dash_(req, res, 'Not found', notFound(), 404);
    req.artwork = a;
    next();
  };
  d.get('/artworks/:id', ownArtwork, (req, res) => {
    const matches = db.all('SELECT * FROM matches WHERE artwork_id = ? ORDER BY found_at DESC', req.artwork.id);
    dash_(req, res, req.artwork.title, dash.artworkEdit({ csrf: req.csrf, a: req.artwork, src: preview(req.artwork.id), matches, search: websearch, discovery, views: db.one(`SELECT COALESCE(SUM(n), 0) n FROM artwork_views WHERE artwork_id = ? AND day >= ?`, req.artwork.id, new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)).n }));
  });
  d.post('/artworks/:id', csrf, ownArtwork, (req, res) => {
    artworks.update(req.artwork.id, {
      year: str(req.body.year, 10), medium: str(req.body.medium, 80), description: str(req.body.description, 2000), visibility: req.body.visibility,
      webSearch: req.body.web_search === '1',
      keywords: str(req.body.keywords, 300),
    });
    res.redirect(303, `/dashboard/artworks/${req.artwork.id}?msg=updated`);
  });
  d.post('/artworks/:id/hot', csrf, ownArtwork, (req, res) => {
    if (req.body.on === '1') {
      if (!discovery.setHot(req.artwork.id, 'marked by artist')) return res.redirect(303, `/dashboard/artworks/${req.artwork.id}?msg=plan-required`);
    } else discovery.clearHot(req.artwork.id);
    res.redirect(303, `/dashboard/artworks/${req.artwork.id}?msg=updated`);
  });
  d.post('/artworks/:id/market', heavyLimit, csrf, ownArtwork, ah(async (req, res) => {
    const a = req.artwork;
    if (!discovery.enabled) return res.redirect(303, `/dashboard/artworks/${a.id}?msg=market-unavailable`);
    if (!planOf(req.user).marketplaces) return res.redirect(303, `/dashboard/artworks/${a.id}?msg=plan-required`);
    if (a.last_market_search_at && Date.now() - Date.parse(a.last_market_search_at) < 3600e3)
      return res.redirect(303, `/dashboard/artworks/${a.id}?msg=market-recent`);
    await discovery.searchMarketplaces(a.id);
    res.redirect(303, `/dashboard/artworks/${a.id}?msg=market-done`);
  }));
  d.post('/artworks/:id/search', heavyLimit, csrf, ownArtwork, ah(async (req, res) => {
    const a = req.artwork;
    const back = (msg) => res.redirect(303, `/dashboard/artworks/${a.id}?msg=${msg}`);
    if (!websearch.enabled) return back('search-unavailable');
    if (!planOf(req.user).manualSearch) return back('plan-required');
    if (a.hidden_at) return back('search-failed');
    if (a.last_searched_at && Date.now() - Date.parse(a.last_searched_at) < 864e5) return back('search-recent');
    if (!websearch.remaining()) return back('search-budget');
    try {
      await websearch.searchArtwork(a.id);
      back('search-done');
    } catch {
      back('search-failed');
    }
  }));
  d.post('/artworks/:id/delete', csrf, ownArtwork, ah(async (req, res) => {
    await artworks.remove(req.artwork.id);
    res.redirect(303, '/dashboard/artworks?msg=deleted');
  }));

  // monitor
  const monitorView = (req, extra = {}) =>
    dash.monitorPage({
      cfg,
      csrf: req.csrf,
      watches: db.all('SELECT * FROM watches WHERE user_id = ? ORDER BY created_at DESC', req.user.id),
      artworkCount: db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ?', req.user.id).n,
      ...extra,
    });
  d.get('/monitor', (req, res) => dash_(req, res, 'Monitor', monitorView(req)));
  d.post('/monitor', heavyLimit, csrf, ah(async (req, res) => {
    const fail = (error) => dash_(req, res, 'Monitor', monitorView(req, { error }), 400);
    let url;
    try {
      url = validateUrl(str(req.body.url, 2000), { allowPrivate: !!cfg.allowPrivateFetch }).href;
    } catch (e) {
      return fail(e.message);
    }
    if (req.body.mode === 'watch') {
      const maxWatches = Math.min(cfg.maxWatchesPerUser, planOf(req.user).watches);
      if (db.one('SELECT COUNT(*) n FROM watches WHERE user_id = ?', req.user.id).n >= maxWatches)
        return fail(`Your ${planOf(req.user).name} plan includes ${maxWatches} monitored pages. Upgrade under Billing to add more.`);
      const r = db.run(
        'INSERT INTO watches (user_id, url, label, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, url) DO NOTHING',
        req.user.id, url, str(req.body.label, 80), now(),
      );
      if (!r.changes) return fail('You are already monitoring that page.');
      const w = db.one('SELECT * FROM watches WHERE id = ?', Number(r.lastInsertRowid));
      await monitor.scanWatch(w);
      return res.redirect(303, '/dashboard/monitor?msg=watch-added');
    }
    try {
      const scanResult = await monitor.scan(req.user.id, url);
      dash_(req, res, 'Monitor', monitorView(req, { scanResult }));
    } catch (e) {
      fail(`Could not scan that page: ${e.message}`);
    }
  }));
  const ownWatch = (req, res, next) => {
    const w = db.one('SELECT * FROM watches WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!w) return dash_(req, res, 'Not found', notFound(), 404);
    req.watch = w;
    next();
  };
  d.post('/monitor/:id/scan', heavyLimit, csrf, ownWatch, ah(async (req, res) => {
    await monitor.scanWatch(req.watch);
    res.redirect(303, '/dashboard/monitor');
  }));
  d.post('/monitor/:id/toggle', csrf, ownWatch, (req, res) => {
    db.run('UPDATE watches SET active = 1 - active WHERE id = ?', req.watch.id);
    res.redirect(303, '/dashboard/monitor');
  });
  d.post('/monitor/:id/delete', csrf, ownWatch, (req, res) => {
    db.run('DELETE FROM watches WHERE id = ?', req.watch.id);
    res.redirect(303, '/dashboard/monitor?msg=deleted');
  });

  // matches
  d.get('/matches', (req, res) => {
    const status = Object.hasOwn(dash.STATUS, req.query.status) ? req.query.status : '';
    const rows = status
      ? db.all('SELECT * FROM matches WHERE user_id = ? AND status = ? ORDER BY found_at DESC', req.user.id, status)
      : db.all('SELECT * FROM matches WHERE user_id = ? ORDER BY found_at DESC', req.user.id);
    const counts = { all: 0 };
    for (const r of db.all('SELECT status, COUNT(*) n FROM matches WHERE user_id = ? GROUP BY status', req.user.id)) {
      counts[r.status] = r.n;
      counts.all += r.n;
    }
    dash_(req, res, 'Matches', dash.matchesPage({ rows, artworksById: byId(req.user.id), status, counts }));
  });
  const ownMatch = (req, res, next) => {
    const m = db.one('SELECT * FROM matches WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!m) return dash_(req, res, 'Not found', notFound(), 404);
    req.match = m;
    req.artwork = artworks.get(m.artwork_id);
    req.noticeType = Object.hasOwn(NOTICE_TYPES, req.query.notice) ? req.query.notice : platformFor(m.page_url).name === 'Temu' ? 'dsa' : 'dmca';
    next();
  };
  const noticeFor = (req) => buildNotice(req.noticeType, { user: req.user, artwork: req.artwork, match: req.match, baseUrl: cfg.baseUrl });
  d.get('/matches/:id', ownMatch, (req, res) =>
    dash_(req, res, 'Review match', dash.matchDetail({
      csrf: req.csrf, m: req.match, a: req.artwork, src: preview(req.artwork.id), platform: platformFor(req.match.page_url),
      noticeType: req.noticeType, notice: req.user.email_verified_at ? noticeFor(req) : null, user: req.user,
    })),
  );
  d.get('/matches/:id/notice.txt', ownMatch, (req, res) =>
    !req.user.email_verified_at ? res.redirect(303, `/dashboard/matches/${req.match.id}`) : res.type('text/plain').set('Content-Disposition', `attachment; filename="takedown-${req.match.id}-${req.noticeType}.txt"`).send(noticeFor(req)),
  );
  d.post('/matches/:id', csrf, ownMatch, (req, res) => {
    const status = Object.hasOwn(dash.STATUS, req.body.status) ? req.body.status : req.match.status;
    db.run('UPDATE matches SET status = ?, notes = ?, updated_at = ? WHERE id = ?', status, str(req.body.notes, 2000), now(), req.match.id);
    offenders.refresh(req.match.offender_id);
    res.redirect(303, `/dashboard/matches/${req.match.id}?msg=updated`);
  });

  // settings
  d.get('/settings', (req, res) => dash_(req, res, 'Settings', dash.settingsPage({ csrf: req.csrf, user: req.user, pendingEmail: emailVerify.pendingEmail(req.user.id) })));
  const settingsFail = (req, res, error) => dash_(req, res, 'Settings', dash.settingsPage({ csrf: req.csrf, user: req.user, error, pendingEmail: emailVerify.pendingEmail(req.user.id) }), 400);
  d.post('/settings/profile', csrf, (req, res) => {
    const name = str(req.body.display_name, 80);
    const website = str(req.body.website, 200);
    if (!name) return settingsFail(req, res, 'Artist name cannot be empty.');
    if (website && !/^https?:\/\/[^\s]+$/i.test(website)) return settingsFail(req, res, 'Website must start with http:// or https://');
    db.run('UPDATE users SET display_name = ?, bio = ?, website = ? WHERE id = ?', name, str(req.body.bio, 600), website, req.user.id);
    res.redirect(303, '/dashboard/settings?msg=updated');
  });
  d.post('/settings/legal', csrf, (req, res) => {
    db.run('UPDATE users SET legal_name = ?, postal_address = ? WHERE id = ?', str(req.body.legal_name, 120), str(req.body.postal_address, 400), req.user.id);
    res.redirect(303, '/dashboard/settings?msg=updated');
  });
  d.post('/settings/password', authLimit, csrf, ah(async (req, res) => {
    const pw = typeof req.body.password === 'string' ? req.body.password : '';
    if (!(await verifyPassword(String(req.body.current || ''), req.user.password_hash))) return settingsFail(req, res, 'Your current password is wrong.');
    if (pw.length < 10 || pw.length > 200) return settingsFail(req, res, 'Your new password must be at least 10 characters.');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), req.user.id);
    sessions.logoutEverywhere(req.user.id);
    sessions.login(res, req.user.id);
    res.redirect(303, '/dashboard/settings?msg=password-changed');
  }));
  d.post('/settings/delete', authLimit, csrf, ah(async (req, res) => {
    if (!(await verifyPassword(String(req.body.password || ''), req.user.password_hash))) return settingsFail(req, res, 'Wrong password. Your account was not deleted.');
    try {
      await billing.cancelNow(req.user);
    } catch (e) {
      return settingsFail(req, res, `Your subscription could not be cancelled, so your account was not deleted. Try again or contact support. (${e.message})`);
    }
    for (const a of artworks.byUser(req.user.id)) await artworks.remove(a.id);
    db.run('DELETE FROM users WHERE id = ?', req.user.id);
    sessions.logout(req, res);
    res.redirect(303, '/?msg=deleted');
  }));

  // e-mail verification and change
  d.post('/verify-email/resend', authLimit, csrf, ah(async (req, res) => {
    if (!req.user.email_verified_at) await emailVerify.send(req.user);
    res.redirect(303, '/dashboard?msg=verify-sent');
  }));
  d.post('/settings/email', authLimit, csrf, ah(async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    if (!(await verifyPassword(String(req.body.password || ''), req.user.password_hash))) return settingsFail(req, res, 'Wrong password.');
    if (!EMAIL_RE.test(email)) return settingsFail(req, res, 'Enter a valid e-mail address.');
    if (email === req.user.email.toLowerCase()) return settingsFail(req, res, 'That is already your e-mail address.');
    if (db.one('SELECT 1 FROM users WHERE email = ?', email)) return settingsFail(req, res, 'That e-mail address is already used by another account.');
    await emailVerify.send(req.user, email);
    res.redirect(303, '/dashboard/settings?msg=email-change-sent');
  }));

  // billing
  const billingView = (req, extra = {}) =>
    billView.billingPage({
      cfg, csrf: req.csrf, user: req.user, billing, interval: req.query.interval === 'yearly' ? 'yearly' : 'monthly',
      usage: {
        artworks: db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ?', req.user.id).n,
        watches: db.one('SELECT COUNT(*) n FROM watches WHERE user_id = ? AND active = 1', req.user.id).n,
        hot: db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ? AND hot_until > ?', req.user.id, now()).n,
      },
      ...extra,
    });
  d.get('/billing', (req, res) => dash_(req, res, 'Billing', dash.dashShell('/dashboard/billing', billingView(req))));
  d.post('/billing/checkout', authLimit, csrf, ah(async (req, res) => {
    try {
      res.redirect(303, await billing.checkout(req.user, String(req.body.plan), req.body.interval === 'yearly' ? 'yearly' : 'monthly'));
    } catch (e) {
      dash_(req, res, 'Billing', dash.dashShell('/dashboard/billing', billingView(req, { error: e.message })), 400);
    }
  }));
  d.post('/billing/portal', authLimit, csrf, ah(async (req, res) => {
    try {
      res.redirect(303, await billing.portal(req.user));
    } catch (e) {
      dash_(req, res, 'Billing', dash.dashShell('/dashboard/billing', billingView(req, { error: e.message })), 400);
    }
  }));

  app.use('/dashboard', d);
  app.use('/admin', createAdminRouter({ cfg, db, artworks, mailer, csrf, render, preview, thumb, ah, websearch, offenders, usage, discovery }));

  // ------------------------------------------------------------------ errors
  app.use((req, res) => render(req, res, { title: 'Not found', body: notFound() }, 404));
  app.use((err, req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE')
      return render(req, res, { title: 'File too large', body: html`<div class="empty"><h1>File too large</h1><p>The maximum is ${Math.round(cfg.maxUploadBytes / 1048576)} MB.</p><p><a class="btn" href="/dashboard/upload">Try again</a></p></div>` }, 413);
    if (err.type === 'entity.too.large') return res.status(413).type('text').send('Request too large.');
    console.error(err);
    if (!req.user && !req.csrf) return res.status(500).type('text').send('Something went wrong.');
    render(req, res, { title: 'Error', body: html`<div class="empty"><h1>Something went wrong</h1><p>Please try again. If the problem continues, contact support.</p></div>` }, 500);
  });

  if (cfg.scheduler) monitor.start();
  app.close = () => {
    monitor.stop();
    db.close();
  };
  return app;
}
