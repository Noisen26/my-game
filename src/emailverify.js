// E-mail verification. Required before paying, receiving match alerts and
// generating takedown notices (which carry the artist's e-mail address).
// Also used to change e-mail address: the new address only takes effect
// once the link sent to it is opened.
import { newToken, tokenHash } from './security.js';
import { now } from './db.js';

const TTL_MS = 48 * 3600e3;

export function createEmailVerification({ db, cfg, mailer }) {
  async function send(user, email = user.email) {
    db.run('DELETE FROM email_tokens WHERE user_id = ?', user.id);
    const token = newToken();
    db.run('INSERT INTO email_tokens (token_hash, user_id, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', tokenHash(token), user.id, email, Date.now() + TTL_MS, Date.now());
    const change = email.toLowerCase() !== user.email.toLowerCase();
    await mailer.send({
      to: email,
      subject: change ? `Confirm your new ${cfg.siteName} e-mail address` : `Confirm your e-mail address for ${cfg.siteName}`,
      text: `Hi ${user.display_name},\n\nOpen this link within 48 hours to confirm ${change ? 'your new' : 'your'} e-mail address:\n` +
        `${cfg.baseUrl}/verify-email?token=${token}\n\nIf you did not ${change ? 'ask to change your address' : 'create an account'}, you can ignore this e-mail.\n\n- ${cfg.siteName}`,
    });
  }

  /** Returns the user id on success, or an error message. */
  function consume(token) {
    const row = db.one('SELECT * FROM email_tokens WHERE token_hash = ? AND expires_at > ?', tokenHash(String(token || '')), Date.now());
    if (!row) return { error: 'This link is invalid or has expired. Sign in and request a new one.' };
    const taken = db.one('SELECT id FROM users WHERE email = ? AND id != ?', row.email, row.user_id);
    if (taken) return { error: 'That e-mail address is already used by another account.' };
    db.tx(() => {
      db.run('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?', row.email, now(), row.user_id);
      db.run('DELETE FROM email_tokens WHERE user_id = ?', row.user_id);
    });
    return { userId: row.user_id };
  }

  const pendingEmail = (userId) => db.one('SELECT email FROM email_tokens WHERE user_id = ? AND expires_at > ?', userId, Date.now())?.email ?? null;

  return { send, consume, pendingEmail };
}
