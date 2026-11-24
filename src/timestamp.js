// Proof of authorship:
//  1. Every registration is signed with the site's Ed25519 key. Anyone can
//     verify the certificate against the published public key.
//  2. The SHA-256 of the original is submitted to public OpenTimestamps
//     calendars, which anchor it in the Bitcoin blockchain. That proof does
//     not depend on trusting this site or its database at all.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';

/** Loads a persisted secret/key from dataDir/keys, creating it on first run. */
function persisted(dataDir, name, create) {
  const dir = join(dataDir, 'keys');
  const file = join(dir, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const value = create();
  writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export function loadSecrets(cfg) {
  const appSecret = cfg.secret || persisted(cfg.dataDir, 'app-secret', () => randomBytes(32).toString('hex'));
  const pem =
    process.env.SIGNING_KEY_PEM ||
    persisted(cfg.dataDir, 'signing-key.pem', () =>
      generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyId = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  return { appSecret, privateKey, publicKey, publicPem, keyId };
}

/** Deterministic JSON (sorted keys) so signatures are reproducible. */
export function canonical(obj) {
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  if (obj && typeof obj === 'object')
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  return JSON.stringify(obj);
}

export function signCertificate(secrets, cert) {
  const body = canonical({ ...cert, keyId: secrets.keyId });
  return { body, signature: sign(null, Buffer.from(body), secrets.privateKey).toString('base64') };
}

export function verifyCertificate(secrets, body, signature) {
  try {
    return verify(null, Buffer.from(body), secrets.publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ OpenTimestamps

const OTS_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
const OP_SHA256 = 0x08;
const FORK = 0xff;

/**
 * Submits a SHA-256 digest to the calendars and returns a complete .ots
 * file (pending attestations). It can later be upgraded and verified with
 * the standard client: `ots upgrade file.ots && ots verify file.ots`.
 */
export async function stampDigest(hexDigest, calendars, { timeoutMs = 15000 } = {}) {
  const digest = Buffer.from(hexDigest, 'hex');
  if (digest.length !== 32) throw new Error('Expected a SHA-256 digest');
  const results = await Promise.allSettled(
    calendars.map(async (base) => {
      const res = await fetch(`${base.replace(/\/$/, '')}/digest`, {
        method: 'POST',
        body: digest,
        headers: { Accept: 'application/vnd.opentimestamps.v1', 'User-Agent': 'konstskydd-ots/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`${base}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 10_000) throw new Error(`${base}: unexpected response`);
      return buf;
    }),
  );
  const branches = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!branches.length) throw new Error(results.map((r) => r.reason?.message).join('; '));
  const parts = [OTS_MAGIC, Buffer.from([0x01, OP_SHA256]), digest];
  branches.forEach((b, i) => {
    if (i < branches.length - 1) parts.push(Buffer.from([FORK]));
    parts.push(b);
  });
  return Buffer.concat(parts);
}
