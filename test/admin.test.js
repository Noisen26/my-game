import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp, artwork, otherArtwork, shopCopy } from './helpers.js';

const CLI = fileURLToPath(new URL('../scripts/admin.js', import.meta.url));
let env, admin, thief, realArtist, stolenId, thiefOther;
const unesc = (s) => s.replace(/&amp;/g, '&');

before(async () => {
  env = await startApp();
  admin = env.client();
  await admin.signup('moderator');
  thief = env.client();
  await thief.signup('thief');
  realArtist = env.client();
  await realArtist.signup('realartist');
  stolenId = (await thief.upload('/dashboard/upload', { title: 'Stolen sunset' }, await artwork())).headers.get('location').match(/\/a\/([\w-]+)/)[1];
  thiefOther = (await thief.upload('/dashboard/upload', { title: 'Other work' }, await otherArtwork())).headers.get('location').match(/\/a\/([\w-]+)/)[1];
});
after(() => env.stop());

test('admin area is hidden from non-admins', async () => {
  assert.equal((await env.client().get('/admin')).status, 303);
  assert.equal((await thief.get('/admin')).status, 404);
  assert.equal((await admin.get('/admin')).status, 404);
  assert.ok(!(await admin.text('/dashboard')).html.includes('href="/admin"'));
});

test('admin rights are granted from the command line', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, DATA_DIR: env.dir }, encoding: 'utf8' });
  assert.match(run('grant', 'moderator@example.com').stdout, /Granted admin/);
  assert.equal(run('grant', 'nobody@example.com').status, 1);
  assert.match(run('list').stdout, /moderator@example.com/);
});

test('admin sees the overview and the nav link', async () => {
  const { status, html } = await admin.text('/admin');
  assert.equal(status, 200);
  assert.match(html, /Moderation/);
  assert.ok(html.includes('href="/admin"'));
});

test('a false claim is reported, upheld, and the real artist can register', async () => {
  // the real artist cannot register while the stolen registration is visible
  assert.match(await (await realArtist.upload('/dashboard/upload', { title: 'My sunset' }, await artwork())).text(), /already registered by another artist/);

  await realArtist.post(`/a/${stolenId}/dispute`, { name: 'Real Artist', email: 'realartist@example.com', message: 'I painted this in 2019.' });
  const alert = env.ctx.mailer.outbox.findLast((m) => m.to === 'moderator@example.com');
  assert.match(alert.subject, /new dispute about "Stolen sunset"/);
  const disputeUrl = alert.text.match(/\/admin\/disputes\/\d+/)[0];

  const detail = (await admin.text(disputeUrl)).html;
  assert.match(detail, /I painted this in 2019/);
  assert.match(detail, /thief@example.com/);
  const preview = unesc(detail.match(/src="(\/img\/[^"]+)"/)[1]);

  await admin.post(`${disputeUrl}/uphold`, { note: 'Earlier publication verified.', suspend: '1' });

  // hidden everywhere public
  const anon = env.client();
  assert.equal((await anon.get(`/a/${stolenId}`)).status, 404);
  assert.equal((await anon.get(`/a/${stolenId}/certificate.json`)).status, 404);
  assert.equal((await anon.get(preview)).status, 403);
  assert.ok(!(await anon.text('/gallery')).html.includes('Stolen sunset'));
  assert.equal((await anon.get('/artist/thief')).status, 404);
  assert.match(await (await anon.upload('/check', {}, await shopCopy())).text(), /No registered artwork matches/);
  // admin can still review it
  assert.equal((await admin.get(`/a/${stolenId}`)).status, 200);

  // the owner is suspended and signed out
  assert.equal((await thief.get('/dashboard')).status, 303);
  const login = await thief.post('/login', { email: 'thief@example.com', password: 'correct horse battery' });
  assert.equal(login.status, 403);
  assert.match(await login.text(), /suspended/);

  // both parties are told
  assert.match(env.ctx.mailer.outbox.findLast((m) => m.to === 'thief@example.com').subject, /has been hidden/);
  const toReporter = env.ctx.mailer.outbox.findLast((m) => m.to === 'realartist@example.com');
  assert.match(toReporter.subject, /upheld/);
  assert.match(toReporter.text, /Earlier publication verified/);

  // and the real artist can now register the work
  const r = await realArtist.upload('/dashboard/upload', { title: 'My sunset' }, await artwork());
  assert.equal(r.status, 303, await r.text());
});

