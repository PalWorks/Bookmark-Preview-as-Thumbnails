# Ask AI and the online connector

_Last updated: 2026-11-10T17:21:42+00:00 (D24: side panel, chats on the device, model picker, Trash approval, Redo, security review)._

## Why

The 1.7.0 draft asked people to copy a prompt into ChatGPT, then paste the answer back. Nobody
will do that twice. The owner set the direction (D20): the AI acts on the bookmarks itself, from
a chat inside the extension or from the Claude and ChatGPT apps, phone included.

## What the user gets

| Surface | How it works | Needs |
|---|---|---|
| **Ask AI** (panel in the extension) | Type "move my recipe bookmarks into a Cooking folder". The model the user already set up for auto-tagging calls the bookmark tools; changes apply at once with Undo. | An API key in AI settings (OpenAI, Anthropic, Gemini, Groq, Mistral, and the other OpenAI-compatible providers) or a local Ollama |
| **Claude and ChatGPT** (online connector) | Copy one address (`https://bookmarks-connector.palworks.ai/mcp/<linkId>`; 1.7.0 shows the workers.dev address, which keeps working) from the extension into Claude ("Add custom connector") or ChatGPT (developer mode app). Sign-in shows a 6-digit code in the extension. Then talk to Claude or ChatGPT anywhere, phone included. | Chrome open on the computer, with the switch on |
| **Coding agents** (local helper, from 1.7.0) | Claude Code, Cursor, VS Code through `bookmarks-thumbnails-mcp` | Node 22 |
| Copy and paste (from 1.7.0) | Kept as "Other ways" for people without a key or connector | Nothing |

## Rules

1. **Apply now, Undo after (owner).** AI changes apply immediately. Every call is one change set:
   validated in full first (one bad change refuses the whole call with reasons), journaled, and
   undone in one click from the chat, the Activity list or by the AI (`undo_changes`). Removed items
   go to the extension's Trash. Limits per call stay: 200 changes, 1,000 items to Trash.
2. **One engine.** Every surface uses the same tools (`src/lib/bridge/tools.ts`) and the same
   request handler (`src/sw/agent_bridge.ts`), so scope, limits and error codes are identical.
3. **Scope.** Ask AI sees every folder except folders hidden from search. Connected apps see only
   the folders the user ticks when pairing (changeable later). Hidden folders are never shared.
4. **Modes per connection:** read only, review first (the 1.7.0 proposals), or change (default).
5. **The relay stores nothing it reads (owner).** The Worker keeps a hash of each link secret and,
   for 2 minutes, a one-time authorization code. Requests and answers pass through in memory.
   Tokens live only with the AI app; the extension stores their SHA-256.

## Online connector

```
Claude / ChatGPT servers ──HTTPS (MCP + OAuth)──▶ Worker /mcp/<linkId> ──▶ Durable Object "link" <linkId>
                                                                             │ WebSocket (opened by the browser)
                                                                             ▼
                                                              extension service worker (agent_bridge)
```

### Link (browser side)

- Turning on **Claude and ChatGPT** creates `linkId` (16 random bytes) and `secret` (32 bytes),
  stored in `chrome.storage.local` (`connector_link`), never in backups.
- The service worker opens `wss://<origin>/link?id=<linkId>` and sends `hello {linkId, secret}`. The Durable
  Object named `linkId` stores `sha256(secret)` on first use and refuses a different secret later.
  Pings every 20 s keep the socket and the service worker alive; an alarm reconnects every minute.
- The connector address shown to the user is `<origin>/mcp/<linkId>`. It is not a password (the
  6-digit code is), but it is not guessable either.

### OAuth 2.1 (Worker side)

- Protected resource metadata: `/.well-known/oauth-protected-resource/mcp/<linkId>` names the
  issuer `<origin>/mcp/<linkId>`; authorization server metadata at
  `/.well-known/oauth-authorization-server/mcp/<linkId>` (RFC 8414 path form) and, for clients that
  only look at the root, `/.well-known/oauth-authorization-server` with the same endpoints taking
  the link from the `resource` parameter.
- Dynamic client registration (`/register`) is stateless: `client_id` is an HMAC-signed record of
  the redirect URIs and the client name. PKCE S256 is required. Public clients only.
- `/mcp/<linkId>/authorize` serves a page: "<client name> wants to read and organise your
  bookmarks". **Show the code** sends `pair` (no code) through the link, so the extension shows a
  6-digit code and lets the user tick folders; the user types the code on the page; the Worker
  sends `pair` with the code; the extension answers with a token. The Worker wraps it in a one-time
  authorization code (2 minutes) and redirects back to the app.
- `/mcp/<linkId>/token` exchanges the code (PKCE checked) for `access_token` = the extension token.
  The refresh token grant returns the same token. Removing the connection in the extension revokes it.
- `/mcp/<linkId>` speaks MCP Streamable HTTP with JSON responses. A request without a valid token
  gets 401 with `WWW-Authenticate` pointing at the resource metadata. A browser that is offline
  gets a tool error saying to open Chrome on the computer.

### Limits

64 KB per request, 30 s per tool call, 4 authorization attempts a minute per network, 60 MCP
requests a minute per link.

## Ask AI (in the extension)

- Entry points (owner, 2026-11-10): the top bar's Ask AI icon and the menu's single **AI Tools**
  item. Both open the AI Tools page on its first tab, Ask AI. The page's tabs: Ask AI, Provider
  Settings, Auto-Tag, Smart Search, Duplicate Finder, Connect Claude or ChatGPT, AI changes.

- **Side panel and chats (D24)**: the top bar icon opens Ask AI beside the bookmarks; chats are
  kept on this device (50), each message has a time, and a pill picks the model from the key's
  list. Sending to Trash waits for the user's Apply; Undo and Redo sit at the top.
- Runs in the extension page with the provider settings and bound key from Provider Settings (D2).
- Requests follow the measured provider rules in `src/lib/ai_provider_rules.ts` (D21): OpenAI's
  newer budget field, headroom for models that think, Gemini thinking on and dynamic, an empty
  answer cut at the limit reported as an error, out of credit named, retries for 429 and 5xx.
- Tool calling for three API styles: OpenAI-compatible (most providers and Ollama), Anthropic
  Messages, Gemini. Chrome's built-in model has no tool calling and is not offered.
- Each tool call goes to the service worker (`AGENT_TOOL`), which runs it through the same handler as
  a connected app, as the built-in client "Ask AI" with every non-hidden folder in scope.
- At most 12 tool calls per message. Each apply shows a card: what changed, **Undo**.
- The panel says which provider receives the titles and links it reads.

## Not now

Windows and Edge for the local helper (Stage 3); a connector listing in the Claude and ChatGPT
directories; accounts on our side.
