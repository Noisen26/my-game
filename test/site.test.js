import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { startApp, startShop, artwork, otherArtwork, shopCopy, mockup } from './helpers.js';

let env, shop;
const unesc = (s) => s.replace(/&amp;/g, '&');
const imgSrc = (html) => unesc(html.match(/src="(\/(?:img|thumb)\/[^"]+)"/)[1]);

before(async () => {
  env = await startApp();
  shop = await startShop([await shopCopy(), await otherArtwork(), await mockup()]);
});
after(async () => {
  await shop.stop();
  await env.stop();
});

describe('public site', () => {
  test('main pages render', async () => {
    const c = env.client();
    for (const p of ['/', '/gallery', '/how-it-works', '/check', '/verify', '/login', '/signup', '/terms', '/privacy', '/forgot', '/bot']) {
      const { status, html } = await c.text(p);
      assert.equal(status, 200, p);
      assert.match(html, /<title>/, p);
    }
    assert.equal((await c.get('/nope')).status, 404);
    assert.equal((await c.get('/a/doesnotexist')).status, 404);
  });

  test('security and opt-out headers', async () => {
    const r = await env.client().get('/');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('tdm-reservation'), '1');
    assert.match(r.headers.get('x-robots-tag'), /noai/);
    assert.match(await (await env.client().get('/robots.txt')).text(), /User-agent: GPTBot\nDisallow: \//);
    assert.deepEqual(await (await env.client().get('/.well-known/tdmrep.json')).json(), [{ location: '/', 'tdm-reservation': 1 }]);
  });

  test('AI crawlers are refused', async () => {
    for (const ua of ['Mozilla/5.0 (compatible; GPTBot/1.2)', 'CCBot/2.0', 'Bytespider', 'img2dataset/1.0'])
      assert.equal((await env.client(ua).get('/gallery')).status, 403, ua);
  });
});