test('rejecting a report keeps the artwork and tells the reporter', async () => {
  const ok = env.client();
  await ok.signup('honest');
  const id = (await ok.upload('/dashboard/upload', { title: 'Honest work' }, await artwork(2))).headers.get('location').match(/\/a\/([\w-]+)/)[1];
  await env.client().post(`/a/${id}/dispute`, { name: 'Troll', email: 'troll@example.com', message: 'mine!!' });
  const dId = env.ctx.db.one('SELECT id FROM disputes WHERE artwork_id = ?', id).id;
  await admin.post(`/admin/disputes/${dId}/reject`, { note: 'No evidence provided.' });
  assert.equal((await env.client().get(`/a/${id}`)).status, 200);
  assert.match(env.ctx.mailer.outbox.findLast((m) => m.to === 'troll@example.com').text, /No evidence provided/);
  assert.equal(env.ctx.db.one('SELECT resolution FROM disputes WHERE id = ?', dId).resolution, 'rejected');
  // resolved disputes cannot be decided again
  await admin.post(`/admin/disputes/${dId}/uphold`, {});
  assert.equal(env.ctx.db.one('SELECT resolution FROM disputes WHERE id = ?', dId).resolution, 'rejected');
});

test('users: search, suspend and lift; admins cannot be suspended', async () => {
  assert.match((await admin.text('/admin/users?q=honest')).html, /@honest/);
  assert.match((await admin.text('/admin/users?filter=suspended')).html, /@thief/);
  const honestId = env.ctx.db.one(`SELECT id FROM users WHERE handle = 'honest'`).id;
  await admin.post(`/admin/users/${honestId}/suspend`, { note: 'spam' });
  assert.ok(env.ctx.db.one('SELECT suspended_at FROM users WHERE id = ?', honestId).suspended_at);
  await admin.post(`/admin/users/${honestId}/unsuspend`);
  assert.equal(env.ctx.db.one('SELECT suspended_at FROM users WHERE id = ?', honestId).suspended_at, null);
  const modId = env.ctx.db.one(`SELECT id FROM users WHERE handle = 'moderator'`).id;
  await admin.post(`/admin/users/${modId}/suspend`, { note: 'x' });
  assert.equal(env.ctx.db.one('SELECT suspended_at FROM users WHERE id = ?', modId).suspended_at, null);
});

test('artworks: hide, unhide, delete', async () => {
  await admin.post(`/admin/artworks/${thiefOther}/unhide`);
  await admin.post(`/admin/artworks/${thiefOther}/hide`, { note: 'test' });
  assert.ok(env.ctx.artworks.get(thiefOther).hidden_at);
  await admin.post(`/admin/artworks/${thiefOther}/unhide`);
  assert.equal(env.ctx.artworks.get(thiefOther).hidden_at, null);
  await admin.post(`/admin/artworks/${thiefOther}/delete`, { note: 'cleanup' });
  assert.equal(env.ctx.artworks.get(thiefOther), undefined);
});

test('suspended users are not monitored', async () => {
  const thiefId = env.ctx.db.one(`SELECT id FROM users WHERE handle = 'thief'`).id;
  env.ctx.db.run(`INSERT INTO watches (user_id, url, created_at) VALUES (?, 'http://127.0.0.1:9/', '2000-01-01')`, thiefId);
  await env.ctx.monitor.runDue();
  assert.equal(env.ctx.db.one('SELECT last_checked_at FROM watches WHERE user_id = ?', thiefId).last_checked_at, null);
});

test('every action is in the audit log; admin posts need CSRF', async () => {
  const html = (await admin.text('/admin/log')).html;
  for (const a of ['dispute.uphold', 'artwork.hide', 'user.suspend', 'dispute.reject', 'user.unsuspend', 'artwork.unhide', 'artwork.delete']) assert.ok(html.includes(a), a);
  const honestId = env.ctx.db.one(`SELECT id FROM users WHERE handle = 'honest'`).id;
  assert.equal((await admin.post(`/admin/users/${honestId}/suspend`, {}, { csrf: false })).status, 403);
});
