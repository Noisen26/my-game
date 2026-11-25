import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { startApp, startShop, artwork, otherArtwork, shopCopy } from './helpers.js';
import { deriveShop } from '../src/offenders.js';
import { phrasesFor } from '../src/discovery.js';
import { etsyItems, ebayItems } from '../src/marketplaces.js';

const idFrom = (r) => r.headers.get('location').match(/\/a\/([\w-]+)/)[1];
const copyOf = async (seed) => sharp(await artwork(seed)).resize(640).jpeg({ quality: 60 }).toBuffer();

function fakeApi(routes) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body: Buffer.concat(chunks).toString() });
      for (const [re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m) {
          const out = fn(m, url, req);
          return res.writeHead(out.status || 200, { 'content-type': 'application/json' }).end(JSON.stringify(out.body ?? out));
        }
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, calls, stop: () => server.close() })));
}

// ---------------------------------------------------------------- units

test('shop derivation', async () => {
  assert.deepEqual(await deriveShop('https://www.amazon.de/dp/B0X?th=1', { html: '<a href="/gp/aag/main?seller=A1B2C3D4E5F6G7">x</a>' }), {
    kind: 'amazon', ref: 'A1B2C3D4E5F6G7', url: 'https://www.amazon.de/s?me=A1B2C3D4E5F6G7', label: 'Amazon seller A1B2C3D4E5F6G7',
  });
  assert.equal((await deriveShop('https://www.amazon.com/s?k=poster&me=A9Z8Y7X6W5V4U3')).ref, 'A9Z8Y7X6W5V4U3');
  assert.equal(await deriveShop('https://www.amazon.com/dp/B0X'), null);
  assert.deepEqual(await deriveShop('https://Posters-Cheap.com/products/sunset?v=1'), { kind: 'web', ref: 'https://posters-cheap.com', url: 'https://posters-cheap.com/', label: 'posters-cheap.com' });
  assert.equal((await deriveShop('https://cool-prints.myshopify.com/products/x')).kind, 'web');
  for (const u of ['https://www.temu.com/x.html', 'https://www.pinterest.com/pin/1', 'https://www.redbubble.com/i/poster/x', 'https://i.etsystatic.com/x.jpg'])
    assert.equal(await deriveShop(u), null, u);
  const etsy = { listing: async () => ({ shop_id: 77 }), shop: async () => ({ shop_name: 'CheapArt', url: 'https://www.etsy.com/shop/CheapArt' }) };
  assert.deepEqual(await deriveShop('https://www.etsy.com/listing/123/sunset', { etsy }), { kind: 'etsy', ref: '77', url: 'https://www.etsy.com/shop/CheapArt', label: 'Etsy: CheapArt' });
  const ebay = { itemByLegacyId: async (id) => ({ seller: { username: `seller_${id}` } }) };
  assert.equal((await deriveShop('https://www.ebay.com/itm/123456789012', { ebay })).ref, 'seller_123456789012');
  assert.equal((await deriveShop('https://www.ebay.co.uk/usr/poster_king')).ref, 'poster_king');
});

test('keyword phrases and API item mapping', () => {
  assert.deepEqual(phrasesFor({ title: 'Evening light', keywords: '' }), ['Evening light']);
  assert.deepEqual(phrasesFor({ title: 'X', keywords: 'sunset poster,  minimalist  print; a, sunset poster, wall art, more' }), ['sunset poster', 'minimalist print', 'wall art']);
  assert.deepEqual(etsyItems([{ listing_id: 1, url: 'https://www.etsy.com/listing/1', shop_id: 5, images: [{ url_570xN: 'a' }, { url_fullxfull: 'b' }, { url_570xN: 'c' }] }])[0].imageUrls, ['a', 'b']);
  assert.deepEqual(ebayItems([{ itemWebUrl: 'https://ebay/itm/1', image: { imageUrl: 'i' }, seller: { username: 's' } }, { itemWebUrl: 'x' }]), [
    { pageUrl: 'https://ebay/itm/1', title: '', seller: 's', imageUrls: ['i'] },
  ]);
});

// ---------------------------------------------------------------- integration

