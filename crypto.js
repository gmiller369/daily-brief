/*
 * Shared encryption for The Daily Brief.
 * Works in the browser (window.BriefCrypto) and in Node 18+ (require('./crypto.js')).
 *
 * Envelope format written by agents:
 *   { "v": 1, "alg": "AES-GCM", "iv": "<base64 12 bytes>", "ct": "<base64 ciphertext+tag>" }
 * Key = PBKDF2-SHA256(passphrase, salt from data/crypto.json, iterations from data/crypto.json), 256-bit.
 */
(function (root) {
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }
  function fromB64(str) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(passphrase, saltB64, iterations) {
    const base = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function isEnvelope(obj) {
    return obj && typeof obj === 'object' && obj.v === 1 && obj.alg === 'AES-GCM' && obj.iv && obj.ct;
  }

  async function encryptJSON(key, data) {
    const iv = (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
    return { v: 1, alg: 'AES-GCM', iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
  }

  async function decryptJSON(key, envelope) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.ct));
    return JSON.parse(dec.decode(pt));
  }

  const api = { deriveKey, isEnvelope, encryptJSON, decryptJSON, toB64, fromB64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BriefCrypto = api;
})(typeof window !== 'undefined' ? window : globalThis);
