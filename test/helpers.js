import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import { createApp } from '../src/app.js';

export const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** A synthetic "artwork" with clear structure. */
export const artwork = (seed = 0, w = 1600, h = 2000) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="#f6c28b"/><stop offset="1" stop-color="#7b3f61"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${w / 2 + seed * 160}" cy="${h * 0.4 - seed * 120}" r="${w * 0.24}" fill="#fbe9c5"/>
      <path d="M0 ${h * 0.75} Q${w * 0.25} ${h * 0.62} ${w / 2} ${h * 0.72} T${w} ${h * 0.7} V${h} H0z" fill="#2d2a4a"/>
      <rect x="${w * 0.1}" y="${h * 0.08}" width="${w * 0.15}" height="${h * 0.05}" fill="#c0392b"/>
    </svg>`),
  )
    .png()
    .toBuffer();

export const otherArtwork = () =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
      <rect width="900" height="900" fill="#123"/><path d="M0 900 L450 0 L900 900z" fill="#9c6"/>
      <rect x="600" y="80" width="200" height="200" fill="#f39"/></svg>`),
  )
    .png()
    .toBuffer();

/** The artwork as a print-on-demand shop would show it: resized, recoloured, recompressed. */
export const shopCopy = async () =>
  sharp(await artwork()).resize(700).modulate({ brightness: 1.06, saturation: 1.2 }).jpeg({ quality: 60 }).toBuffer();

/** A "poster in a frame on a wall" mock-up. */
export const mockup = async () => {
  const poster = await sharp(await artwork()).resize(560, 700).jpeg({ quality: 70 }).toBuffer();
  const framed = await sharp({ create: { width: 600, height: 740, channels: 3, background: '#1b1b1b' } })
    .composite([{ input: poster, left: 20, top: 20 }])
    .png()
    .toBuffer();
  return sharp({ create: { width: 760, height: 900, channels: 3, background: '#e9e4dc' } })
    .composite([{ input: framed, left: 80, top: 70 }])
    .jpeg({ quality: 75 })
    .toBuffer();
};

/** Minimal browser-like client with a cookie jar and CSRF handling. */
export class Client {
  constructor(base, ua = BROWSER_UA) {
    this.base = base;
    this.ua = ua;
    this.cookies = {};
  }
  get csrf() {
    return this.cookies.csrf;
  }
  _store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const v = decodeURIComponent(kv.slice(i + 1));
      if (/Max-Age=0/.test(c)) delete this.cookies[kv.slice(0, i)];
      else this.cookies[kv.slice(0, i)] = v;
    }
  }
  async req(path, opts = {}) {
    const headers = { 'user-agent': this.ua, cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '), ...opts.headers };
    const res = await fetch(this.base + path, { redirect: 'manual', ...opts, headers });
    this._store(res);
    return res;
  }
  async get(path) {
    return this.req(path);
  }
  async text(path) {
    const r = await this.get(path);
    return { status: r.status, html: await r.text(), res: r };
  }
  async post(path, fields = {}, { csrf = true } = {}) {
    if (!this.csrf) await this.get('/');
    const body = new URLSearchParams({ ...(csrf ? { _csrf: this.csrf } : {}), ...fields });
    return this.req(path, { method: 'POST', body });
  }
  async upload(path, fields = {}, file, fieldName = 'image', type = 'image/png') {
    if (!this.csrf) await this.get('/');
    const fd = new FormData();
    fd.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append(fieldName, new Blob([file], { type }), 'file.png');
    return this.req(path, { method: 'POST', body: fd });
  }
  async signup(handle, extra = {}) {
    const r = await this.post('/signup', { display_name: extra.name || `Artist ${handle}`, handle, email: `${handle}@example.com`, password: 'correct horse battery', terms: '1' });
    if (r.status !== 303) throw new Error(`signup failed: ${r.status} ${await r.text()}`);
    return r;
  }
}

/** Starts a throw-away instance of the app (and a fake OTS calendar). */
export async function startApp(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'artguard-test-'));
  const calendar = http.createServer((req, res) => {
    let n = 0;
    req.on('data', (c) => (n += c.length));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/digest' || n !== 32) return res.writeHead(400).end();
      // pending attestation: append op + 4 bytes, then attestation tag (fake but well-formed bytes)
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from('f00401020304000083dfe30d2ef90c8e', 'hex'));
    });
  });
  await new Promise((r) => calendar.listen(0, '127.0.0.1', r));
  const app = await createApp({
    dataDir: dir,
    scheduler: false,
    quiet: true,
    allowPrivateFetch: true,
    rateLimitMultiplier: 100,
    baseUrl: 'http://localhost:3999',
    otsCalendars: [`http://127.0.0.1:${calendar.address().port}`],
    ...overrides,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    base,
    dir,
    ctx: app.locals.ctx,
    client: (ua) => new Client(base, ua),
    async stop() {
      await new Promise((r) => server.close(r));
      calendar.close();
      app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A tiny fake web shop that serves the given images on a product page. */
export async function startShop(images) {
  const server = http.createServer((req, res) => {
    const m = req.url.match(/^\/img\/(\d+)\.jpg$/);
    if (m && images[m[1]]) return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(images[m[1]]);
    if (req.url === '/redirect') return res.writeHead(302, { location: '/product' }).end();
    if (req.url === '/blocked') return res.writeHead(403, { 'content-type': 'text/html' }).end('<html><script src="https://ct.captcha-delivery.com/c.js"></script></html>');
    if (req.url === '/spa') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body><div id="app"></div><script src="/app.js"></script></body></html>');
    if (req.url === '/shopify/products/sunset')
      return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><link href="//cdn.shopify.com/s/files/theme.css"><div class="shopify-section">Only a placeholder image here</div></html>');
    if (req.url === '/shopify/products/sunset.json')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ product: { images: images.map((_, i) => ({ src: `/img/${i}.jpg` })) } }));
    if (req.url === '/product' || req.url === '/')
      return res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html><head>
        <meta property="og:image" content="/img/0.jpg">
        <script type="application/ld+json">{"@type":"Product","image":["/img/1.jpg"]}</script>
        </head><body><h1>Amazing poster - only $9.99</h1>
        ${images.map((_, i) => `<img src="/img/${i}.jpg" alt="">`).join('')}
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
        </body></html>`);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) };
}
