import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/server.js';

const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0' };
let server, base, dir, artwork;

// Syntetiskt "konstverk" med tydlig struktur
const makeArt = () =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2000">
    <rect width="1600" height="2000" fill="#f3d9b1"/><circle cx="800" cy="700" r="450" fill="#c0392b"/>
    <rect x="200" y="1300" width="1200" height="400" fill="#2c3e50"/></svg>`)).png().toBuffer();
const otherArt = () =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <rect width="800" height="800" fill="#123"/><path d="M0 800 L400 0 L800 800z" fill="#9c6"/></svg>`)).png().toBuffer();

async function post(path, fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('image', new Blob([file], { type: 'image/png' }), 'art.png');
  return fetch(base + path, { method: 'POST', body: fd, headers: UA, redirect: 'manual' });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'konstskydd-'));
  const app = await createApp({ dataDir: dir });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

test('uppladdning ger registreringsbevis och ägarnyckel', async () => {
  const res = await post('/upload', { artist: 'Anna <Konstnär>', title: 'Solnedgång' }, await makeArt());
  assert.equal(res.status, 303);
  const loc = res.headers.get('location');
  assert.match(loc, /^\/a\/[\w-]+\?key=.+&new=1$/);
  const html = await (await fetch(base + loc, { headers: UA })).text();
  assert.match(html, /Registreringsbevis/);
  assert.match(html, /Anna &lt;Konstnär&gt;/); // escapad
  artwork = { path: loc.split('?')[0], src: html.match(/src="(\/img\/[^"]+)"/)[1].replace(/&amp;/g, '&') };
});

test('publik bild är nedskalad, vattenstämplad JPEG med upphovsrätt i EXIF', async () => {
  const res = await fetch(base + artwork.src, { headers: UA });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.ok(Math.max(meta.width, meta.height) <= 1000);
  assert.match(meta.exif.toString('latin1'), /AI training prohibited/);
});

test('bild-URL utan giltig signatur nekas', async () => {
  const id = artwork.path.split('/').pop();
  assert.equal((await fetch(`${base}/img/${id}`, { headers: UA })).status, 403);
  assert.equal((await fetch(`${base}/img/${id}?exp=9999999999&sig=fake`, { headers: UA })).status, 403);
});

test('AI-crawlers och skriptklienter blockeras', async () => {
  assert.equal((await fetch(base + '/', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)' } })).status, 403);
  assert.equal((await fetch(base + artwork.src, { headers: { 'user-agent': 'python-requests/2.32' } })).status, 403);
  const res = await fetch(base + '/', { headers: UA });
  assert.equal(res.headers.get('tdm-reservation'), '1');
  assert.match(res.headers.get('x-robots-tag'), /noai/);
  assert.match(await (await fetch(base + '/robots.txt')).text(), /User-agent: CCBot\nDisallow: \//);
});

test('omkodad och omskalad kopia (som i en webbutik) känns igen', async () => {
  const stolen = await sharp(await makeArt()).resize(640).modulate({ brightness: 1.08, saturation: 1.15 }).jpeg({ quality: 55 }).toBuffer();
  const html = await (await post('/check', {}, stolen)).text();
  assert.match(html, /möjlig\(a\) träff/);
  assert.match(html, /Solnedgång/);
});

test('ett annat verk ger ingen träff', async () => {
  const html = await (await post('/check', {}, await otherArt())).text();
  assert.match(html, /Ingen matchning/);
});

test('fel ägarnyckel kan inte ta bort verk', async () => {
  const fd = new URLSearchParams({ key: 'fel' });
  const res = await fetch(base + artwork.path + '/delete', { method: 'POST', body: fd, headers: UA });
  assert.equal(res.status, 403);
});
