# Bookmarks connector (Cloudflare Worker)

Last updated: 2026-11-10T03:45:49+00:00 (CSP line completed)

A remote MCP server with OAuth 2.1 that lets Claude (claude.ai custom connectors, desktop and
phone apps) and ChatGPT (developer mode apps) read and change a user's Chrome bookmarks. Spec:
[docs/designs/ai-assistant.md](../docs/designs/ai-assistant.md), sections "Online connector" and
"Limits".

Claude and ChatGPT reach only public HTTPS addresses, so this Worker stands between them and the
user's browser. The extension keeps one WebSocket open to a Durable Object of its own (one per
link); MCP tool calls arriving at `/mcp/<linkId>` are relayed over that socket as ordinary bridge
requests, and the extension answers them exactly as it answers a local coding agent.

```
Claude / ChatGPT ──HTTPS (MCP + OAuth)──▶ Worker /mcp/<linkId> ──▶ LinkObject <linkId>
                                                                     │ WebSocket (opened by the browser)
                                                                     ▼
                                                      extension service worker
```

The wire types, tool list and errors are shared with the extension and never copied:
[`src/lib/bridge/connector.ts`](../src/lib/bridge/connector.ts),
[`tools.ts`](../src/lib/bridge/tools.ts), [`protocol.ts`](../src/lib/bridge/protocol.ts).
Wrangler bundles them with esbuild.

## Endpoints

| Path | What |
| --- | --- |
| `GET /link?id=<linkId>` | WebSocket from the extension. First frame `hello {linkId, secret}`; answered `ready` or `refused`. |
| `POST /mcp/<linkId>` | MCP Streamable HTTP, JSON responses (no SSE). Bearer token required. `GET` answers 405. |
| `GET /.well-known/oauth-protected-resource/mcp/<linkId>` | RFC 9728 metadata (root form at `/.well-known/oauth-protected-resource`). |
| `GET /.well-known/oauth-authorization-server/mcp/<linkId>` | RFC 8414 metadata, path form; root form takes the link from `resource`. Also served under `openid-configuration`. |
| `POST /register` | Dynamic client registration, stateless: the client id is an HMAC-signed record of the redirect URIs and name. |
| `GET/POST /mcp/<linkId>/authorize` | The page a person sees (root `/authorize` reads the link from `resource`). |
| `POST /mcp/<linkId>/token` | `authorization_code` with PKCE S256, and `refresh_token` (root `/token` reads the link from the code). |

The authorize page shows which app is asking and where it will send the person back, then a
6-digit code field: the person opens the extension (menu > Connect Claude or ChatGPT) and types the
code shown there. "No code showing? Ask the extension for one" sends `pair` without a code. The
right code sends `pair` with it; the extension answers with its token, which the Worker wraps in a
one-time authorization code (2 minutes) and redirects back to the app. The token endpoint returns
that token as the access token. Removing the connection in the extension revokes it; the next MCP
call then gets `401` and the app asks the person to connect again.

The page uses plain HTML forms and no script. Its styles come from `/assets/authorize.css`, so the
Content-Security-Policy is `default-src 'none'; style-src 'self'; form-action 'self' <app origin>;
frame-ancestors 'none'; base-uri 'none'`. The form fields that carry the OAuth parameters are HMAC-signed, so they
cannot be changed; posts from another origin are refused.

## Privacy: what is stored

Nothing about bookmarks, and no long-lived token. Per link (`LinkObject`): the SHA-256 of the link
secret, a per-minute MCP request counter, and, for at most 2 minutes, each unused authorization
code (stored under its hash, holding the extension token, client id, redirect URI and PKCE
challenge). Per network (`AuthLimiter`): one counter for one minute, named by an HMAC of the
address, never the address. Client registrations are not stored at all.

Never logged: tokens, secrets, codes, request or response bodies. The only log line is an error
name with the path, link ids masked.

## Limits

64 KB per request (`413`), 30 s per tool call, 4 authorization attempts a minute per network
(start and code entry both count), 60 MCP requests a minute per link (`429`).

## Run locally

```bash
npm install
printf 'CLIENT_ID_SECRET="%s"\n' "$(openssl rand -base64 48)" > .dev.vars   # gitignored
npm test            # unit tests, plain Node 22 (types stripped)
npm run typecheck
npm run smoke       # starts wrangler dev --local, plays browser and MCP client, stops it
npm run dev         # wrangler dev --local on http://localhost:8787
```

`npm run smoke` runs the whole flow against workerd: link hello and refusal of a wrong secret,
registration, the authorize page forms, PKCE token exchange, `initialize`, `tools/list`,
`tools/call list_folders`, `401` for an unknown token, and `NOT_CONNECTED` after the browser goes.
Set `SMOKE_URL` to run it against a server you started.

## Deploy (owner)

```bash
npm install
openssl rand -base64 48 | npx wrangler secret put CLIENT_ID_SECRET
npm test && npm run typecheck && npm run smoke
npx wrangler deploy
```

The Worker is `bookmarks-thumbnails-connector`, served on `bookmarks-connector.palworks.ai`
(matching `CONNECTOR_ORIGIN` in `src/lib/bridge/connector.ts`) and on workers.dev for 1.7.0 copies.
Both addresses reach the same Durable Objects, so a link works on either. Preview URLs are off. Without
`CLIENT_ID_SECRET` every OAuth and MCP endpoint answers `503`. Rotating the secret invalidates every
registered client id, so each app registers and connects again; tokens already issued keep working.

Licence: AGPL-3.0-only, as the rest of the repository.
