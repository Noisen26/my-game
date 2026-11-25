import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp, startShop, artwork, otherArtwork, shopCopy } from './helpers.js';
import { parseGoogle, parseTineye } from '../src/websearch.js';

// Fake provider APIs that record what they receive.
function fakeApi(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const out = handler(req);
      res.writeHead(out.status || 200, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, calls, stop: () => server.close() })));
}

let shop, google, env, artist, artId;

before(async () => {
  shop = await startShop([await shopCopy(), await otherArtwork()]);
  google = await fakeApi(() => ({
    body: {
      responses: [{
        webDetection: {
          pagesWithMatchingImages: [
            { url: `${shop.url}/product`, pageTitle: 'Poster', fullMatchingImages: [{ url: `${shop.url}/img/0.jpg` }] },
            // a "partial match" that is actually a different work: must be rejected by our own check
            { url: `${shop.url}/other`, partialMatchingImages: [{ url: `${shop.url}/img/1.jpg` }] },
            // our own site: must be ignored
            { url: 'http://localhost:3999/a/xyz', fullMatchingImages: [{ url: 'http://localhost:3999/img/xyz' }] },
          ],
          // an exact match the provider knows about but that cannot be downloaded
          fullMatchingImages: [{ url: `${shop.url}/img/404.jpg` }],
          visuallySimilarImages: [{ url: `${shop.url}/img/1.jpg` }],
        },
      }],
    },
  }));
  env = await startApp({ searchProvider: 'google', googleVisionKey: 'test-key', visionEndpoint: google.url, searchMonthlyLimit: 3 });
  artist = env.client();
  await artist.signup('searcher');
  const r = await artist.upload('/dashboard/upload', { title: 'Searched sunset', web_search: '1' }, await artwork());
  artId = r.headers.get('location').match(/\/a\/([\w-]+)/)[1];
});
after(async () => {
  await env.stop();
  await shop.stop();
  google.stop();
});

test('provider response parsing', () => {
  const g = parseGoogle({
    pagesWithMatchingImages: [{ url: 'https://p', fullMatchingImages: [{ url: 'https://i1' }], partialMatchingImages: [{ url: 'https://i2' }] }],
    fullMatchingImages: [{ url: 'https://i3' }],
    visuallySimilarImages: [{ url: 'https://ignored' }],
  });
  assert.deepEqual(g.map((x) => [x.pageUrl, x.imageUrl, x.full]), [['https://p', 'https://i1', true], ['https://p', 'https://i2', false], ['https://i3', 'https://i3', true]]);
  const t = parseTineye({ results: { matches: [{ image_url: 'https://img', backlinks: [{ url: 'https://img', backlink: 'https://page' }] }, { image_url: 'https://lone' }] } });
  assert.deepEqual(t.map((x) => [x.pageUrl, x.imageUrl]), [['https://page', 'https://img'], ['https://lone', 'https://lone']]);
});

test('opting in is stored; the upload page offers it', async () => {
  assert.equal(env.ctx.artworks.get(artId).web_search, 1);
  assert.match((await artist.text('/dashboard/upload')).html, /Search the whole web for copies/);
});

test('scheduled search finds verified copies, rejects look-alikes, keeps unverified exact matches', async () => {
  const n = await env.ctx.websearch.searchDue();
  assert.equal(n, 1);
  const call = google.calls[0];
  assert.equal(call.headers['x-goog-api-key'], 'test-key');
  const req = JSON.parse(call.body);
  assert.equal(req.requests[0].features[0].type, 'WEB_DETECTION');
  assert.ok(req.requests[0].image.content.length > 1000);

  const rows = env.ctx.db.all('SELECT * FROM matches WHERE artwork_id = ? ORDER BY image_url', artId);
  assert.deepEqual(rows.map((r) => [new URL(r.image_url).pathname, r.source, r.verified]), [
    ['/img/0.jpg', 'search', 1],
    ['/img/404.jpg', 'search', 0],
  ]);
  assert.ok(rows[0].distance <= 10);
  assert.equal(rows[0].page_url, `${shop.url}/product`);
  assert.match(env.ctx.artworks.get(artId).last_search_status, /1 verified, 1 unverified, 2 new/);
  assert.match(env.ctx.mailer.outbox.at(-1).subject, /2 possible copies/);
  // not due again until next week
  assert.equal(await env.ctx.websearch.searchDue(), 0);
});

