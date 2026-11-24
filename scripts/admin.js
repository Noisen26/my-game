#!/usr/bin/env node
// Grant or revoke admin rights from the command line. Admin rights are never
// granted through the web or by e-mail address, since e-mail is not verified.
//   node scripts/admin.js grant  someone@example.com
//   node scripts/admin.js revoke someone@example.com
//   node scripts/admin.js list
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

const [cmd, email] = process.argv.slice(2);
const db = openDb(loadConfig().dataDir);
if (cmd === 'list') {
  for (const u of db.all('SELECT email, handle FROM users WHERE is_admin = 1')) console.log(`${u.email} (@${u.handle})`);
} else if ((cmd === 'grant' || cmd === 'revoke') && email) {
  const r = db.run('UPDATE users SET is_admin = ? WHERE email = ?', cmd === 'grant' ? 1 : 0, email.toLowerCase());
  console.log(r.changes ? `${cmd === 'grant' ? 'Granted' : 'Revoked'} admin for ${email}` : `No user with e-mail ${email}`);
  process.exitCode = r.changes ? 0 : 1;
} else {
  console.log('Usage: node scripts/admin.js grant|revoke <email> | list');
  process.exitCode = 2;
}
db.close();
