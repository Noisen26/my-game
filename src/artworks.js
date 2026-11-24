// Artwork registration, storage and perceptual matching.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect, makePreview, makeThumb, sha256, fingerprint, distance, MATCH_THRESHOLD } from './imaging.js';
import { signCertificate } from './timestamp.js';
import { now } from './db.js';

export class UserError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

export function createArtworks({ db, cfg, secrets }) {
  const dirs = { originals: join(cfg.dataDir, 'originals'), previews: join(cfg.dataDir, 'previews'), thumbs: join(cfg.dataDir, 'thumbs') };
  Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }));

  const newId = () => {
    for (;;) {
      const id = randomBytes(6).toString('base64url');
      if (/^[A-Za-z0-9]/.test(id) && !db.one('SELECT 1 FROM artworks WHERE id = ?', id)) return id;
    }
  };

  // Publicly visible: not hidden by moderators and the owner is not suspended.
  const VISIBLE = 'a.hidden_at IS NULL AND u.suspended_at IS NULL';
  const SELECT = 'SELECT a.*, u.handle, u.display_name, u.suspended_at AS owner_suspended_at FROM artworks a JOIN users u ON u.id = a.user_id';

  const candidates = (where = '', ...params) =>
    db
      .all(`SELECT a.id, a.user_id, a.dhash, a.phashes FROM artworks a JOIN users u ON u.id = a.user_id ${where}`, ...params)
      .map((r) => ({ ...r, phashes: JSON.parse(r.phashes) }));

  const api = {
    dirs,
    previewPath: (id) => join(dirs.previews, `${id}.jpg`),
    thumbPath: (id) => join(dirs.thumbs, `${id}.jpg`),
    get: (id) => db.one(`${SELECT} WHERE a.id = ?`, String(id)),
    isVisible: (a) => !!a && !a.hidden_at && !a.owner_suspended_at,
    byUser: (userId) => db.all('SELECT * FROM artworks WHERE user_id = ? ORDER BY created_at DESC', userId),
    publicByUser: (userId) =>
      db.all(`SELECT * FROM artworks WHERE user_id = ? AND visibility = 'public' AND hidden_at IS NULL ORDER BY created_at DESC`, userId),
    recentPublic: (limit = 24, offset = 0) =>
      db.all(`${SELECT} WHERE a.visibility = 'public' AND ${VISIBLE} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, limit, offset),
    countPublic: () =>
      db.one(`SELECT COUNT(*) n FROM artworks a JOIN users u ON u.id = a.user_id WHERE a.visibility = 'public' AND ${VISIBLE}`).n,
    /** Visible registrations of an exact file. */
    bySha: (sha) => db.all(`${SELECT} WHERE a.sha256 = ? AND ${VISIBLE} ORDER BY a.created_at`, sha),

    /** Registered artworks perceptually matching a suspect fingerprint. */
    findMatches(fp, { userId } = {}) {
      const rows = userId ? candidates('WHERE a.user_id = ?', userId) : candidates(`WHERE ${VISIBLE}`);
      return rows
        .map((r) => ({ id: r.id, user_id: r.user_id, distance: distance(fp, r) }))
        .filter((r) => r.distance <= MATCH_THRESHOLD)
        .sort((a, b) => a.distance - b.distance);
    },

    async register(user, buf, fields) {
      const count = db.one('SELECT COUNT(*) n FROM artworks WHERE user_id = ?', user.id).n;
      if (count >= cfg.maxArtworksPerUser) throw new UserError('You have reached the maximum number of artworks for your account.');

      let meta;
      try {
        meta = await inspect(buf);
      } catch {
        throw new UserError('The file could not be read as an image. Use JPEG, PNG, WebP or TIFF.');
      }
      const sha = sha256(buf);
      const own = db.one('SELECT id FROM artworks WHERE sha256 = ? AND user_id = ?', sha, user.id);
      if (own) throw new UserError('You have already registered this exact file.', { existing: own.id });
      const same = api.bySha(sha);
      if (same.length) throw new UserError('This exact file is already registered by another artist.', { conflict: same[0].id });

      const fp = await fingerprint(buf);
      // Guard against "claim-jacking": someone registering an artist's work first.
      const clash = api.findMatches(fp).find((m) => m.user_id !== user.id);
      if (clash)
        throw new UserError('This image closely matches an artwork already registered by another artist.', { conflict: clash.id });

      const id = newId();
      const pageUrl = `${cfg.baseUrl}/a/${id}`;
      const createdAt = now();
      const preview = await makePreview(buf, { artist: user.display_name, title: fields.title, url: `${cfg.host}/a/${id}`, maxPx: cfg.previewMaxPx });
      const thumb = await makeThumb(preview);
      const { body, signature } = signCertificate(secrets, {
        type: 'artwork-registration',
        version: 1,
        id,
        title: fields.title,
        artist: user.display_name,
        artistHandle: user.handle,
        sha256: sha,
        width: meta.width,
        height: meta.height,
        registeredAt: createdAt,
        url: pageUrl,
        issuer: cfg.baseUrl,
      });

      const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
      await writeFile(join(dirs.originals, `${id}.${ext}`), buf, { mode: 0o600 });
      await writeFile(api.previewPath(id), preview);
      await writeFile(api.thumbPath(id), thumb);
      db.run(
        `INSERT INTO artworks (id, user_id, title, description, year, medium, format, width, height, bytes, sha256, dhash, phashes,
           certificate, signature, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, user.id, fields.title, fields.description || '', fields.year || '', fields.medium || '', ext, meta.width, meta.height,
        buf.length, sha, fp.dhash, JSON.stringify(fp.phashes), body, signature, fields.visibility === 'unlisted' ? 'unlisted' : 'public', createdAt,
      );
      return api.get(id);
    },

    update(id, fields) {
      db.run(
        'UPDATE artworks SET description = ?, year = ?, medium = ?, visibility = ? WHERE id = ?',
        fields.description || '', fields.year || '', fields.medium || '', fields.visibility === 'unlisted' ? 'unlisted' : 'public', id,
      );
    },

    async remove(id) {
      const a = db.one('SELECT id, format FROM artworks WHERE id = ?', id);
      if (!a) return;
      db.run('DELETE FROM artworks WHERE id = ?', id);
      await Promise.all([
        unlink(join(dirs.originals, `${id}.${a.format}`)).catch(() => {}),
        unlink(api.previewPath(id)).catch(() => {}),
        unlink(api.thumbPath(id)).catch(() => {}),
      ]);
    },
  };
  return api;
}
