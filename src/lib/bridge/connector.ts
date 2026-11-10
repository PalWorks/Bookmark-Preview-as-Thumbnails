// SPDX-License-Identifier: AGPL-3.0-only
//
// Online connector wire contract (docs/designs/ai-assistant.md). Imported by the
// extension (src/sw/remote_link.ts) and by the Cloudflare Worker (connector/),
// so both sides agree. No DOM, no Node, no chrome.* here.
//
// Claude and ChatGPT reach only public HTTPS addresses, so a small Worker stands
// between them and the user's browser. The browser holds one WebSocket to its
// own Durable Object ("link"); MCP requests arrive at /mcp/<linkId> and are
// relayed over that socket as ordinary bridge requests. The Worker stores no
// bookmark data and no tokens: only a hash of the link secret and, for 2
// minutes, a one-time authorization code.

import type { ClientRequest, ClientResponse } from './protocol.ts';

/** Production address: a custom domain on palworks.ai (the workers.dev address stays on for 1.7.0 copies). Deploying it needs the owner. */
export const CONNECTOR_ORIGIN = 'https://bookmarks-connector.palworks.ai';

/** Link ids: 16 random bytes, base64url (22 chars). Secrets: 32 bytes (43 chars). */
export const LINK_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const LINK_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** Keepalive: each side pings every 20 s; a socket silent for 60 s is closed. */
export const LINK_PING_MS = 20_000;
export const LINK_IDLE_MS = 60_000;
/** How long the Worker waits for the browser to answer one request. */
export const LINK_REQUEST_TIMEOUT_MS = 30_000;

export const connectorMcpUrl = (origin: string, linkId: string) => `${origin.replace(/\/$/, '')}/mcp/${linkId}`;
export const connectorSocketUrl = (origin: string) => `${origin.replace(/\/$/, '').replace(/^http/, 'ws')}/link`;

/** Browser -> Worker over the link socket. */
export type LinkFromBrowser =
    /** First frame. The Worker keeps sha256(secret) on first use; later hellos must match. */
    | { type: 'hello'; linkId: string; secret: string; extVersion: string; protocolVersion: number }
    | { type: 'response'; rid: string; res: ClientResponse }
    | { type: 'ping' }
    | { type: 'pong' };

/** Worker -> browser over the link socket. */
export type LinkFromWorker =
    | { type: 'ready' }
    /** The hello was refused (bad secret, bad id); the socket closes after this. */
    | { type: 'refused'; reason: string }
    /** One bridge request. `via` names the AI app, from its OAuth registration (shown in the extension). */
    | { type: 'request'; rid: string; via: string; req: ClientRequest }
    | { type: 'ping' }
    | { type: 'pong' };