describe('repeat sellers and hot mode', () => {
  let env, shop, shopImages, anna, bert, annaArt, bertArt;

  before(async () => {
    shopImages = [await shopCopy()];
    shop = await startShop(shopImages);
    env = await startApp({ hotViewThreshold: 3, searchProviderOverride: { name: 'Fake', search: async () => [] }, searchMonthlyLimit: 100 });
    anna = env.client();
    await anna.signup('anna');
    bert = env.client();
    await bert.signup('bert');
    annaArt = idFrom(await anna.upload('/dashboard/upload', { title: 'Evening light' }, await artwork()));
    bertArt = idFrom(await bert.upload('/dashboard/upload', { title: 'Green triangle' }, await otherArtwork()));
  });
  after(async () => {
    await env.stop();
    await shop.stop();
  });

  test("a copy in a shop makes it a repeat seller; the artwork goes on close watch", async () => {
    await anna.post('/dashboard/monitor', { url: `${shop.url}/product`, mode: 'once' });
    const o = env.ctx.db.one('SELECT * FROM offenders');
    assert.equal(o.kind, 'web');
    assert.equal(o.url, `${shop.url}/`);
    assert.equal(o.match_count, 1);
    assert.equal(env.ctx.db.one('SELECT offender_id FROM matches').offender_id, o.id);
    const a = env.ctx.artworks.get(annaArt);
    assert.ok(env.ctx.discovery.isHot(a));
    assert.equal(a.hot_reason, 'copy found');
  });

  test("the seller's next stolen work is found for another artist, without that artist doing anything", async () => {
    shopImages.push(await sharp(await otherArtwork()).resize(500).jpeg({ quality: 65 }).toBuffer());
    const before = env.ctx.mailer.outbox.length;
    assert.equal(await env.ctx.offenders.scanDue(), 1);
    const m = env.ctx.db.one('SELECT * FROM matches WHERE artwork_id = ?', bertArt);
    assert.equal(m.source, 'offender');
    assert.equal(m.user_id, env.ctx.db.one(`SELECT id FROM users WHERE handle = 'bert'`).id);
    const mail = env.ctx.mailer.outbox.slice(before);
    assert.deepEqual(mail.map((x) => x.to), ['bert@example.com']);
    assert.match(env.ctx.db.one('SELECT last_status FROM offenders').last_status, /2 image\(s\) checked, 1 new match/);
    assert.equal(env.ctx.db.one('SELECT match_count FROM offenders').match_count, 2);
    assert.equal(await env.ctx.offenders.scanDue(), 0, 'not due again for a day');
    assert.match((await bert.text('/dashboard/matches')).html, /repeat seller/);
  });

  test('a shop stops being scanned when all its matches are dismissed', async () => {
    for (const c of [anna, bert]) {
      const { id } = env.ctx.db.one('SELECT m.id FROM matches m JOIN users u ON u.id = m.user_id WHERE u.handle = ?', c === anna ? 'anna' : 'bert');
      await c.post(`/dashboard/matches/${id}`, { status: 'dismissed' });
    }
    assert.equal(env.ctx.db.one('SELECT active FROM offenders').active, 0);
    const { id } = env.ctx.db.one(`SELECT m.id FROM matches m JOIN users u ON u.id = m.user_id WHERE u.handle = 'anna'`);
    await anna.post(`/dashboard/matches/${id}`, { status: 'confirmed' });
    assert.equal(env.ctx.db.one('SELECT active FROM offenders').active, 1);
  });

  test('admins see repeat sellers and can pause them', async () => {
    const { spawnSync } = await import('node:child_process');
    spawnSync(process.execPath, [new URL('../scripts/admin.js', import.meta.url).pathname, 'grant', 'anna@example.com'], { env: { ...process.env, DATA_DIR: env.dir } });
    assert.match((await anna.text('/admin/offenders')).html, new RegExp(new URL(shop.url).host.replace('.', '\\.')));
    const oid = env.ctx.db.one('SELECT id FROM offenders').id;
    await anna.post(`/admin/offenders/${oid}/toggle`);
    assert.equal(env.ctx.db.one('SELECT active FROM offenders').active, 0);
    env.ctx.offenders.refresh(oid); // a moderator's pause sticks
    assert.equal(env.ctx.db.one('SELECT active FROM offenders').active, 0);
    await anna.post(`/admin/offenders/${oid}/toggle`);
    assert.equal(env.ctx.db.one('SELECT active FROM offenders').active, 1);
  });

  test("an artist's own website is never treated as a repeat seller", async () => {
    const own = await startShop([await copyOf(1)]);
    try {
      const c = env.client();
      await c.signup('carla');
      await c.post('/dashboard/settings/profile', { display_name: 'Carla', website: own.url });
      await c.upload('/dashboard/upload', { title: 'Mine' }, await artwork(1));
      const r = await env.ctx.monitor.scan(env.ctx.db.one(`SELECT id FROM users WHERE handle = 'carla'`).id, `${own.url}/product`);
      assert.equal(r.created.length, 1);
      assert.equal(env.ctx.db.one('SELECT COUNT(*) n FROM offenders').n, 1);
    } finally {
      await own.stop();
    }
  });

  test('views on ARTGUARD put a trending work on close watch and tell the artist', async () => {
    const { discovery, db, mailer } = env.ctx;
    for (const ip of ['1.1.1.1', '1.1.1.1', '2.2.2.2']) discovery.recordView(bertArt, ip);
    assert.equal(db.one('SELECT n FROM artwork_views WHERE artwork_id = ?', bertArt).n, 2, 'same visitor counted once a day');
    db.run('UPDATE artworks SET hot_until = NULL WHERE id = ?', bertArt);
    assert.equal(await discovery.checkTrending(), 0);
    discovery.recordView(bertArt, '3.3.3.3');
    assert.equal(await discovery.checkTrending(), 1);
    assert.equal(env.ctx.artworks.get(bertArt).hot_reason, 'trending');
    assert.match(mailer.outbox.at(-1).subject, /"Green triangle" is trending/);
    // views by the owner are not counted
    const before = db.one('SELECT n FROM artwork_views WHERE artwork_id = ?', bertArt).n;
    await bert.get(`/a/${bertArt}`);
    assert.equal(db.one('SELECT n FROM artwork_views WHERE artwork_id = ?', bertArt).n, before);
  });

  test('close watch can be switched on and off by the artist, and makes web search daily', async () => {
    const { db, websearch, artworks } = env.ctx;
    await bert.post(`/dashboard/artworks/${bertArt}/hot`, { on: '0' });
    assert.equal(artworks.get(bertArt).hot_until, null);
    db.run(`UPDATE artworks SET web_search = 1, last_searched_at = ?`, new Date(Date.now() - 2 * 864e5).toISOString());
    db.run(`UPDATE artworks SET hot_until = NULL`);
    assert.equal(await websearch.searchDue(), 0, 'normal works: weekly');
    await bert.post(`/dashboard/artworks/${bertArt}/hot`, { on: '1' });
    assert.equal(artworks.get(bertArt).hot_reason, 'marked by artist');
    assert.match((await bert.text(`/dashboard/artworks/${bertArt}`)).html, /Close watch is on/);
    assert.equal(await websearch.searchDue(), 1, 'hot works: daily');
    assert.ok(artworks.get(bertArt).last_searched_at > new Date(Date.now() - 60e3).toISOString());
  });
});

