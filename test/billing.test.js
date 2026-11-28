import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { startApp, startShop, artwork, shopCopy } from './helpers.js';
import { verifyStripeSignature, stripeForm } from '../src/billing.js';

const art = (i) =>
  sharp({ create: { width: 400 + i * 37, height: 500, channels: 3, background: { r: (i * 53) % 255, g: (i * 97) % 255, b: (i * 31) % 255 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><circle cx="${60 + i * 50}" cy="${80 + i * 60}" r="${40 + i * 10}" fill="#fff"/><rect x="${300 - i * 40}" y="${400 - i * 50}" width="60" height="${30 + i * 15}" fill="#000"/></svg>`) }])
    .png()
    .toBuffer();
const lastMailTo = (env, to) => env.ctx.mailer.outbox.findLast((m) => m.to === to);
const msgOf = (r) => r.headers.get('location')?.split('msg=')[1];

test('Stripe form encoding and signature verification', () => {
  assert.equal(
    decodeURIComponent(stripeForm({ mode: 'subscription', line_items: [{ price: 'p_1', quantity: 1 }], metadata: { user_id: '7' }, skip: null }).toString()),
    'mode=subscription&line_items[0][price]=p_1&line_items[0][quantity]=1&metadata[user_id]=7',
  );
  const body = '{"id":"evt_1"}';
  const t = 1_700_000_000;
  const sig = createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex');
  assert.ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_x', 300, t + 10));
  assert.ok(verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${sig}`, 'whsec_x', 300, t));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_x', 300, t + 301), 'too old');
  assert.ok(!verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_x', 300, t), 'tampered');
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_other', 300, t), 'wrong secret');
  assert.ok(!verifyStripeSignature(body, undefined, 'whsec_x'));
});

describe('e-mail verification', () => {
  let env, c, shop;
  before(async () => {
    env = await startApp();
    shop = await startShop([await shopCopy()]);
    c = env.client();
    await c.signup('newbie', { verify: false });
  });
  after(async () => {
    await env.stop();
    await shop.stop();
  });

  test('a confirmation link is sent at signup and the dashboard asks for it', async () => {
    assert.match(lastMailTo(env, 'newbie@example.com').subject, /Confirm your e-mail address/);
    assert.match((await c.text('/dashboard')).html, /Confirm your e-mail address \(newbie@example\.com\)/);
  });

  test('unconfirmed accounts get no alerts and cannot generate notices', async () => {
    await c.upload('/dashboard/upload', { title: 'Sunset' }, await artwork());
    const before = env.ctx.mailer.outbox.length;
    await c.post('/dashboard/monitor', { url: `${shop.url}/product`, mode: 'watch' });
    assert.equal(env.ctx.mailer.outbox.length, before, 'no alert to an unconfirmed address');
    const id = env.ctx.db.one('SELECT id FROM matches').id;
    const html = (await c.text(`/dashboard/matches/${id}`)).html;
    assert.match(html, /Confirm your e-mail address to generate takedown notices/);
    assert.ok(!html.includes('penalty of perjury'));
    assert.equal((await c.get(`/dashboard/matches/${id}/notice.txt`)).status, 303);
  });

  test('resending replaces the old link; the link confirms the address once', async () => {
    const first = lastMailTo(env, 'newbie@example.com').text.match(/token=([\w-]+)/)[1];
    assert.equal(msgOf(await c.post('/dashboard/verify-email/resend')), 'verify-sent');
    assert.equal((await c.get(`/verify-email?token=${first}`)).status, 400, 'old link no longer works');
    const r = await c.verifyEmail('newbie@example.com');
    assert.equal(msgOf(r), 'email-verified');
    assert.ok(env.ctx.db.one(`SELECT email_verified_at FROM users WHERE handle = 'newbie'`).email_verified_at);
    assert.ok(!(await c.text('/dashboard')).html.includes('Confirm your e-mail address ('));
    assert.equal((await c.get(`/verify-email?token=${lastMailTo(env, 'newbie@example.com').text.match(/token=([\w-]+)/)[1]}`)).status, 400, 'single use');
    const id = env.ctx.db.one('SELECT id FROM matches').id;
    assert.match((await c.text(`/dashboard/matches/${id}`)).html, /penalty of perjury/);
  });

  test('changing e-mail only takes effect after confirming the new address', async () => {
    assert.match(await (await c.post('/dashboard/settings/email', { email: 'new@example.com', password: 'wrong' })).text(), /Wrong password/);
    const other = env.client();
    await other.signup('taken');
    assert.match(await (await c.post('/dashboard/settings/email', { email: 'taken@example.com', password: 'correct horse battery' })).text(), /already used/);
    assert.equal(msgOf(await c.post('/dashboard/settings/email', { email: 'New@Example.com', password: 'correct horse battery' })), 'email-change-sent');
    assert.equal(env.ctx.db.one(`SELECT email FROM users WHERE handle = 'newbie'`).email, 'newbie@example.com');
    assert.match((await c.text('/dashboard/settings')).html, /Waiting for confirmation of new@example\.com/);
    await c.verifyEmail('new@example.com');
    assert.equal(env.ctx.db.one(`SELECT email FROM users WHERE handle = 'newbie'`).email, 'new@example.com');
    assert.equal((await c.post('/login', { email: 'new@example.com', password: 'correct horse battery' })).status, 303);
  });

  test('a password reset also confirms the address', async () => {
    const d = env.client();
    await d.signup('forgetful', { verify: false });
    await d.post('/logout');
    await d.post('/forgot', { email: 'forgetful@example.com' });
    const token = lastMailTo(env, 'forgetful@example.com').text.match(/reset\?token=([\w-]+)/)[1];
    await d.post('/reset', { token, password: 'another long password' });
    assert.ok(env.ctx.db.one(`SELECT email_verified_at FROM users WHERE handle = 'forgetful'`).email_verified_at);
  });
});

describe('plan limits (Free)', () => {
  let env, c;
  before(async () => {
    env = await startApp({
      signupPlan: null,
      searchProviderOverride: { name: 'Fake', search: async () => [] },
      etsyClientOverride: { name: 'Etsy', searchNewest: async () => [], listing: async () => null, shop: async () => null, shopListings: async () => [] },
    });
    c = env.client();
    await c.signup('freebie');
  });
  after(() => env.stop());

  test('new accounts are on Free; pricing and billing pages show it', async () => {
    assert.equal(env.ctx.db.one(`SELECT plan FROM users WHERE handle = 'freebie'`).plan, 'free');
    const pricing = (await env.client().text('/pricing')).html;
    for (const re of [/Free/, /Artist/, /Studio/, /SEK\s79\b/, /SEK\s199\b/]) assert.match(pricing, re);
    assert.match((await env.client().text('/pricing?interval=yearly')).html, /SEK\s790\b/);
    const billing = (await c.text('/dashboard/billing')).html;
    assert.match(billing, /Your plan: Free/);
    assert.match(billing, /Coming soon/, 'no Stripe configured');
  });

  test('artwork limit', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await c.upload('/dashboard/upload', { title: `Work ${i}` }, await art(i))).status, 303, `work ${i}`);
    const r = await c.upload('/dashboard/upload', { title: 'One too many' }, await art(6));
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Free plan includes 5 artworks/);
    assert.match((await c.text('/dashboard/billing')).html, /5 \/ 5/);
  });

  test('paid features are refused on Free', async () => {
    const id = env.ctx.db.one('SELECT id FROM artworks LIMIT 1').id;
    assert.equal(msgOf(await c.post(`/dashboard/artworks/${id}/search`)), 'plan-required');
    assert.equal(msgOf(await c.post(`/dashboard/artworks/${id}/market`)), 'plan-required');
    assert.equal(msgOf(await c.post(`/dashboard/artworks/${id}/hot`, { on: '1' })), 'plan-required');
    assert.equal(env.ctx.artworks.get(id).hot_until, null);
    assert.equal(await env.ctx.discovery.marketplaceDue(), 0);
  });

  test('web search runs monthly on Free, weekly once upgraded', async () => {
    env.ctx.db.run(`UPDATE artworks SET web_search = 1, last_searched_at = ?`, new Date(Date.now() - 10 * 864e5).toISOString());
    assert.equal(await env.ctx.websearch.searchDue(), 0);
    env.ctx.db.run(`UPDATE users SET comp_plan = 'artist'`);
    const { syncPlan } = await import('../src/plans.js');
    syncPlan(env.ctx.db, env.ctx.db.one(`SELECT id FROM users WHERE handle = 'freebie'`).id);
    assert.equal(await env.ctx.websearch.searchDue(), 5);
    env.ctx.db.run(`UPDATE users SET comp_plan = NULL, plan = 'free'`);
  });

  test('monitored pages: limit on adding and in the scheduler', async () => {
    const shop = await startShop([await shopCopy()]);
    try {
      assert.equal((await c.post('/dashboard/monitor', { url: `${shop.url}/product`, mode: 'watch' })).status, 303);
      assert.equal((await c.post('/dashboard/monitor', { url: `${shop.url}/`, mode: 'watch' })).status, 303);
      const r = await c.post('/dashboard/monitor', { url: `${shop.url}/redirect`, mode: 'watch' });
      assert.match(await r.text(), /Free plan includes 2 monitored pages/);
      // a third page that got in earlier (e.g. before a downgrade) is not scanned
      const uid = env.ctx.db.one(`SELECT id FROM users WHERE handle = 'freebie'`).id;
      env.ctx.db.run(`INSERT INTO watches (user_id, url, created_at) VALUES (?, ?, '2999-01-01')`, uid, `${shop.url}/redirect`);
      env.ctx.db.run('UPDATE watches SET last_checked_at = NULL');
      await env.ctx.monitor.runDue();
      assert.equal(env.ctx.db.one('SELECT last_checked_at FROM watches WHERE created_at = ?', '2999-01-01').last_checked_at, null);
      assert.equal(env.ctx.db.one('SELECT COUNT(*) n FROM watches WHERE last_checked_at IS NOT NULL').n, 2);
    } finally {
      await shop.stop();
    }
  });
});

