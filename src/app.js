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

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const HANDLE_RE = /^[a-zA-Z0-9_-]{3,30}$/;
const RESERVED = new Set(['admin', 'dashboard', 'api', 'static', 'login', 'signup', 'support', 'help', 'about', 'konstskydd']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.dataDir);
  const secrets = loadSecrets(cfg);
  const mailer = createMailer(cfg);
  const artworks = createArtworks({ db, cfg, secrets });
  const monitor = createMonitor({ db, cfg, artworks, mailer, log: cfg.quiet ? {} : console });
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
  const preview = (id) => signer.sign(id, 'img');

  const render = (req, res, opts, status = 200) =>
    res.status(status).send(
      String(layout({ cfg, user: req.user, csrf: req.csrf, path: req.path }, { ...opts, body: html`${flash(req.query.msg)}${opts.body}` })),
    );

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy ?? 'loopback');
  app.locals.ctx = { cfg, db, mailer, monitor, artworks, secrets };

  app.use(securityHeaders(cfg));
  app.use(optOutHeaders);

  // Machine-readable reservations and public key
  app.get('/robots.txt', (_q, r) => r.type('text').send(robotsTxt()));
  app.get('/ai.txt', (_q, r) => r.type('text').send('# No AI training or text and data mining permitted\nUser-Agent: *\nDisallow: *\nDisallow: /\n'));
  app.get('/.well-known/tdmrep.json', (_q, r) => r.json([{ location: '/', 'tdm-reservation': 1 }]));
  app.get('/.well-known/signing-key.pem', (_q, r) => r.type('text').set('X-Key-Id', secrets.keyId).send(secrets.publicPem));
  app.get('/healthz', (_q, r) => r.json({ ok: true }));

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
      if (!artworks.get(id) || !signer.verify(id, req.query.exp, req.query.sig, kind)) return res.status(403).end();
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
  app.get('/terms', (req, res) => render(req, res, { title: 'Terms', body: pub.legalPage({ cfg, which: 'terms' }) }));
  app.get('/privacy', (req, res) => render(req, res, { title: 'Privacy', body: pub.legalPage({ cfg, which: 'privacy' }) }));

  app.get('/gallery', (req, res) => {
    const per = 24;
    const pages = Math.max(1, Math.ceil(artworks.countPublic() / per));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    render(req, res, { title: 'Gallery', body: pub.gallery({ items: artworks.recentPublic(per, (page - 1) * per), thumb, page, pages }) });
  });

  app.get('/artist/:handle', (req, res) => {
    const artist = db.one('SELECT * FROM users WHERE handle = ?', String(req.params.handle));
    if (!artist) return render(req, res, { title: 'Not found', body: notFound() }, 404);
    render(req, res, { title: artist.display_name, body: pub.artistPage({ artist, items: artworks.publicByUser(artist.id), thumb }) });
  });

  app.get('/a/:id', (req, res) => {
    const a = artworks.get(req.params.id);
    if (!a) return render(req, res, { title: 'Not found', body: notFound() }, 404);
    const isOwner = req.user?.id === a.user_id;
    const certValid = verifyCertificate(secrets, a.certificate, a.signature);
    render(req, res, { title: a.title, description: `${a.title} by ${a.display_name}`, body: pub.artworkPage({ cfg, a, src: preview(a.id), isOwner, csrf: req.csrf, certValid }) });
  });

  app.get('/a/:id/certificate.json', (req, res) => {
    const a = artworks.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
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
    if (!a?.ots_proof) return res.status(404).type('text').send('No timestamp proof available yet.');
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${a.id}.ots"` }).send(Buffer.from(a.ots_proof));
  });

  app.post('/a/:id/dispute', authLimit, csrf, ah(async (req, res) => {
    const a = artworks.get(req.params.id);
    if (!a) return render(req, res, { title: 'Not found', body: notFound() }, 404);
    const name = str(req.body.name, 100);
    const email = str(req.body.email, 200);
    const message = str(req.body.message, 4000);
    if (!name || !EMAIL_RE.test(email) || !message) return res.redirect(303, `/a/${a.id}`);
    db.run('INSERT INTO disputes (artwork_id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)', a.id, name, email, message, now());
    if (cfg.adminEmail)
      await mailer.send({ to: cfg.adminEmail, subject: `Dispute for artwork ${a.id}`, text: `Artwork: ${cfg.baseUrl}/a/${a.id}\nFrom: ${name} <${email}>\n\n${message}` });
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
    const r = db.run(
      'INSERT INTO users (email, password_hash, handle, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
      values.email, await hashPassword(password), values.handle, values.display_name, now(),
    );
    sessions.login(res, Number(r.lastInsertRowid));
    res.redirect(303, '/dashboard?msg=welcome');
  }));

  app.get('/login', (req, res) =>
    req.user ? res.redirect('/dashboard') : render(req, res, { title: 'Sign in', body: auth.loginPage({ csrf: req.csrf, next: safeNext(req.query.next) }) }),
  );
  app.post('/login', authLimit, csrf, ah(async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const user = db.one('SELECT * FROM users WHERE email = ?', email);
    const ok = user ? await verifyPassword(String(req.body.password || ''), user.password_hash) : (await hashPassword('timing-equaliser'), false);
    if (!ok)
      return render(req, res, { title: 'Sign in', body: auth.loginPage({ csrf: req.csrf, next: safeNext(req.body.next), email, error: 'Wrong e-mail or password.' }) }, 401);
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

  d.get('/upload', (req, res) => dash_(req, res, 'Register artwork', dash.uploadPage({ csrf: req.csrf })));
  d.post('/upload', heavyLimit, uploadImage, csrf, ah(async (req, res) => {
    const values = {
      title: str(req.body.title, 120), year: str(req.body.year, 10), medium: str(req.body.medium, 80),
      description: str(req.body.description, 2000), visibility: req.body.visibility === 'unlisted' ? 'unlisted' : 'public',
    };
    const fail = (error, conflict) => dash_(req, res, 'Register artwork', dash.uploadPage({ csrf: req.csrf, error, values, conflict }), 400);
    if (!req.file) return fail('Choose an image file (JPEG, PNG, WebP or TIFF).');
    if (!values.title) return fail('Give your artwork a title.');
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
    dash_(req, res, req.artwork.title, dash.artworkEdit({ csrf: req.csrf, a: req.artwork, src: preview(req.artwork.id), matches }));
  });
  d.post('/artworks/:id', csrf, ownArtwork, (req, res) => {
    artworks.update(req.artwork.id, {
      year: str(req.body.year, 10), medium: str(req.body.medium, 80), description: str(req.body.description, 2000), visibility: req.body.visibility,
    });
    res.redirect(303, `/dashboard/artworks/${req.artwork.id}?msg=updated`);
  });
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
      if (db.one('SELECT COUNT(*) n FROM watches WHERE user_id = ?', req.user.id).n >= cfg.maxWatchesPerUser)
        return fail(`You can monitor at most ${cfg.maxWatchesPerUser} pages.`);
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
      noticeType: req.noticeType, notice: noticeFor(req), user: req.user,
    })),
  );
  d.get('/matches/:id/notice.txt', ownMatch, (req, res) =>
    res.type('text/plain').set('Content-Disposition', `attachment; filename="takedown-${req.match.id}-${req.noticeType}.txt"`).send(noticeFor(req)),
  );
  d.post('/matches/:id', csrf, ownMatch, (req, res) => {
    const status = Object.hasOwn(dash.STATUS, req.body.status) ? req.body.status : req.match.status;
    db.run('UPDATE matches SET status = ?, notes = ?, updated_at = ? WHERE id = ?', status, str(req.body.notes, 2000), now(), req.match.id);
    res.redirect(303, `/dashboard/matches/${req.match.id}?msg=updated`);
  });

  // settings
  d.get('/settings', (req, res) => dash_(req, res, 'Settings', dash.settingsPage({ csrf: req.csrf, user: req.user })));
  const settingsFail = (req, res, error) => dash_(req, res, 'Settings', dash.settingsPage({ csrf: req.csrf, user: req.user, error }), 400);
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
    for (const a of artworks.byUser(req.user.id)) await artworks.remove(a.id);
    db.run('DELETE FROM users WHERE id = ?', req.user.id);
    sessions.logout(req, res);
    res.redirect(303, '/?msg=deleted');
  }));

  app.use('/dashboard', d);

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
