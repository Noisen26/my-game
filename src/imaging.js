// Bildbehandling: förhandsvisning med vattenstämpel, upphovsrättsmetadata
// och perceptuell hash (för att känna igen stulna kopior).
import sharp from 'sharp';
import { createHash } from 'node:crypto';

export const PREVIEW_MAX_PX = 1000; // offentlig version är aldrig större än så

const xml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * Bygger en SVG som täcker hela bilden med en diagonal, upprepad text plus
 * en tydlig banderoll i underkant. Upprepningen gör det svårt att beskära
 * eller retuschera bort stämpeln utan att förstöra motivet.
 */
function watermarkSvg(width, height, text) {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 22));
  const tileW = Math.round(fontSize * text.length * 0.62);
  const tileH = Math.round(fontSize * 4);
  const banner = Math.round(fontSize * 1.8);
  const t = xml(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${fontSize}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="bold"
            fill="#ffffff" fill-opacity="0.28" stroke="#000000" stroke-opacity="0.22" stroke-width="1">${t}</text>
      <text x="${Math.round(tileW / 2)}" y="${Math.round(fontSize * 3)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="bold"
            fill="#ffffff" fill-opacity="0.28" stroke="#000000" stroke-opacity="0.22" stroke-width="1">${t}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm)"/>
  <rect x="0" y="${height - banner}" width="${width}" height="${banner}" fill="#000000" fill-opacity="0.55"/>
  <text x="${width / 2}" y="${height - Math.round(banner * 0.32)}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
        font-size="${Math.round(fontSize * 0.8)}" fill="#ffffff">${t}</text>
</svg>`;
}

/** Läser in och validerar att bufferten verkligen är en bild. */
export async function inspect(buf) {
  const meta = await sharp(buf, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new Error('Filen är inte en giltig bild');
  return { width: meta.width, height: meta.height, format: meta.format };
}

/**
 * Skapar den enda version av verket som någonsin visas publikt:
 * nedskalad, vattenstämplad, JPEG-komprimerad och märkt med
 * upphovsrätt + "ingen AI-träning" i EXIF.
 */
export async function makePreview(buf, { artist, title, url }) {
  const { data, info } = await sharp(buf, { failOn: 'error' })
    .rotate()
    .resize(PREVIEW_MAX_PX, PREVIEW_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const svg = watermarkSvg(info.width, info.height, `© ${artist} · ${url}`);
  return sharp(data)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .withExif({
      IFD0: {
        Artist: artist,
        Copyright: `© ${artist}. All rights reserved. Text and data mining / AI training prohibited (EU DSM Art. 4(3)).`,
        ImageDescription: `${title} - ${url}`,
      },
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * dHash (difference hash), 64 bitar. Påverkas lite av skalning,
 * komprimering, färgjustering och vattenstämplar, så en omkodad kopia
 * på en e-handelssajt får nästan samma hash som originalet.
 */
export async function dHash(buf) {
  const { data } = await sharp(buf)
    .rotate()
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