describe('Stripe', () => {
  let env, stripe, c, uid;
  const WHSEC = 'whsec_test';
  const subs = new Map();

  const send = async (type, object, id = `evt_${Math.random().toString(36).slice(2)}`) => {
    const body = JSON.stringify({ id, type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex');
    const r = await fetch(`${env.base}/stripe/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}`, 'user-agent': 'Stripe/1.0' } });
    return { status: r.status, json: await r.json() };
  };
  const sub = (id, price, extra = {}) => ({
    id, object: 'subscription', customer: 'cus_123', status: 'active', cancel_at_period_end: false, metadata: { user_id: String(uid) },
    items: { data: [{ price: { id: price }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }, ...extra,
  });

  before(async () => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        calls.push({ method: req.method, url: req.url, body: new URLSearchParams(body), auth: req.headers.authorization });
        const json = (o, s = 200) => res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(o));
        if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return json({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
        if (req.method === 'POST' && req.url === '/v1/billing_portal/sessions') return json({ url: 'https://billing.stripe.test/p_1' });
        const m = req.url.match(/^\/v1\/subscriptions\/([\w]+)$/);
        if (m && req.method === 'GET') return json(subs.get(m[1]));
        if (m && req.method === 'DELETE') return json({ ...subs.get(m[1]), status: 'canceled' });
        json({ error: { message: 'not found' } }, 404);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    stripe = { calls, stop: () => server.close() };
    env = await startApp({
      signupPlan: null,
      stripeSecretKey: 'sk_test_x', stripeWebhookSecret: WHSEC, stripeEndpoint: `http://127.0.0.1:${server.address().port}`,
      stripePrices: { artist: { monthly: 'price_artist_m', yearly: 'price_artist_y' }, studio: { monthly: 'price_studio_m', yearly: null } },
    });
    c = env.client();
    await c.signup('payer', { verify: false });
    uid = env.ctx.db.one(`SELECT id FROM users WHERE handle = 'payer'`).id;
  });
  after(async () => {
    await env.stop();
    stripe.stop();
  });

  test('checkout requires a confirmed e-mail address', async () => {
    const r = await c.post('/dashboard/billing/checkout', { plan: 'artist', interval: 'monthly' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Verify your e-mail address before upgrading/);
    assert.equal(stripe.calls.length, 0);
  });

  test('checkout creates a Stripe Checkout session and redirects to it', async () => {
    await c.verifyEmail('payer@example.com');
    const html = (await c.text('/dashboard/billing')).html;
    assert.match(html, /Upgrade to Artist/);
    assert.match((await c.text('/dashboard/billing?interval=yearly')).html, /Coming soon/, 'studio yearly has no price');
    const r = await c.post('/dashboard/billing/checkout', { plan: 'artist', interval: 'monthly' });
    assert.equal(r.headers.get('location'), 'https://checkout.stripe.test/cs_1');
    const call = stripe.calls.at(-1);
    assert.equal(call.auth, 'Bearer sk_test_x');
    assert.equal(call.body.get('mode'), 'subscription');
    assert.equal(call.body.get('line_items[0][price]'), 'price_artist_m');
    assert.equal(call.body.get('customer_email'), 'payer@example.com');
    assert.equal(call.body.get('client_reference_id'), String(uid));
    assert.equal(call.body.get('subscription_data[metadata][user_id]'), String(uid));
    assert.equal(call.body.get('allow_promotion_codes'), 'true');
    assert.equal((await c.post('/dashboard/billing/checkout', { plan: 'studio', interval: 'yearly' })).status, 400);
  });

  test('webhooks must be signed by Stripe', async () => {
    const r = await fetch(`${env.base}/stripe/webhook`, { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=00', 'user-agent': 'Stripe/1.0' } });
    assert.equal(r.status, 400);
  });

  test('a completed checkout activates the plan, once', async () => {
    subs.set('sub_1', sub('sub_1', 'price_artist_m'));
    const evt = { id: 'cs_1', object: 'checkout.session', customer: 'cus_123', subscription: 'sub_1', client_reference_id: String(uid), metadata: { user_id: String(uid) } };
    assert.equal((await send('checkout.session.completed', evt, 'evt_done')).json.result, 'ok');
    const u = env.ctx.db.one('SELECT * FROM users WHERE id = ?', uid);
    assert.deepEqual([u.plan, u.sub_plan, u.sub_interval, u.sub_status, u.stripe_customer_id], ['artist', 'artist', 'monthly', 'active', 'cus_123']);
    assert.match(lastMailTo(env, 'payer@example.com').subject, /now on the Artist plan/);
    assert.equal((await send('checkout.session.completed', evt, 'evt_done')).json.result, 'duplicate');
    const html = (await c.text('/dashboard/billing')).html;
    assert.match(html, /Your plan: Artist/);
    assert.match(html, /Renews on/);
    assert.match(html, /Manage subscription/);
  });

  test('a second checkout is refused; changes go through the customer portal', async () => {
    const r = await c.post('/dashboard/billing/checkout', { plan: 'studio', interval: 'monthly' });
    assert.match(await r.text(), /already have a subscription/);
    const p = await c.post('/dashboard/billing/portal');
    assert.equal(p.headers.get('location'), 'https://billing.stripe.test/p_1');
    assert.equal(stripe.calls.at(-1).body.get('customer'), 'cus_123');
  });

  test('plan changes, cancellation at period end, failed payment, end of subscription', async () => {
    await send('customer.subscription.updated', sub('sub_1', 'price_studio_m'));
    assert.equal(env.ctx.db.one('SELECT plan FROM users WHERE id = ?', uid).plan, 'studio');

    await send('customer.subscription.updated', sub('sub_1', 'price_studio_m', { cancel_at_period_end: true }));
    assert.match((await c.text('/dashboard/billing')).html, /subscription ends on/);

    await send('invoice.payment_failed', { object: 'invoice', customer: 'cus_123' });
    assert.match(lastMailTo(env, 'payer@example.com').subject, /payment failed/);
    await send('customer.subscription.updated', sub('sub_1', 'price_studio_m', { status: 'past_due' }));
    assert.equal(env.ctx.db.one('SELECT plan FROM users WHERE id = ?', uid).plan, 'studio', 'grace while Stripe retries');
    assert.match((await c.text('/dashboard/billing')).html, /last payment failed/);

    await send('customer.subscription.deleted', sub('sub_1', 'price_studio_m', { status: 'canceled' }));
    assert.equal(env.ctx.db.one('SELECT plan FROM users WHERE id = ?', uid).plan, 'free');
    assert.match(lastMailTo(env, 'payer@example.com').text, /stay protected/);
  });

  test('a plan granted by an admin outlives a cancelled subscription', async () => {
    const admin = env.client();
    await admin.signup('boss');
    spawnSync(process.execPath, [new URL('../scripts/admin.js', import.meta.url).pathname, 'grant', 'boss@example.com'], { env: { ...process.env, DATA_DIR: env.dir } });
    await admin.post(`/admin/users/${uid}/plan`, { plan: 'artist' });
    assert.equal(env.ctx.db.one('SELECT plan FROM users WHERE id = ?', uid).plan, 'artist');
    assert.match((await admin.text('/admin/log')).html, /user\.plan/);
    await admin.post(`/admin/users/${uid}/plan`, { plan: '' });
    assert.equal(env.ctx.db.one('SELECT plan FROM users WHERE id = ?', uid).plan, 'free');
  });

  test('deleting the account cancels an active subscription first', async () => {
    subs.set('sub_2', sub('sub_2', 'price_artist_y'));
    await send('customer.subscription.created', sub('sub_2', 'price_artist_y'));
    assert.equal(env.ctx.db.one('SELECT plan, sub_interval FROM users WHERE id = ?', uid).sub_interval, 'yearly');
    await c.post('/dashboard/settings/delete', { password: 'correct horse battery' });
    assert.ok(stripe.calls.some((x) => x.method === 'DELETE' && x.url === '/v1/subscriptions/sub_2'));
    assert.equal(env.ctx.db.one('SELECT COUNT(*) n FROM users WHERE id = ?', uid).n, 0);
  });
});
