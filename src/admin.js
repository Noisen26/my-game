// Moderation: disputes (false claims), hiding works, suspending users.
// Every action is written to admin_log.
import express from 'express';
import { requireAdmin } from './security.js';
import { notFound } from './views/layout.js';
import { now } from './db.js';
import * as view from './views/admin.js';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function createAdminRouter({ cfg, db, artworks, mailer, csrf, render, preview, thumb, ah, websearch }) {
  const r = express.Router();
  r.use(requireAdmin);
  const page = (req, res, title, body, status) => render(req, res, { title: `Admin · ${title}`, body }, status);
  const log = (req, action, target, note = '') =>
    db.run('INSERT INTO admin_log (admin_id, action, target, note, created_at) VALUES (?, ?, ?, ?, ?)', req.user.id, action, target, note, now());

  const DISPUTES = `SELECT d.*, a.title, a.user_id AS owner_id, u.handle AS owner_handle
    FROM disputes d LEFT JOIN artworks a ON a.id = d.artwork_id LEFT JOIN users u ON u.id = a.user_id`;

  const hide = (id, reason) => db.run('UPDATE artworks SET hidden_at = ?, hidden_reason = ? WHERE id = ?', now(), reason, id);
  const suspend = (userId, reason) => {
    db.tx(() => {
      db.run('UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ? AND is_admin = 0', now(), reason, userId);
      db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    });
  };
  const notifyOwner = async (owner, a, what, note) =>
    mailer.send({
      to: owner.email,
      subject: `${cfg.siteName}: your artwork "${a.title}" has been ${what}`,
      text: `Hi ${owner.display_name},\n\nYour artwork "${a.title}" (${cfg.baseUrl}/a/${a.id}) has been ${what} by our moderators` +
        `${note ? `:\n\n${note}` : '.'}\n\nIf you believe this is a mistake, reply to this e-mail with evidence that you are the author.\n\n- ${cfg.siteName}`,
    });

  r.get('/', (req, res) => {
    const n = (sql) => db.one(sql).n;
    const stats = {
      openDisputes: n(`SELECT COUNT(*) n FROM disputes WHERE status = 'open'`),
      users: n('SELECT COUNT(*) n FROM users'),
      artworks: n('SELECT COUNT(*) n FROM artworks'),
      suspended: n('SELECT COUNT(*) n FROM users WHERE suspended_at IS NOT NULL'),
      hidden: n('SELECT COUNT(*) n FROM artworks WHERE hidden_at IS NOT NULL'),
      matches: n('SELECT COUNT(*) n FROM matches'),
      watches: n('SELECT COUNT(*) n FROM watches WHERE active = 1'),
      blockedWatches: n(`SELECT COUNT(*) n FROM watches WHERE active = 1 AND last_status LIKE 'Blocked:%'`),
      searches: websearch?.enabled ? `${websearch.used()} / ${cfg.searchMonthlyLimit}` : 'off',
      searchProvider: websearch?.providerName,
    };
    page(req, res, 'Overview', view.overview({ stats, open: db.all(`${DISPUTES} WHERE d.status = 'open' ORDER BY d.created_at LIMIT 20`) }));
  });

  // ---------------------------------------------------------------- disputes
  r.get('/disputes', (req, res) => {
    const status = ['open', 'resolved', 'all'].includes(req.query.status) ? req.query.status : 'open';
    const where = status === 'all' ? '' : status === 'open' ? `WHERE d.status = 'open'` : `WHERE d.status != 'open'`;
    page(req, res, 'Disputes', view.disputes({ rows: db.all(`${DISPUTES} ${where} ORDER BY d.created_at DESC LIMIT 200`), status }));
  });

  const loadDispute = (req, res, next) => {
    const d = db.one(`${DISPUTES} WHERE d.id = ?`, Number(req.params.id));
    if (!d) return page(req, res, 'Not found', notFound(), 404);
    req.dispute = d;
    req.artwork = artworks.get(d.artwork_id);
    req.owner = req.artwork ? db.one('SELECT * FROM users WHERE id = ?', req.artwork.user_id) : null;
    next();
  };

  r.get('/disputes/:id', loadDispute, (req, res) => {
    const { dispute: d, artwork: a, owner } = req;
    const ownerStats = owner
      ? {
          artworks: db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ?', owner.id).n,
          disputes: db.one('SELECT COUNT(*) n FROM disputes d JOIN artworks a ON a.id = d.artwork_id WHERE a.user_id = ?', owner.id).n,
        }
      : null;
    const others = db.all(`${DISPUTES} WHERE (d.email = ? OR d.artwork_id = ?) AND d.id != ? ORDER BY d.created_at DESC LIMIT 20`, d.email, d.artwork_id, d.id);
    page(req, res, `Dispute #${d.id}`, view.disputeDetail({ csrf: req.csrf, d, a, src: a ? preview(a.id) : null, owner, ownerStats, others }));
  });

  const resolve = (req, resolution, note) =>
    db.run(`UPDATE disputes SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`, resolution, now(), req.user.id, req.dispute.id);

  r.post('/disputes/:id/uphold', csrf, loadDispute, ah(async (req, res) => {
    const { dispute: d, artwork: a, owner } = req;
    if (d.status !== 'open') return res.redirect(303, `/admin/disputes/${d.id}`);
    const note = str(req.body.note, 500);
    resolve(req, 'upheld', note);
    if (a) {
      hide(a.id, note || `Dispute #${d.id} upheld`);
      log(req, 'artwork.hide', a.id, `dispute #${d.id}${note ? `: ${note}` : ''}`);
      await notifyOwner(owner, a, 'hidden', note);
    }
    if (req.body.suspend === '1' && owner && !owner.is_admin) {
      suspend(owner.id, note || `Dispute #${d.id}`);
      log(req, 'user.suspend', `@${owner.handle}`, `dispute #${d.id}${note ? `: ${note}` : ''}`);
    }
    log(req, 'dispute.uphold', `#${d.id}`, note);
    await mailer.send({
      to: d.email,
      subject: `${cfg.siteName}: your report has been upheld`,
      text: `Hi ${d.name},\n\nThank you for your report. We have reviewed it and the registration of "${d.title ?? d.artwork_id}" has been removed from public view.` +
        `${note ? `\n\n${note}` : ''}\n\nYou can now register the work yourself at ${cfg.baseUrl}/signup.\n\n- ${cfg.siteName}`,
    });
    res.redirect(303, `/admin/disputes/${d.id}?msg=updated`);
  }));

  r.post('/disputes/:id/reject', csrf, loadDispute, ah(async (req, res) => {
    const { dispute: d } = req;
    if (d.status !== 'open') return res.redirect(303, `/admin/disputes/${d.id}`);
    const note = str(req.body.note, 500);
    resolve(req, 'rejected', note);
    log(req, 'dispute.reject', `#${d.id}`, note);
    await mailer.send({
      to: d.email,
      subject: `${cfg.siteName}: about your report`,
      text: `Hi ${d.name},\n\nThank you for your report about "${d.title ?? d.artwork_id}". After review we have not been able to confirm the claim, so the registration stays in place.` +
        `${note ? `\n\n${note}` : ''}\n\nIf you have further evidence, such as earlier publication or the original file, reply to this e-mail.\n\n- ${cfg.siteName}`,
    });
    res.redirect(303, `/admin/disputes/${d.id}?msg=updated`);
  }));

  // ---------------------------------------------------------------- users
  r.get('/users', (req, res) => {
    const q = str(req.query.q, 100);
    const filter = ['suspended', 'admin'].includes(req.query.filter) ? req.query.filter : '';
    const conds = [];
    const params = [];
    if (q) {
      conds.push('(u.email LIKE ? OR u.handle LIKE ? OR u.display_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (filter === 'suspended') conds.push('u.suspended_at IS NOT NULL');
    if (filter === 'admin') conds.push('u.is_admin = 1');
    const rows = db.all(
      `SELECT u.*, (SELECT COUNT(*) FROM artworks a WHERE a.user_id = u.id) artworks,
        (SELECT COUNT(*) FROM disputes d JOIN artworks a ON a.id = d.artwork_id WHERE a.user_id = u.id) disputes
       FROM users u ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY u.created_at DESC LIMIT 100`,
      ...params,
    );
    page(req, res, 'Users', view.users({ rows, q, filter }));
  });

  const loadUser = (req, res, next) => {
    const u = db.one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) return page(req, res, 'Not found', notFound(), 404);
    req.target = u;
    next();
  };

  r.get('/users/:id', loadUser, (req, res) => {
    const u = req.target;
    page(req, res, u.display_name, view.userDetail({
      csrf: req.csrf, u, thumb,
      items: artworks.byUser(u.id),
      disputes: db.all(`${DISPUTES} WHERE a.user_id = ? ORDER BY d.created_at DESC`, u.id),
      watches: db.all('SELECT * FROM watches WHERE user_id = ? ORDER BY created_at DESC', u.id),
    }));
  });

  r.post('/users/:id/suspend', csrf, loadUser, (req, res) => {
    if (req.target.is_admin) return res.redirect(303, `/admin/users/${req.target.id}`);
    const note = str(req.body.note, 500);
    suspend(req.target.id, note);
    log(req, 'user.suspend', `@${req.target.handle}`, note);
    res.redirect(303, `/admin/users/${req.target.id}?msg=updated`);
  });

  r.post('/users/:id/unsuspend', csrf, loadUser, (req, res) => {
    db.run(`UPDATE users SET suspended_at = NULL, suspended_reason = '' WHERE id = ?`, req.target.id);
    log(req, 'user.unsuspend', `@${req.target.handle}`);
    res.redirect(303, `/admin/users/${req.target.id}?msg=updated`);
  });

  // ---------------------------------------------------------------- artworks
  const loadArtwork = (req, res, next) => {
    const a = artworks.get(req.params.id);
    if (!a) return page(req, res, 'Not found', notFound(), 404);
    req.artwork = a;
    req.owner = db.one('SELECT * FROM users WHERE id = ?', a.user_id);
    next();
  };

  r.post('/artworks/:id/hide', csrf, loadArtwork, ah(async (req, res) => {
    const note = str(req.body.note, 500);
    hide(req.artwork.id, note);
    log(req, 'artwork.hide', req.artwork.id, note);
    await notifyOwner(req.owner, req.artwork, 'hidden', note);
    res.redirect(303, `/admin/users/${req.owner.id}?msg=updated`);
  }));

  r.post('/artworks/:id/unhide', csrf, loadArtwork, (req, res) => {
    db.run(`UPDATE artworks SET hidden_at = NULL, hidden_reason = '' WHERE id = ?`, req.artwork.id);
    log(req, 'artwork.unhide', req.artwork.id);
    res.redirect(303, `/admin/users/${req.owner.id}?msg=updated`);
  });

  r.post('/artworks/:id/delete', csrf, loadArtwork, ah(async (req, res) => {
    const note = str(req.body.note, 500);
    await artworks.remove(req.artwork.id);
    log(req, 'artwork.delete', `${req.artwork.id} "${req.artwork.title}" by @${req.owner.handle}`, note);
    await notifyOwner(req.owner, req.artwork, 'removed', note);
    res.redirect(303, `/admin/users/${req.owner.id}?msg=deleted`);
  }));

  r.get('/log', (req, res) =>
    page(req, res, 'Audit log', view.log({ rows: db.all('SELECT l.*, u.handle admin_handle FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 500') })),
  );

  return r;
}
