import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, validateUrl } from '../src/fetcher.js';
import { extractImageUrls, normaliseImage, detectBlock, shopifyJsonUrl, shopifyImages } from '../src/extract.js';
import { fingerprint, distance, hamming, MATCH_THRESHOLD, SUSPECT_CROPS } from '../src/imaging.js';
import { html, raw } from '../src/html.js';
import { canonical } from '../src/timestamp.js';
import { buildNotice, platformFor } from '../src/takedown.js';
import { safeNext } from '../src/security.js';
import { artwork, otherArtwork, shopCopy, mockup } from './helpers.js';

test('html template escapes interpolations but not nested templates', () => {
  const evil = '<script>alert(1)</script>"';
  assert.equal(String(html`<p title="${evil}">${evil}</p>`), '<p title="&lt;script&gt;alert(1)&lt;/script&gt;&quot;">&lt;script&gt;alert(1)&lt;/script&gt;&quot;</p>');
  assert.equal(String(html`<div>${html`<b>${'x'}</b>`}${[1, 2]}${null}${raw('<i>')}</div>`), '<div><b>x</b>12<i></div>');
});

test('private and special addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1'])
    assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});

test('URL validation blocks SSRF vectors', () => {
  for (const u of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://[::1]/', 'http://localhost/', 'http://169.254.169.254/latest', 'http://user:pw@example.com', 'http://example.com:22/', 'gopher://x'])
    assert.throws(() => validateUrl(u), u);
  assert.equal(validateUrl('https://www.etsy.com/listing/1#frag').href, 'https://www.etsy.com/listing/1');
});

test('extracts product images from typical shop markup, best first, without junk', () => {
  const page = `<meta property="og:image" content="https://cdn.shop.com/a.jpg?v=1&amp;w=2">
    <script type="application/ld+json">{"image":["https:\\/\\/cdn.shop.com\\/b.jpg","//cdn.shop.com/c.jpg"]}</script>
    <img data-src="/lazy.jpg" src="data:image/gif;base64,x"><img srcset="/s1.jpg 1x, /s2.jpg 2x" src="/s1.jpg"><img src="/logo.svg">
    <img src="/assets/site-logo.png"><img src="/tiny.jpg" width="16" height="16">
    <script>window.__STATE__={"items":[{"img":"https:\/\/img.cdn.com\/product\/p1.webp"}]}</script>`;
  const urls = extractImageUrls(page, 'https://shop.com/p/1');
  assert.deepEqual(urls, [
    'https://cdn.shop.com/a.jpg?v=1&w=2', 'https://cdn.shop.com/b.jpg', 'https://cdn.shop.com/c.jpg',
    'https://shop.com/lazy.jpg', 'https://shop.com/s1.jpg', 'https://shop.com/s2.jpg', 'https://img.cdn.com/product/p1.webp',
  ]);
});

test('CDN thumbnails are upgraded and de-duplicated', () => {
  const amazon = `<img class="s-image" src="https://m.media-amazon.com/images/I/718qzLjgVBL._AC_UL320_.jpg"
    srcset="https://m.media-amazon.com/images/I/718qzLjgVBL._AC_UL480_QL65_.jpg 1.5x">
    <img src="https://m.media-amazon.com/images/G/01/gno/sprites/nav-sprite.png">`;
  assert.deepEqual(extractImageUrls(amazon, 'https://www.amazon.com/s?k=x'), ['https://m.media-amazon.com/images/I/718qzLjgVBL._AC_SL800_.jpg']);
  assert.equal(normaliseImage('https://cdn.shopify.com/s/files/1/0/products/poster_200x200.jpg?v=1').url, 'https://cdn.shopify.com/s/files/1/0/products/poster.jpg?width=800');
  assert.equal(normaliseImage('https://i.etsystatic.com/123/r/il/abc/456_xyz/il_340x270.456789_abcd.jpg').url, 'https://i.etsystatic.com/123/r/il/abc/456_xyz/il_794xN.456789_abcd.jpg');
});

test('bot challenges are detected and reported as blocked', () => {
  const page = (status, html, url = 'https://www.etsy.com/search') => ({ url, status, contentType: 'text/html', body: Buffer.from(html) });
  assert.match(detectBlock(page(403, '<html>captcha-delivery.com</html>')).message, /etsy\.com blocks automated access \(HTTP 403\)/);
  assert.ok(detectBlock(page(200, '<title>Just a moment...</title>', 'https://www.redbubble.com/')).blocked);
  assert.ok(detectBlock(page(200, '<title>Robot Check</title>', 'https://www.amazon.com/')));
  assert.equal(detectBlock(page(200, '<title>Sunset poster</title>')), null);
});

test('Shopify JSON endpoints', () => {
  assert.equal(shopifyJsonUrl('https://store.com/products/sunset-poster?variant=1'), 'https://store.com/products/sunset-poster.json');
  assert.equal(shopifyJsonUrl('https://store.com/collections/posters/products/sunset'), 'https://store.com/collections/posters/products/sunset.json');
  assert.equal(shopifyJsonUrl('https://store.com/collections/posters?page=2'), 'https://store.com/collections/posters/products.json?limit=250');
  assert.equal(shopifyJsonUrl('https://store.com/'), 'https://store.com/products.json?limit=250');
  assert.deepEqual(shopifyImages({ products: [{ images: [{ src: 'a' }, { src: 'b' }] }, { images: [] }] }), ['a', 'b']);
});

test('perceptual matching: copies match, different art does not', async () => {
  const orig = await fingerprint(await artwork());
  const cases = {
    'shop copy (resized, recoloured, jpeg)': await shopCopy(),
    'framed mock-up on a wall': await mockup(),
  };
  for (const [name, buf] of Object.entries(cases)) {
    const d = distance(await fingerprint(buf, SUSPECT_CROPS), orig);
    assert.ok(d <= MATCH_THRESHOLD, `${name}: distance ${d}`);
  }
  for (const [name, buf] of Object.entries({ 'unrelated artwork': await otherArtwork(), 'same palette, different composition': await artwork(2) })) {
    const d = distance(await fingerprint(buf, SUSPECT_CROPS), orig);
    assert.ok(d > MATCH_THRESHOLD, `${name}: distance ${d}`);
  }
  assert.equal(hamming('ffffffffffffffff', '0000000000000000'), 64);
});

test('canonical JSON is key-order independent', () => {
  assert.equal(canonical({ b: 1, a: [{ d: 2, c: 'x' }] }), canonical({ a: [{ c: 'x', d: 2 }], b: 1 }));
});

test('takedown notices contain the legally required elements', () => {
  const ctx = {
    user: { display_name: 'Anna', legal_name: 'Anna Lind', postal_address: 'Storgatan 1, Stockholm', email: 'anna@example.com' },
    artwork: { id: 'abc', title: 'Sunset', year: '2025', created_at: '2026-01-01T00:00:00Z', sha256: 'f'.repeat(64) },
    match: { page_url: 'https://www.etsy.com/listing/1', image_url: 'https://i.etsystatic.com/x.jpg' },
    baseUrl: 'https://artguard.example',
  };
  const dmca = buildNotice('dmca', ctx);
  for (const s of ['good faith belief', 'penalty of perjury', 'Anna Lind', 'Storgatan 1', 'https://www.etsy.com/listing/1', 'https://artguard.example/a/abc', 'f'.repeat(64)])
    assert.ok(dmca.includes(s), s);
  const dsa = buildNotice('dsa', ctx);
  for (const s of ['Article 16', 'bona fide belief', 'accurate and complete', 'https://i.etsystatic.com/x.jpg']) assert.ok(dsa.includes(s), s);
  assert.equal(platformFor('https://www.etsy.com/listing/1').name, 'Etsy');
  assert.equal(platformFor('https://www.amazon.de/dp/1').name, 'Amazon');
  assert.equal(platformFor('https://evil-etsy.com.example/').name, 'Other marketplaces');
});

test('login redirect target must be local', () => {
  assert.equal(safeNext('/dashboard/matches'), '/dashboard/matches');
  for (const n of ['//evil.com', 'https://evil.com', '/\\evil.com', undefined]) assert.equal(safeNext(n), '/dashboard');
});
