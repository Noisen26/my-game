import express from 'express';
import multer from 'multer';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inspect, makePreview, sha256, dHash, hamming } from './imaging.js';
import { optOutHeaders, blockAiBots, blockScriptsOnImages, rateLimit, robotsTxt, createSigner } from './antiscrape.js';
import { createStore } from './store.js';
import { layout, galleryPage, uploadPage, artworkPage, checkPage, esc } from './views.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const SITE_URL = process.env.SITE_URL || `localhost:${PORT}`;
const MATCH_THRESHOLD = 12; // max antal skilda bitar (av 64) för att räknas som samma verk

export async function createApp({ dataDir = join(root, 'data') } = {}) {
  const store = createStore(dataDir);
  await store.init();
  const signer = createSigner();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 40 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|tiff)$/.test(file.mimetype)),
  });
  const hashKey = (k) => createHash('sha256').update(k).digest('hex');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(optOutHeaders);
  app.use(express.urlencoded({ extended: false }));

  // Maskinläsbara förbehåll
  app.get('/robots.txt', (_q, r) => r.type('text').send(robotsTxt()));
  app.get('/ai.txt', (_q, r) => r.type('text').send('User-Agent: *\nDisallow: *\n'));
  app.get('/.well-known/tdmrep.json', (_q, r) => r.json([{ location: '/*', 'tdm-reservation': 1 }]));

  app.use(blockAiBots);
  app.use('/static', express.static(join(root, 'public'), { maxAge: '1h' }));

  app.get('/', (_req, res) =>
    res.send(layout('Galleri', galleryPage(store.list().map((a) => ({ ...a, src: signer.sign(a.id) }))))),
  );

  app.get('/upload', (_req, res) => res.send(layout('Ladda upp', uploadPage())));

  app.post('/upload', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), upload.single('image'), async (req, res) => {
    const artist = (req.body.artist || '').trim().slice(0, 80);
    const title = (req.body.title || '').trim().slice(0, 120);
    if (!req.file || !artist || !title)
      return res.status(400).send(layout('Fel', uploadPage('Fyll i namn, titel och välj en bild (JPEG, PNG, WebP eller TIFF).')));
    let meta;
    try {
      meta = await inspect(req.file.buffer);
    } catch {
      return res.status(400).send(layout('Fel', uploadPage('Filen kunde inte läsas som en bild.')));
    }
    const id = randomBytes(6).toString('base64url');
    const ownerKey = randomBytes(18).toString('base64url');
    const preview = await makePreview(req.file.buffer, { artist, title, url: `${SITE_URL}/a/${id}` });
    const record = {
      id,
      artist,
      title,
      format: meta.format,
      width: meta.width,
      height: meta.height,
      sha256: sha256(req.file.buffer),
      dhash: await dHash(req.file.buffer),
      createdAt: new Date().toISOString(),
      ownerKeyHash: hashKey(ownerKey),
    };
    await store.add(record, req.file.buffer, preview);
    res.redirect(303, `/a/${id}?key=${encodeURIComponent(ownerKey)}&new=1`);
  });

  app.get('/a/:id', (req, res) => {
    const a = store.get(req.params.id);
    if (!a) return res.status(404).send(layout('Hittades inte', '<p>Verket finns inte.</p>'));
    const ownerKey = req.query.new === '1' && typeof req.query.key === 'string' ? req.query.key : null;
    res.set('Cache-Control', 'no-store');
    res.send(layout(a.title, artworkPage({ ...a, src: signer.sign(a.id) }, ownerKey, SITE_URL)));
  });

  app.post('/a/:id/delete', (req, res) => {
    const a = store.get(req.params.id);
    const given = Buffer.from(hashKey(String(req.body.key || '')));
    if (!a || !timingSafeEqual(given, Buffer.from(a.ownerKeyHash)))
      return res.status(403).send(layout('Fel', '<p>Fel ägarnyckel.</p>'));
    store.remove(a.id).then(() => res.redirect(303, '/'));
  });

  // Bilder: bara förhandsvisningen, bara via färsk signerad URL, bara i rimlig takt.
  app.get(
    '/img/:id',
    blockScriptsOnImages,
    rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }),
    (req, res) => {
      const { id } = req.params;
      if (!store.get(id) || !signer.verify(id, req.query.exp, req.query.sig)) return res.status(403).end();
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=600',
        'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'same-origin', // stoppar hotlänkning från andra sajter
        'X-Robots-Tag': 'noai, noimageai, noindex',
      });
      createReadStream(store.previewPath(id)).pipe(res);
    },
  );

  // Hitta kopior: ladda upp en misstänkt bild (t.ex. från en webbutik)
  app.get('/check', (_req, res) => res.send(layout('Kontrollera kopia', checkPage())));
  app.post('/check', rateLimit({ windowMs: 10 * 60 * 1000, max: 30 }), upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send(layout('Fel', checkPage(null, 'Välj en bild att kontrollera.')));
    let h;
    try {
      h = await dHash(req.file.buffer);
    } catch {
      return res.status(400).send(layout('Fel', checkPage(null, 'Filen kunde inte läsas som en bild.')));
    }
    const matches = store
      .list()
      .map((a) => ({ ...a, distance: hamming(h, a.dhash), src: signer.sign(a.id) }))
      .filter((a) => a.distance <= MATCH_THRESHOLD)
      .sort((a, b) => a.distance - b.distance);
    res.send(layout('Resultat', checkPage({ hash: h, matches })));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Filen är för stor (max 40 MB).' : 'Något gick fel.';
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).send(layout('Fel', `<p>${esc(msg)}</p>`));
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  app.listen(PORT, () => console.log(`Konstskydd kör på http://localhost:${PORT}`));
}
