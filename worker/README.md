# Feedback worker

Relays the extension's in-built feedback form (Settings > Submit Feedback, 1.6.0) to email via
Resend. Adapted from the Gmail Labels as Tabs relay.

The extension cannot call Resend directly: a published extension is a zip anyone can unpack, so
an API key inside it is a public key. This Worker holds the key instead (D16 in
[DECISIONS.md](../DECISIONS.md)). It is the only server of ours the extension talks to.

## What it does

`POST /feedback` with JSON:

```json
{
  "category": "bug|feature|question|other",
  "message": "...",
  "replyTo": "optional@example.com",
  "diagnostics": { "version": "1.6.0", "browser": "Chrome/156.0.0.0 on Linux", "bookmarks": 794, "folders": 12, "view": "grid" },
  "website": ""
}
```

It validates, rate limits per network, sends one email to `FEEDBACK_TO` from `FEEDBACK_FROM`,
and stores no message content. `GET /health` returns `{ "ok": true }`.

Protections: JSON only, 16 KB body cap, 4,000-character message cap, plausible-email check,
honeypot field (`website`) answered with a silent 200, and a generic error on provider failure
so no account detail leaks. Errors are always `{ "error": "..." }`, which the form shows as is.

Rate limits, cheapest first:

1. Cloudflare's `BURST` binding: about 3 a minute per network, per data centre.
2. 5 messages per network per hour, a KV counter (`429`).
3. 300 messages a day for everyone together, a KV counter (`503`).

A network's counter is named by an HMAC-SHA256 of its IP under `IP_HASH_SECRET`, never the IP,
and every key expires within 26 hours. The Resend call times out after 8 seconds (`504`),
inside the extension's 12-second timeout.

## Setup

```bash
npm install
npx wrangler kv namespace create thumbnail-bookmarks-feedback-counters  # id goes in wrangler.toml
npx wrangler secret put RESEND_API_KEY                 # send-only key scoped to palworks.ai
openssl rand -base64 48 | npx wrangler secret put IP_HASH_SECRET
npx --yes node@22.18 --test test/index.test.ts && npm run typecheck
npx wrangler deploy
```

`FEEDBACK_FROM` and `FEEDBACK_TO` are plain vars in `wrangler.toml`; the API key and
`IP_HASH_SECRET` are secrets and never in this repository. The Worker fails closed without
`IP_HASH_SECRET`.

## Deployed instance

`https://thumbnail-bookmarks-feedback.sunmooncal.workers.dev`, deployed 2026-11-09 on the PalWorks
Cloudflare account, workers.dev only, preview URLs off. KV namespace
`thumbnail-bookmarks-feedback-counters`; rate-limit namespace `2003` (2001 and 2002 belong to
other PalWorks workers on the same account). Sender `feedback.ThumbnailBookmarks@palworks.ai`,
recipient `support@palworks.ai`. The Resend key is a sending-only key named
"thumbnail-bookmarks-feedback worker", scoped to the `palworks.ai` domain.

## Pointing the extension at it

`FEEDBACK_ENDPOINT` in [../src/lib/feedback.ts](../src/lib/feedback.ts) holds the deployed URL.
Change it there and rebuild the extension if the Worker moves.
