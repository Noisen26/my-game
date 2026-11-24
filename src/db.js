// SQLite via Node's built-in driver. Schema is created/migrated on start.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// node:sqlite prints an ExperimentalWarning on load; silence only that one.
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w?.message ?? w).includes('SQLite is an experimental feature')) return;
  return origEmit.call(this, w, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = origEmit;

const MIGRATIONS = [
  `CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    legal_name TEXT NOT NULL DEFAULT '',
    postal_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE artworks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    medium TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    dhash TEXT NOT NULL,
    phashes TEXT NOT NULL,          -- JSON array: full image + centre crops
    certificate TEXT NOT NULL,      -- canonical JSON that was signed
    signature TEXT NOT NULL,        -- Ed25519, base64
    ots_status TEXT NOT NULL DEFAULT 'queued',  -- queued | pending | failed
    ots_proof BLOB,
    ots_attempts INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'public',  -- public | unlisted
    created_at TEXT NOT NULL
  );
  CREATE INDEX artworks_user ON artworks(user_id);
  CREATE INDEX artworks_sha ON artworks(sha256);
  CREATE TABLE watches (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_checked_at TEXT,
    last_status TEXT,
    UNIQUE(user_id, url)
  );
  CREATE TABLE matches (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    image_url TEXT NOT NULL,
    distance INTEGER NOT NULL,
    evidence_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',  -- new | confirmed | reported | removed | dismissed
    notes TEXT NOT NULL DEFAULT '',
    found_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(artwork_id, image_url)
  );
  CREATE INDEX matches_user ON matches(user_id, status);
  CREATE TABLE disputes (
    id INTEGER PRIMARY KEY,
    artwork_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // 2: moderation
  `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN suspended_at TEXT;
  ALTER TABLE users ADD COLUMN suspended_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE artworks ADD COLUMN hidden_at TEXT;
  ALTER TABLE artworks ADD COLUMN hidden_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE disputes ADD COLUMN resolution TEXT NOT NULL DEFAULT '';
  ALTER TABLE disputes ADD COLUMN resolved_at TEXT;
  ALTER TABLE disputes ADD COLUMN resolved_by INTEGER;
  CREATE INDEX disputes_status ON disputes(status, created_at);
  CREATE TABLE admin_log (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );`,
];

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'artguard.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  // tiny helpers
  db.one = (sql, ...p) => db.prepare(sql).get(...p);
  db.all = (sql, ...p) => db.prepare(sql).all(...p);
  db.run = (sql, ...p) => db.prepare(sql).run(...p);
  db.tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return db;
}

export const now = () => new Date().toISOString();