test('match pages show the source and the unverified warning', async () => {
  const list = (await artist.text('/dashboard/matches')).html;
  assert.match(list, /web search/);
  assert.match(list, /unverified/);
  const unv = env.ctx.db.one('SELECT id FROM matches WHERE verified = 0').id;
  assert.match((await artist.text(`/dashboard/matches/${unv}`)).html, /could not be downloaded to\s+confirm it/);
});

test('"Search now" is limited to once a day; opting out stops scheduled searches', async () => {
  const r = await artist.post(`/dashboard/artworks/${artId}/search`);
  assert.equal(r.headers.get('location'), `/dashboard/artworks/${artId}?msg=search-recent`);
  await artist.post(`/dashboard/artworks/${artId}`, { visibility: 'public' }); // checkbox unticked
  assert.equal(env.ctx.artworks.get(artId).web_search, 0);
  env.ctx.db.run('UPDATE artworks SET last_searched_at = NULL');
  assert.equal(await env.ctx.websearch.searchDue(), 0);
});

test('the monthly budget is a hard cap', async () => {
  const before = google.calls.length;
  env.ctx.db.run('UPDATE artworks SET last_searched_at = NULL');
  assert.equal((await artist.post(`/dashboard/artworks/${artId}/search`)).headers.get('location').split('msg=')[1], 'search-done');
  assert.equal((await artist.post(`/dashboard/artworks/${artId}/search`)).headers.get('location').split('msg=')[1], 'search-recent');
  env.ctx.db.run('UPDATE artworks SET last_searched_at = NULL');
  await artist.post(`/dashboard/artworks/${artId}/search`); // 3rd and last allowed call
  env.ctx.db.run('UPDATE artworks SET last_searched_at = NULL');
  assert.equal((await artist.post(`/dashboard/artworks/${artId}/search`)).headers.get('location').split('msg=')[1], 'search-budget');
  assert.equal(google.calls.length - before, 2);
  assert.equal(env.ctx.websearch.used(), 3);
  // no duplicate matches from repeated searches
  assert.equal(env.ctx.db.one('SELECT COUNT(*) n FROM matches').n, 2);
});

test('provider errors are reported, not thrown at the user', async () => {
  const broken = await fakeApi(() => ({ status: 403, body: { error: { message: 'API key not valid.' } } }));
  const e2 = await startApp({ searchProvider: 'google', googleVisionKey: 'bad', visionEndpoint: broken.url });
  try {
    const c = e2.client();
    await c.signup('broken');
    const id = (await c.upload('/dashboard/upload', { title: 'X', web_search: '1' }, await artwork())).headers.get('location').match(/\/a\/([\w-]+)/)[1];
    assert.equal((await c.post(`/dashboard/artworks/${id}/search`)).headers.get('location').split('msg=')[1], 'search-failed');
    assert.match((await c.text(`/dashboard/artworks/${id}`)).html, /API key not valid/);
  } finally {
    await e2.stop();
    broken.stop();
  }
});

test('TinEye provider sends the image as multipart with x-api-key', async () => {
  const tineye = await fakeApi(() => ({ body: { code: 200, results: { matches: [{ image_url: `${shop.url}/img/0.jpg`, backlinks: [{ url: `${shop.url}/img/0.jpg`, backlink: `${shop.url}/product` }] }] } } }));
  const e3 = await startApp({ searchProvider: 'tineye', tineyeKey: 'tin-key', tineyeEndpoint: tineye.url });
  try {
    const c = e3.client();
    await c.signup('tin');
    const id = (await c.upload('/dashboard/upload', { title: 'T', web_search: '1' }, await artwork())).headers.get('location').match(/\/a\/([\w-]+)/)[1];
    const r = await e3.ctx.websearch.searchArtwork(id);
    assert.equal(r.verified, 1);
    assert.equal(tineye.calls[0].headers['x-api-key'], 'tin-key');
    assert.match(tineye.calls[0].url, /^\/rest\/search\//);
    assert.match(tineye.calls[0].body.toString('latin1'), /name="image_upload"/);
  } finally {
    await e3.stop();
    tineye.stop();
  }
});

test('without a configured provider the feature is hidden and inert', async () => {
  const e4 = await startApp();
  try {
    const c = e4.client();
    await c.signup('nosearch');
    assert.ok(!(await c.text('/dashboard/upload')).html.includes('Search the whole web'));
    assert.equal(await e4.ctx.websearch.searchDue(), 0);
  } finally {
    await e4.stop();
  }
});
