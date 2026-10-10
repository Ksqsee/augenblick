// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) nur mit WebCrypto.

const enc = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

function publicJwk(raw: Uint8Array): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)), ext: true };
}

export interface EncryptOptions {
  /** Nur für Tests: feste Sender-Schlüssel und Salt. */
  senderPrivate?: string;
  senderPublic?: string;
  salt?: Uint8Array;
}

/** Nutzlast für ein Push-Abo verschlüsseln (Content-Encoding: aes128gcm). */
export async function encryptPayload(payload: Uint8Array, uaPublicB64: string, authB64: string, opts: EncryptOptions = {}): Promise<Uint8Array> {
  const uaPublic = unb64u(uaPublicB64);
  const auth = unb64u(authB64);
  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (opts.senderPrivate && opts.senderPublic) {
    asPublic = unb64u(opts.senderPublic);
    asPrivateKey = await crypto.subtle.importKey('jwk', { ...publicJwk(asPublic), d: opts.senderPrivate }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivateKey = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey('jwk', publicJwk(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivateKey, 256));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** VAPID-JWT (ES256) für den Push-Dienst erzeugen. */
export async function vapidAuth(endpoint: string, publicKey: string, privateKeyD: string, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...publicJwk(unb64u(publicKey)), d: privateKeyD }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Sendet eine Nachricht; liefert false, wenn das Abo ungültig ist (404/410). */
export async function sendPush(cfg: PushConfig, sub: { endpoint: string; p256dh: string; auth: string }, data: unknown): Promise<boolean> {
  const body = await encryptPayload(enc.encode(JSON.stringify(data)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, cfg.publicKey, cfg.privateKey, cfg.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return !(res.status === 404 || res.status === 410);
}
