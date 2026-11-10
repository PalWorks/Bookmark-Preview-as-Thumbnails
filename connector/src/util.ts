// SPDX-License-Identifier: AGPL-3.0-only
//
// Small helpers shared by the connector: base64url, hashes, HMAC, HTML escaping,
// and a body reader with a byte cap. Web Crypto only, so they run unchanged in
// the Workers runtime and in Node 22 (tests).

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
    try {
        const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

export const textToB64url = (s: string) => b64url(enc.encode(s));
export function b64urlToText(s: string): string | null {
    const bytes = b64urlDecode(s);
    if (!bytes) return null;
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
        return null;
    }
}

/** n random bytes, base64url. */
export const randomId = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function sha256(text: string): Promise<string> {
    return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

/** Constant-time comparison for equal-length strings (lengths are not secret here). */
export function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
    let k = keyCache.get(secret);
    if (!k) {
        k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        keyCache.set(secret, k);
    }
    return k;
}

/**
 * HMAC-SHA256 under `secret`, with a label so one secret can sign several kinds
 * of record (client ids, page state, network names) that can never stand in for
 * each other.
 */
export async function hmac(secret: string, label: string, data: string): Promise<string> {
    const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${label}\n${data}`));
    return b64url(new Uint8Array(mac));
}

/** `<base64url JSON>.<mac>`: readable by anyone, changeable by no one without the secret. */
export async function signRecord(secret: string, label: string, record: unknown): Promise<string> {
    const payload = textToB64url(JSON.stringify(record));
    return `${payload}.${await hmac(secret, label, payload)}`;
}

export async function verifyRecord<T>(secret: string, label: string, signed: unknown): Promise<T | null> {
    if (typeof signed !== 'string' || signed.length > 8192) return null;
    const dot = signed.indexOf('.');
    if (dot < 1 || dot !== signed.lastIndexOf('.')) return null;
    const payload = signed.slice(0, dot);
    const mac = signed.slice(dot + 1);
    if (!safeEqual(mac, await hmac(secret, label, payload))) return null;
    const text = b64urlToText(payload);
    if (text === null) return null;
    try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' ? (v as T) : null;
    } catch {
        return null;
    }
}

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Read a request body as text, or null when it is larger than `max` bytes. */
export async function readBody(request: Request, max: number): Promise<string | null> {
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > max) return null;
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
    }
    return new TextDecoder().decode(all);
}
