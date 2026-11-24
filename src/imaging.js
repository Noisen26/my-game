// Image processing: watermarked public preview, copyright metadata and
// perceptual fingerprints used to recognise copies of an artwork.
import sharp from 'sharp';
import { createHash } from 'node:crypto';

sharp.cache(false);
const INPUT = { failOn: 'error', limitInputPixels: 200_000_000 };

const xml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * A full-coverage diagonal, repeating watermark plus a solid credit banner.
 * Repetition across the whole surface makes cropping or retouching it out
 * impractical without destroying the image.
 */
function watermarkSvg(width, height, text) {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 22));
  const tileW = Math.round(fontSize * text.length * 0.62);
  const tileH = Math.round(fontSize * 4);
  const banner = Math.round(fontSize * 1.8);
  const t = xml(text);
  const font = 'font-family="DejaVu Sans, Inter, Arial, sans-serif" font-weight="bold"';
  const style = 'fill="#ffffff" fill-opacity="0.28" stroke="#000000" stroke-opacity="0.22" stroke-width="1"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${fontSize}" ${font} font-size="${fontSize}" ${style}>${t}</text>
      <text x="${Math.round(tileW / 2)}" y="${fontSize * 3}" ${font} font-size="${fontSize}" ${style}>${t}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm)"/>
  <rect x="0" y="${height - banner}" width="${width}" height="${banner}" fill="#000000" fill-opacity="0.55"/>
  <text x="${width / 2}" y="${height - Math.round(banner * 0.32)}" text-anchor="middle" font-family="DejaVu Sans, Inter, Arial, sans-serif"
        font-size="${Math.round(fontSize * 0.8)}" fill="#ffffff">${t}</text>
</svg>`;
}

/** Validates that the buffer is a decodable image and returns its basics. */
export async function inspect(buf) {
  const meta = await sharp(buf, INPUT).metadata();
  if (!meta.width || !meta.height) throw new Error('Not a valid image');
  const swap = meta.orientation >= 5;
  return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height, format: meta.format };
}

/**
 * The only version of an artwork that is ever served publicly: downscaled,
 * watermarked, JPEG-compressed and tagged with copyright + AI-training
 * reservation in EXIF. Original metadata (GPS etc.) is stripped.
 */
export async function makePreview(buf, { artist, title, url, maxPx = 1000 }) {
  const { data, info } = await sharp(buf, INPUT)
    .rotate()
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const svg = watermarkSvg(info.width, info.height, `© ${artist} · ${url}`);
  return sharp(data)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .withExif({
      IFD0: {
        Artist: artist,
        Copyright: `© ${artist}. All rights reserved. Text and data mining and AI training are prohibited (EU 2019/790 Art. 4(3)).`,
        ImageDescription: `${title} - ${url}`,
      },
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

/** Small square thumbnail for dashboards (also watermarked source). */
export const makeThumb = (previewBuf) =>
  sharp(previewBuf).resize(360, 360, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- hashing

const N = 32;
const COS = Array.from({ length: 8 }, (_, u) =>
  Float64Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
);

const toHex = (bits) => {
  let v = 0n;
  for (const b of bits) v = (v << 1n) | (b ? 1n : 0n);
  return v.toString(16).padStart(16, '0');
};

/** DCT-based perceptual hash (64 bit) of a 32x32 greyscale raw buffer. */
function phashOfRaw(px) {
  const coeffs = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) {
        const cy = COS[v][y];
        for (let x = 0; x < N; x++) s += px[y * N + x] * COS[u][x] * cy;
      }
      coeffs.push(s);
    }
  }
  const sorted = [...coeffs].slice(1).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return toHex(coeffs.map((c) => c > median));
}

/** Normalised greyscale working copy (max 384 px) for fast cropping. */
async function grey(buf) {
  const { data, info } = await sharp(buf, INPUT)
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(384, 384, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function cropHash(g, frac, mirror = false) {
  const w = Math.max(8, Math.round(g.width * frac));
  const h = Math.max(8, Math.round(g.height * frac));
  const left = Math.floor((g.width - w) / 2);
  const top = Math.floor((g.height - h) / 2);
  const { data } = await sharp(g.data, { raw: { width: g.width, height: g.height, channels: g.channels } })
    .extract({ left, top, width: w, height: h })
    .flop(mirror)
    .resize(N, N, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return phashOfRaw(data);
}

async function dhashOf(g) {
  const { data } = await sharp(g.data, { raw: { width: g.width, height: g.height, channels: g.channels } })
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(data[y * 9 + x] > data[y * 9 + x + 1]);
  return toHex(bits);
}

export const ARTWORK_CROPS = [1, 0.85, 0.7];
// A suspect image may be a mock-up (poster in a frame, on a wall), so we
// also look at tighter centre crops of it.
export const SUSPECT_CROPS = [1, 0.85, 0.7, 0.55];

/**
 * Fingerprints for a registered artwork or a suspect image. Suspect images
 * are also hashed mirrored, a common trick to dodge duplicate detection.
 */
export async function fingerprint(buf, crops = ARTWORK_CROPS) {
  const g = await grey(buf);
  const phashes = [];
  for (const c of crops) phashes.push(await cropHash(g, c));
  if (crops === SUSPECT_CROPS) for (const c of [1, 0.85]) phashes.push(await cropHash(g, c, true));
  return { dhash: await dhashOf(g), phashes };
}

export function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n++;
    x &= x - 1n;
  }
  return n;
}

/** Thresholds are in differing bits out of 64. */
export const MATCH_THRESHOLD = 10;

/** Smallest distance between any suspect crop and any artwork crop. */
export function distance(suspect, artwork) {
  let best = hamming(suspect.dhash, artwork.dhash) + 2; // dHash is a little noisier: small penalty
  for (const s of suspect.phashes) for (const a of artwork.phashes) best = Math.min(best, hamming(s, a));
  return best;
}
