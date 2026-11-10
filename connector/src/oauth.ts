// SPDX-License-Identifier: AGPL-3.0-only
//
// OAuth 2.1 pieces of the connector (docs/designs/ai-assistant.md, "OAuth 2.1"):
// stateless dynamic client registration, redirect URI rules, PKCE S256, the
// signed record that carries the authorize parameters through the page's forms,
// and the metadata documents. Pure functions: no storage, no runtime bindings.

import { LINK_ID_RE, connectorMcpUrl } from '../../src/lib/bridge/connector.ts';
import { cleanClientName } from '../../src/lib/bridge/protocol.ts';
import { sha256, signRecord, verifyRecord } from './util.ts';

/** HMAC labels: a record signed for one purpose never verifies for another. */
const CLIENT_LABEL = 'client_id';
const PAGE_LABEL = 'authorize_page';

export const MAX_REDIRECT_URIS = 5;
export const MAX_REDIRECT_URI_CHARS = 1000;
/** How long one authorize page stays usable. */
export const PAGE_TTL_MS = 15 * 60 * 1000;
/** One-time authorization codes (design: 2 minutes). */
export const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
export const SCOPE = 'bookmarks';

export interface ClientRecord {
    redirect_uris: string[];
    client_name: string;
    iat: number;
}

/** https anywhere, or http only on this computer (native apps' loopback redirect). No fragments, no user info. */
export function redirectUriAllowed(raw: unknown): boolean {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_REDIRECT_URI_CHARS) return false;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.hash || raw.includes('#') || u.username || u.password) return false;
    if (u.protocol === 'https:') return !!u.hostname;
    if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    return false;
}

export type RegisterResult =
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

/**
 * RFC 7591 registration with nothing stored: the client id is the signed record
 * itself. Public clients only, so any requested auth method is answered with "none".
 */
export async function registerClient(secret: string, meta: unknown, now: number): Promise<RegisterResult> {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return { ok: false, error: 'invalid_client_metadata', description: 'Send the client metadata as a JSON object.' };
    }
    const m = meta as Record<string, unknown>;
    const uris = m.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
        return { ok: false, error: 'invalid_redirect_uri', description: `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} addresses.` };
    }
    for (const u of uris) {
        if (!redirectUriAllowed(u)) {
            return { ok: false, error: 'invalid_redirect_uri', description: 'Each redirect URI must be https, or http on localhost or 127.0.0.1, with no fragment.' };
        }
    }
    const grants = m.grant_types;
    if (grants !== undefined && (!Array.isArray(grants) || !grants.includes('authorization_code'))) {
        return { ok: false, error: 'invalid_client_metadata', description: 'grant_types must include authorization_code.' };
    }
    const record: ClientRecord = {
        redirect_uris: uris as string[],
        client_name: cleanClientName(m.client_name === undefined ? 'AI app' : m.client_name),
        iat: Math.floor(now / 1000),
    };
    const clientId = await signRecord(secret, CLIENT_LABEL, record);
    return {
        ok: true,
        body: {
            client_id: clientId,
            client_id_issued_at: record.iat,
            client_name: record.client_name,
            redirect_uris: record.redirect_uris,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        },
    };
}

export async function verifyClientId(secret: string, clientId: unknown): Promise<ClientRecord | null> {
    const r = await verifyRecord<ClientRecord>(secret, CLIENT_LABEL, clientId);
    if (!r || !Array.isArray(r.redirect_uris) || typeof r.client_name !== 'string') return null;
    return r;
}

const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export async function verifyPkce(verifier: unknown, challenge: string): Promise<boolean> {
    if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return false;
    return (await sha256(verifier)) === challenge;
}

/** Everything the authorize page must remember between its forms. Signed, so it cannot be edited. */
export interface PageState {
    linkId: string;
    clientId: string;
    clientName: string;
    redirectUri: string;
    state?: string;
    codeChallenge: string;
    scope?: string;
    /** The issuer the client discovered (path form or root), returned as `iss`. */
    issuer: string;
    /** Kept for this pairing, so "show a new code" and the code reach the same prompt. */
    pairingId: string;
    exp: number;
}

export const signPageState = (secret: string, p: PageState) => signRecord(secret, PAGE_LABEL, p);

export async function verifyPageState(secret: string, signed: unknown, now: number): Promise<PageState | 'expired' | null> {
    const p = await verifyRecord<PageState>(secret, PAGE_LABEL, signed);
    if (!p || typeof p.linkId !== 'string' || !LINK_ID_RE.test(p.linkId) || typeof p.exp !== 'number') return null;
    return p.exp < now ? 'expired' : p;
}

// ── Metadata ────────────────────────────────────────────────────────────────

export const resourceUrl = (origin: string, linkId: string) => connectorMcpUrl(origin, linkId);

/** The link a `resource` parameter names, or null when it is not one of ours. */
export function linkFromResource(origin: string, resource: unknown): string | null {
    if (typeof resource !== 'string') return null;
    const prefix = `${origin}/mcp/`;
    if (!resource.startsWith(prefix)) return null;
    const id = resource.slice(prefix.length).replace(/\/$/, '');
    return LINK_ID_RE.test(id) ? id : null;
}

/** RFC 9728. With a link: path form; without: the root fallback. */
export function protectedResourceMetadata(origin: string, linkId?: string): Record<string, unknown> {
    const resource = linkId ? resourceUrl(origin, linkId) : origin;
    return {
        resource,
        authorization_servers: [resource],
        bearer_methods_supported: ['header'],
        scopes_supported: [SCOPE],
        resource_name: 'Chrome bookmarks (Visual Bookmark Manager)',
    };
}

/**
 * RFC 8414. Path form: the issuer is the link's MCP address. Root form: the
 * endpoints take the link from the `resource` parameter (or the code prefix).
 */
export function authServerMetadata(origin: string, linkId?: string): Record<string, unknown> {
    const issuer = linkId ? resourceUrl(origin, linkId) : origin;
    return {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [SCOPE],
        authorization_response_iss_parameter_supported: true,
    };
}

export const resourceMetadataUrl = (origin: string, linkId: string) => `${origin}/.well-known/oauth-protected-resource/mcp/${linkId}`;

export const wwwAuthenticate = (origin: string, linkId: string, error?: string) =>
    `Bearer resource_metadata="${resourceMetadataUrl(origin, linkId)}"${error ? `, error="${error}"` : ''}`;

/** The redirect back to the app, success or error (RFC 6749 4.1.2, RFC 9207 `iss`). */
export function redirectBack(redirectUri: string, params: Record<string, string | undefined>): string {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
}