describe('accounts', () => {
  test('sign up, sign out, sign in', async () => {
    const c = env.client();
    await c.signup('anna');
    assert.ok(c.cookies.sid);
    assert.match((await c.text('/dashboard')).html, /Hi, Artist anna/);
    await c.post('/logout');
    assert.ok(!c.cookies.sid);
    assert.equal((await c.get('/dashboard')).headers.get('location'), '/login?next=%2Fdashboard');
    const bad = await c.post('/login', { email: 'anna@example.com', password: 'wrong password!!' });
    assert.equal(bad.status, 401);
    const ok = await c.post('/login', { email: 'ANNA@example.com', password: 'correct horse battery', next: '/dashboard/settings' });
    assert.equal(ok.headers.get('location'), '/dashboard/settings');
  });

  test('signup validation', async () => {
    const c = env.client();
    const r = await c.post('/signup', { display_name: 'X', handle: 'anna', email: 'other@example.com', password: 'correct horse battery', terms: '1' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /profile address is taken/);
    const r2 = await c.post('/signup', { display_name: 'X', handle: 'shorty', email: 's@example.com', password: 'short', terms: '1' });
    assert.match(await r2.text(), /at least 10 characters/);
  });

  test('CSRF: posts without a valid token are rejected', async () => {
    const c = env.client();
    await c.get('/');
    assert.equal((await c.post('/login', { email: 'a@b.c', password: 'x' }, { csrf: false })).status, 403);
    assert.equal((await c.post('/login', { _csrf: 'forged-token-forged-token', email: 'a@b.c', password: 'x' }, { csrf: false })).status, 403);
    const cross = await c.req('/logout', { method: 'POST', body: new URLSearchParams({ _csrf: c.csrf }), headers: { origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);
  });

  test('password reset by e-mail', async () => {
    const c = env.client();
    await c.signup('resetme');
    await c.post('/logout');
    await c.post('/forgot', { email: 'resetme@example.com' });
    const mail = env.ctx.mailer.outbox.findLast((m) => m.to === 'resetme@example.com');
    const token = mail.text.match(/token=([\w-]+)/)[1];
    const r = await c.post('/reset', { token, password: 'a brand new password' });
    assert.equal(r.headers.get('location'), '/login?msg=reset-done');
    assert.equal((await c.post('/reset', { token, password: 'reuse attempt 123' })).status, 400);
    assert.equal((await c.post('/login', { email: 'resetme@example.com', password: 'a brand new password' })).status, 303);
  });
});

describe('artworks', () => {
  let anna, artId, page;

  before(async () => {
    anna = env.client();
    await anna.post('/login', { email: 'anna@example.com', password: 'correct horse battery' });
    await anna.post('/dashboard/settings/legal', { legal_name: 'Anna Lind', postal_address: 'Storgatan 1, 111 22 Stockholm' });
    const r = await anna.upload('/dashboard/upload', { title: 'Evening <light>', year: '2026', medium: 'Gouache', description: 'A sunset.' }, await artwork());
    assert.equal(r.status, 303, await r.text());
    artId = r.headers.get('location').match(/^\/a\/([\w-]+)\?msg=uploaded$/)[1];
    page = (await anna.text(`/a/${artId}`)).html;
  });

  test('artwork page shows a valid signed certificate; title is escaped', () => {
    assert.match(page, /Signature valid/);
    assert.match(page, /Evening &lt;light&gt;/);
    assert.ok(!page.includes('Evening <light>'));
  });

  test('certificate.json verifies against the published public key', async () => {
    const c = env.client();
    const cert = await (await c.get(`/a/${artId}/certificate.json`)).json();
    const pem = await (await c.get('/.well-known/signing-key.pem')).text();
    assert.ok(verify(null, Buffer.from(cert.payloadCanonical), createPublicKey(pem), Buffer.from(cert.signature, 'base64')));
    assert.equal(cert.payload.id, artId);
    assert.equal(cert.payload.artistHandle, 'anna');
    const tampered = cert.payloadCanonical.replace('anna', 'thief');
    assert.ok(!verify(null, Buffer.from(tampered), createPublicKey(pem), Buffer.from(cert.signature, 'base64')));
  });

  test('public image is a small watermarked JPEG with copyright EXIF; original is never served', async () => {
    const c = env.client();
    const r = await c.get(imgSrc(page));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
    const buf = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(Math.max(meta.width, meta.height) <= 1000);
    assert.match(meta.exif.toString('latin1'), /AI training are prohibited/);
    // the original file exists privately, but no route exposes it
    assert.equal(readdirSync(join(env.dir, 'originals')).length, 1);
    for (const p of [`/originals/${artId}.png`, `/data/originals/${artId}.png`, `/static/../data/originals/${artId}.png`])
      assert.notEqual((await c.get(p)).status, 200, p);
  });

  test('image URLs must be signed, unexpired, and not fetched by scripts', async () => {
    const c = env.client();
    assert.equal((await c.get(`/img/${artId}`)).status, 403);
    assert.equal((await c.get(`/img/${artId}?exp=9999999999&sig=forged`)).status, 403);
    const thumbUrl = imgSrc((await c.text('/gallery')).html);
    assert.equal((await c.get(thumbUrl)).status, 200);
    assert.equal((await c.get(thumbUrl.replace('/thumb/', '/img/'))).status, 403, 'thumb signature is not valid for full preview');
    assert.equal((await env.client('python-requests/2.32').get(thumbUrl)).status, 403);
    assert.equal((await env.client('Mozilla/5.0 HeadlessChrome/130').get(thumbUrl)).status, 403);
  });

  test('blockchain timestamp is submitted and the .ots proof can be downloaded', async () => {
    await env.ctx.monitor.stampPending();
    const r = await env.client().get(`/a/${artId}/proof.ots`);
    assert.equal(r.status, 200);
    const ots = Buffer.from(await r.arrayBuffer());
    assert.equal(ots.subarray(0, 31).toString('hex'), '004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294');
    assert.equal(ots[31], 1); // version
    assert.equal(ots[32], 0x08); // sha256
    const sha = env.ctx.artworks.get(artId).sha256;
    assert.equal(ots.subarray(33, 65).toString('hex'), sha);
  });

  test('verify: the original file is recognised by its SHA-256', async () => {
    const c = env.client();
    const ok = await (await c.upload('/verify', {}, await artwork(), 'file')).text();
    assert.match(ok, /This is the registered original/);
    const no = await (await c.upload('/verify', {}, await shopCopy(), 'file')).text();
    assert.match(no, /No registration exists for this exact file/);
    const byHash = await (await c.post('/verify', { sha256: env.ctx.artworks.get(artId).sha256 })).text();
    assert.match(byHash, /This is the registered original/);
  });

  test('find copies: altered copies match, unrelated images do not', async () => {
    const c = env.client();
    assert.match(await (await c.upload('/check', {}, await shopCopy())).text(), /1 registered artwork match/);
    assert.match(await (await c.upload('/check', {}, await mockup())).text(), /1 registered artwork match/);
    assert.match(await (await c.upload('/check', {}, await otherArtwork())).text(), /No registered artwork matches/);
  });

  test('claim-jacking: another user cannot register the same work', async () => {
    const thief = env.client();
    await thief.signup('thief');
    const exact = await (await thief.upload('/dashboard/upload', { title: 'Mine now' }, await artwork())).text();
    assert.match(exact, /already registered by another artist/);
    const altered = await (await thief.upload('/dashboard/upload', { title: 'Mine now' }, await shopCopy())).text();
    assert.match(altered, /closely matches an artwork already registered/);
    const dup = await (await anna.upload('/dashboard/upload', { title: 'Again' }, await artwork())).text();
    assert.match(dup, /already registered this exact file/);
  });

  test('other users cannot edit or delete an artwork', async () => {
    const thief = env.client();
    await thief.post('/login', { email: 'thief@example.com', password: 'correct horse battery' });
    assert.equal((await thief.get(`/dashboard/artworks/${artId}`)).status, 404);
    assert.equal((await thief.post(`/dashboard/artworks/${artId}/delete`)).status, 404);
    assert.ok(env.ctx.artworks.get(artId));
  });

  test('anyone can report a false claim', async () => {
    const r = await env.client().post(`/a/${artId}/dispute`, { name: 'Real Artist', email: 'real@example.com', message: 'I painted this in 2019, see my Instagram.' });
    assert.equal(r.headers.get('location'), `/a/${artId}?msg=dispute-sent`);
    assert.equal(env.ctx.db.one('SELECT COUNT(*) n FROM disputes').n, 1);
  });

  describe('monitor and takedowns', () => {
    let matchId;

    test('one-off scan of a shop page finds the copy and the mock-up', async () => {
      const html = await (await anna.post('/dashboard/monitor', { url: `${shop.url}/redirect`, mode: 'once' })).text();
      assert.match(html, /<strong>2 matches<\/strong> \(2 new\)/);
      const rows = env.ctx.db.all('SELECT * FROM matches WHERE artwork_id = ? ORDER BY image_url', artId);
      assert.deepEqual(rows.map((r) => new URL(r.image_url).pathname), ['/img/0.jpg', '/img/2.jpg']);
      assert.equal(rows[0].page_url, `${shop.url}/product`);
      matchId = rows[0].id;
    });

    test('watching a page scans it, de-duplicates, and e-mails only new matches', async () => {
      const before = env.ctx.mailer.outbox.length;
      const r = await anna.post('/dashboard/monitor', { url: `${shop.url}/product`, label: 'Poster shop', mode: 'watch' });
      assert.equal(r.headers.get('location'), '/dashboard/monitor?msg=watch-added');
      const html = (await anna.text('/dashboard/monitor')).html;
      assert.match(html, /Poster shop/);
      assert.match(html, /3 image\(s\) checked, 0 new match\(es\)/);
      assert.equal(env.ctx.mailer.outbox.length, before, 'no mail for already-known matches');
      assert.equal(env.ctx.db.one('SELECT COUNT(*) n FROM matches').n, 2);
      // a new copy appears in the shop -> e-mail
      env.ctx.db.run('DELETE FROM matches WHERE id = ?', matchId);
      const w = env.ctx.db.one('SELECT * FROM watches');
      await env.ctx.monitor.scanWatch(w);
      const mail = env.ctx.mailer.outbox.at(-1);
      assert.equal(mail.to, 'anna@example.com');
      assert.match(mail.subject, /1 possible copy/);
      matchId = env.ctx.db.one('SELECT id FROM matches ORDER BY id DESC').id;
    });

    test('scheduler re-scans due pages', async () => {
      env.ctx.db.run(`UPDATE watches SET last_checked_at = '2000-01-01T00:00:00.000Z'`);
      await env.ctx.monitor.runDue();
      assert.notEqual(env.ctx.db.one('SELECT last_checked_at FROM watches').last_checked_at, '2000-01-01T00:00:00.000Z');
    });

    test('match review page with pre-filled DMCA and DSA notices', async () => {
      const dmca = (await anna.text(`/dashboard/matches/${matchId}`)).html;
      assert.match(dmca, /penalty of perjury/);
      assert.match(dmca, /Anna Lind/);
      assert.match(dmca, /Storgatan 1/);
      assert.ok(dmca.includes(`${shop.url}/product`));
      const dsa = (await anna.text(`/dashboard/matches/${matchId}?notice=dsa`)).html;
      assert.match(dsa, /Article 16/);
      const txt = await anna.get(`/dashboard/matches/${matchId}/notice.txt?notice=dsa`);
      assert.match(txt.headers.get('content-disposition'), /attachment/);
      assert.match(await txt.text(), /^Subject: Notice of illegal content/);
    });

    test('match status workflow and filtering', async () => {
      await anna.post(`/dashboard/matches/${matchId}`, { status: 'reported', notes: 'Sent to Etsy 24/11' });
      assert.equal(env.ctx.db.one('SELECT status, notes FROM matches WHERE id = ?', matchId).status, 'reported');
      const list = (await anna.text('/dashboard/matches?status=reported')).html;
      assert.match(list, new RegExp(`/dashboard/matches/${matchId}"`));
      const thief = env.client();
      await thief.post('/login', { email: 'thief@example.com', password: 'correct horse battery' });
      assert.equal((await thief.get(`/dashboard/matches/${matchId}`)).status, 404);
    });

    test('Shopify stores are read through their product JSON', async () => {
      const r = await env.ctx.monitor.scan(env.ctx.db.one(`SELECT id FROM users WHERE handle = 'anna'`).id, `${shop.url}/shopify/products/sunset`);
      assert.equal(r.source, 'shopify');
      assert.equal(r.checked, 3);
      assert.equal(r.hits.length, 2);
    });

    test('blocked and JavaScript-only pages give clear messages', async () => {
      const blocked = await (await anna.post('/dashboard/monitor', { url: `${shop.url}/blocked`, mode: 'once' })).text();
      assert.match(blocked, /blocks automated access \(HTTP 403\)/);
      const spa = await (await anna.post('/dashboard/monitor', { url: `${shop.url}/spa`, mode: 'once' })).text();
      assert.match(spa, /No product images were found/);
      await anna.post('/dashboard/monitor', { url: `${shop.url}/blocked`, mode: 'watch' });
      assert.match(env.ctx.db.one('SELECT last_status FROM watches WHERE url LIKE ?', '%/blocked').last_status, /^Blocked: /);
    });

    test('monitor rejects private addresses when not explicitly allowed', async () => {
      const strict = await startApp({ allowPrivateFetch: false });
      try {
        const c = strict.client();
        await c.signup('strict');
        for (const url of ['http://127.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd']) {
          const r = await c.post('/dashboard/monitor', { url, mode: 'once' });
          assert.equal(r.status, 400, url);
        }
      } finally {
        await strict.stop();
      }
    });
  });

  test('deleting the account removes all files and data', async () => {
    const c = env.client();
    await c.signup('leaver');
    const r = await c.upload('/dashboard/upload', { title: 'Temp' }, await otherArtwork());
    const id = r.headers.get('location').match(/\/a\/([\w-]+)/)[1];
    assert.ok(existsSync(join(env.dir, 'previews', `${id}.jpg`)));
    assert.equal((await c.post('/dashboard/settings/delete', { password: 'wrong' })).status, 400);
    await c.post('/dashboard/settings/delete', { password: 'correct horse battery' });
    assert.ok(!existsSync(join(env.dir, 'previews', `${id}.jpg`)));
    assert.ok(!existsSync(join(env.dir, 'originals', `${id}.png`)));
    assert.equal(env.ctx.artworks.get(id), undefined);
    assert.equal(env.ctx.db.one(`SELECT COUNT(*) n FROM users WHERE handle = 'leaver'`).n, 0);
  });
});
