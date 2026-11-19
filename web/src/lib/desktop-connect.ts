/**
 * Connecting the Desktop App to an account without pasting a key. The app opens
 * /desktop/connect?port=&state=&pub= in the browser. After the player confirms, the page makes an API key and
 * seals it to the app's one-time public key: ECDH P-256, then HKDF-SHA-256, then AES-256-GCM, with the state
 * as associated data. The browser then goes to http://127.0.0.1:<port>/callback with the sealed key, so the
 * key never appears in the clear in a URL or in browser history, and only the app that asked can open it.
 * Pure WebCrypto, so the page and the app (Node) run the same code.
 */

/** The label of the key the connect page makes; /settings reads it to tell whether the app has a key. */
export const DESKTOP_KEY_LABEL = "Everloot Desktop App";

const INFO = new TextEncoder().encode("everloot desktop connect v1");
const PUB = /^[A-Za-z0-9_-]{87}$/;      // a raw P-256 point (65 bytes), base64url
const STATE = /^[A-Za-z0-9_-]{32}$/;    // 24 random bytes, base64url
const B64 = /^[A-Za-z0-9_-]+$/;

export interface ConnectRequest { port: number; state: string; pub: string }
export interface Sealed { epk: string; iv: string; ct: string }

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const b of view) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The app's request from the page's query, or null when any part is missing or malformed. */
export function parseConnectRequest(query: { port?: unknown; state?: unknown; pub?: unknown }): ConnectRequest | null {
  const port = typeof query.port === "string" && /^\d{4,5}$/.test(query.port) ? Number(query.port) : NaN;
  if (!(port >= 1024 && port <= 65535)) return null;
  if (typeof query.state !== "string" || !STATE.test(query.state)) return null;
  if (typeof query.pub !== "string" || !PUB.test(query.pub)) return null;
  return { port, state: query.state, pub: query.pub };
}

/** The page's own path for a request, used to come back after signing in. */
export function connectPath(r: ConnectRequest): string {
  return `/desktop/connect?port=${r.port}&state=${r.state}&pub=${r.pub}`;
}

/** Where the browser hands the result to the app: always this computer, never another host. */
export function callbackUrl(r: ConnectRequest, result: Sealed | { error: "denied" }): string {
  const q = new URLSearchParams({ state: r.state, ...result });
  return `http://127.0.0.1:${r.port}/callback?${q}`;
}

async function aesKey(priv: CryptoKey, pub: CryptoKey, usage: KeyUsage): Promise<CryptoKey> {
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hkdf = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO }, hkdf,
    { name: "AES-GCM", length: 256 }, false, [usage]);
}

const importPub = (b64: string) => crypto.subtle.importKey("raw", fromB64(b64), { name: "ECDH", namedCurve: "P-256" }, false, []);

/** The page: seals the key to the app's public key, bound to the request's state. */
export async function sealForDesktop(token: string, r: ConnectRequest): Promise<Sealed> {
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const key = await aesKey(eph.privateKey, await importPub(r.pub), "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(r.state) }, key,
    new TextEncoder().encode(token));
  return { epk: toB64(await crypto.subtle.exportKey("raw", eph.publicKey)), iv: toB64(iv), ct: toB64(ct) };
}

/** The app: a one-time key pair, its public half as the page's `pub`, and a fresh state. */
export async function desktopKeyPair(): Promise<{ privateKey: CryptoKey; pub: string; state: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const state = toB64(crypto.getRandomValues(new Uint8Array(24)));
  return { privateKey: pair.privateKey, pub: toB64(await crypto.subtle.exportKey("raw", pair.publicKey)), state };
}

/** The app: opens what the page sealed. Throws on anything that was not sealed for this key and state. */
export async function openSealed(sealed: { epk?: unknown; iv?: unknown; ct?: unknown }, privateKey: CryptoKey, state: string): Promise<string> {
  const { epk, iv, ct } = sealed;
  if (typeof epk !== "string" || !PUB.test(epk) || typeof iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(iv)
    || typeof ct !== "string" || !B64.test(ct) || ct.length > 400) throw new Error("The browser sent an unreadable answer.");
  const key = await aesKey(privateKey, await importPub(epk), "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: new TextEncoder().encode(state) }, key, fromB64(ct));
  return new TextDecoder().decode(plain);
}
