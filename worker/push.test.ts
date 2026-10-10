import { describe, expect, it } from 'vitest';
import { b64u, encryptPayload, unb64u, vapidAuth } from './push';

// RFC 8291, Anhang A
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('web push', () => {
  it('matches the RFC 8291 test vector', async () => {
    const out = await encryptPayload(new TextEncoder().encode(V.plaintext), V.uaPublic, V.auth, {
      senderPrivate: V.asPrivate,
      senderPublic: V.asPublic,
      salt: unb64u(V.salt),
    });
    expect(b64u(out)).toBe(V.body);
  });

  it('builds a verifiable VAPID header', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = b64u((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const d = ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d!;
    const h = await vapidAuth('https://push.example.net/abc', pub, d, 'mailto:test@example.com');
    const [, jwt] = h.match(/t=([^,]+)/)!;
    const [hd, cl, sig] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(unb64u(cl))).aud).toBe('https://push.example.net');
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, unb64u(sig), new TextEncoder().encode(`${hd}.${cl}`));
    expect(ok).toBe(true);
  });
});