describe('Etsy and eBay', () => {
  let env, shop, etsyApi, ebayApi, anna, annaArt;

  before(async () => {
    shop = await startShop([await shopCopy(), await otherArtwork(), await copyOf(1), await sharp(await artwork()).resize(800).webp().toBuffer(), await sharp(await artwork(1)).resize(700).webp().toBuffer()]);
    const img = (i) => `${shop.url}/img/${i}.jpg`;
    etsyApi = await fakeApi([
      [/\/listings\/active$/, (m, url) => ({ count: 2, results: url.pathname.startsWith('/v3/application/shops/') ? [{ listing_id: 3 }] : [{ listing_id: 1 }, { listing_id: 2 }] })],
      [/\/listings\/batch$/, (m, url) => ({
        results: url.searchParams.get('listing_ids').split(',').map((id) => ({
          listing_id: Number(id), shop_id: 77, url: `https://www.etsy.com/listing/${id}/poster`,
          images: [{ url_570xN: img({ 1: 0, 2: 1, 3: 2 }[id]) }],
        })),
      })],
      [/\/listings\/(\d+)$/, (m) => ({ listing_id: Number(m[1]), shop_id: 77 })],
      [/\/shops\/77$/, () => ({ shop_id: 77, shop_name: 'CheapArtCo', url: 'https://www.etsy.com/shop/CheapArtCo' })],
    ]);
    ebayApi = await fakeApi([
      [/\/identity\/v1\/oauth2\/token$/, () => ({ access_token: 'tok123', expires_in: 7200 })],
      [/\/item_summary\/search_by_image$/, () => ({ itemSummaries: [{ itemId: 'v1|1', itemWebUrl: 'https://www.ebay.com/itm/123456789012', image: { imageUrl: img(3) }, seller: { username: 'poster_king' } }] })],
      [/\/item_summary\/search$/, (m, url) => ({ itemSummaries: url.searchParams.get('filter') ? [{ itemWebUrl: 'https://www.ebay.com/itm/999999999999', image: { imageUrl: img(4) } }] : [] })],
      [/\/item\/get_item_by_legacy_id$/, () => ({ seller: { username: 'poster_king' } })],
    ]);
    env = await startApp({
      etsyApiKey: 'ekey', etsySharedSecret: 'esecret', etsyEndpoint: etsyApi.url,
      ebayClientId: 'cid', ebayClientSecret: 'csecret', ebayEndpoint: ebayApi.url,
    });
    anna = env.client();
    await anna.signup('anna');
    annaArt = idFrom(await anna.upload('/dashboard/upload', { title: 'Evening light', keywords: 'sunset poster, minimalist print', web_search: '1' }, await artwork()));
    await anna.upload('/dashboard/upload', { title: 'Other one' }, await artwork(1));
  });
  after(async () => {
    await env.stop();
    await shop.stop();
    etsyApi.stop();
    ebayApi.stop();
  });

  test('marketplace search finds copies among new listings, through the official APIs', async () => {
    const r = await anna.post(`/dashboard/artworks/${annaArt}/market`);
    assert.equal(r.headers.get('location'), `/dashboard/artworks/${annaArt}?msg=market-done`);

    const etsyCalls = etsyApi.calls.filter((c) => c.path === '/v3/application/listings/active');
    assert.deepEqual(etsyCalls.map((c) => c.query.get('keywords')), ['sunset poster', 'minimalist print']);
    assert.equal(etsyCalls[0].query.get('sort_on'), 'created');
    assert.ok(etsyApi.calls.every((c) => c.headers['x-api-key'] === 'ekey:esecret'));

    const tokenCall = ebayApi.calls.find((c) => c.path.endsWith('/oauth2/token'));
    assert.equal(tokenCall.headers.authorization, `Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    const img = ebayApi.calls.find((c) => c.path.endsWith('/search_by_image'));
    assert.equal(img.headers.authorization, 'Bearer tok123');
    assert.equal(img.headers['x-ebay-c-marketplace-id'], 'EBAY_US');
    assert.ok(JSON.parse(img.body).image.length > 1000);
    assert.equal(ebayApi.calls.filter((c) => c.path.endsWith('/oauth2/token')).length, 1, 'token is cached');

    const rows = env.ctx.db.all('SELECT source, page_url FROM matches ORDER BY source, page_url');
    assert.deepEqual(rows.map((x) => [x.source, x.page_url]), [
      ['ebay', 'https://www.ebay.com/itm/123456789012'],
      ['etsy', 'https://www.etsy.com/listing/1/poster'],
    ]);
    assert.match(env.ctx.artworks.get(annaArt).last_market_status, /^OK - .* 2 new match/);
    assert.match((await anna.text('/dashboard/matches')).html, /badge" title="Found among new Etsy listings/);
  });

  test('the Etsy shop and eBay seller become repeat sellers and are scanned through the APIs', async () => {
    const os = env.ctx.db.all('SELECT kind, ref, label FROM offenders ORDER BY kind').map((r) => ({ ...r }));
    assert.deepEqual(os, [
      { kind: 'ebay', ref: 'poster_king', label: 'eBay: poster_king' },
      { kind: 'etsy', ref: '77', label: 'Etsy: CheapArtCo' },
    ]);
    assert.equal(await env.ctx.offenders.scanDue(), 2);
    const shopScan = etsyApi.calls.find((c) => c.path === '/v3/application/shops/77/listings/active');
    assert.ok(shopScan);
    const sellerScan = ebayApi.calls.find((c) => c.path.endsWith('/item_summary/search') && c.query.get('filter'));
    assert.equal(sellerScan.query.get('filter'), 'sellers:{poster_king}');
    assert.equal(sellerScan.query.get('sort'), 'newlyListed');
    // both shops also sell a copy of Anna's second work
    const second = env.ctx.db.all(`SELECT m.source FROM matches m JOIN artworks a ON a.id = m.artwork_id WHERE a.title = 'Other one' ORDER BY m.page_url`);
    assert.deepEqual(second.map((x) => x.source), ['offender', 'offender']);
  });

  test('eBay image search is skipped for artworks without web-search consent', async () => {
    const other = env.ctx.db.one(`SELECT id FROM artworks WHERE title = 'Other one'`).id;
    const n = ebayApi.calls.filter((c) => c.path.endsWith('/search_by_image')).length;
    await env.ctx.discovery.searchMarketplaces(other);
    assert.equal(ebayApi.calls.filter((c) => c.path.endsWith('/search_by_image')).length, n);
  });

  test('daily API limits are enforced and reported', async () => {
    env.ctx.cfg.etsyDailyLimit = env.ctx.usage.used('etsy');
    const r = await env.ctx.discovery.searchMarketplaces(annaArt);
    assert.ok(r.errors.some((e) => /Etsy: daily API limit/i.test(e) || /etsy: daily API limit/.test(e)));
    assert.match(env.ctx.artworks.get(annaArt).last_market_status, /daily API limit/);
    assert.match((await anna.text(`/dashboard/artworks/${annaArt}`)).html, /New marketplace listings/);
  });
});
