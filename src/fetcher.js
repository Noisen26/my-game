// Outbound HTTP for the marketplace monitor, hardened against SSRF:
// only http(s) on ports 80/443, every redirect re-validated, and DNS
// answers that point at private/loopback/link-local ranges are refused at
// connect time (which also defeats DNS rebinding).
import { Agent, ProxyAgent, fetch } from 'undici';
import dns from 'node:dns';
import net from 'node:net';

function v4ToInt(ip) {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [v4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, mask]) => (n & mask) === (base & mask));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff') || lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')
    );
  }
  return true;
}

function guardedLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
      return cb(Object.assign(new Error(`Refusing to connect to private address for ${hostname}`), { code: 'EBLOCKED' }));
    if (opts?.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

const publicAgent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 20_000 });
const openAgent = new Agent({ connect: { timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 20_000 });

// Optional egress proxy (OUTBOUND_PROXY), for hosts where servers may only
// reach the internet through a proxy. Node's fetch ignores HTTPS_PROXY.
const PROXY = process.env.OUTBOUND_PROXY || null;
const proxyAgent = PROXY ? new ProxyAgent({ uri: PROXY, headersTimeout: 15_000, bodyTimeout: 20_000 }) : null;

/** Dispatcher for outbound requests to public hosts. */
export const outboundDispatcher = () => proxyAgent || publicAgent;

/**
 * With a proxy the connection is made by the proxy, so the connect-time
 * check cannot run. Resolve the name ourselves first and refuse private
 * answers. If the name does not resolve locally, the proxy decides.
 */
async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private addresses are not allowed.');
    return;
  }
  let addrs = [];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    return;
  }
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error(`Refusing to connect to private address for ${host}`);
}

export function validateUrl(input, { allowPrivate = false } = {}) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are supported.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  if (!allowPrivate) {
    if (u.port && !['80', '443'].includes(u.port)) throw new Error('Only standard ports are allowed.');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private addresses are not allowed.');
    if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error('Private hosts are not allowed.');
  }
  u.hash = '';
  return u;
}

/**
 * The monitor always identifies itself honestly. Sites that block it are
 * reported as blocked; we never disguise it as a regular browser.
 */
export const userAgent = (baseUrl = '') => `ArtguardMonitor/1.0 (+${baseUrl}/bot; copyright monitoring for artists)`;

/**
 * Fetches a URL with redirect re-validation and a hard size cap.
 * Returns { url, status, contentType, body: Buffer }.
 */
export async function safeFetch(input, { maxBytes = 5 * 1024 * 1024, allowPrivate = false, accept = '*/*', timeoutMs = 25_000, ua = userAgent() } = {}) {
  let url = validateUrl(input, { allowPrivate });
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 6; hop++) {
    if (!allowPrivate && proxyAgent) await assertPublicHost(url.hostname);
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      dispatcher: allowPrivate ? openAgent : outboundDispatcher(),
      headers: { 'User-Agent': ua, Accept: accept, 'Accept-Language': 'en,*;q=0.5' },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      await res.body?.cancel();
      if (!loc) throw new Error('Redirect without location');
      url = validateUrl(new URL(loc, url), { allowPrivate });
      continue;
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new Error('Response too large');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body ?? []) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Response too large');
      chunks.push(chunk);
    }
    return { url: url.href, status: res.status, contentType: res.headers.get('content-type') || '', body: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}
