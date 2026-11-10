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

It accepts only our extension's origins (`ALLOWED_ORIGINS`; a web page from any other origin gets
`403`, a request with no Origin still meets every limit), validates, rate limits per network, sends one email to `FEEDBACK_TO` from `FEEDBACK_FROM`,
and stores no message content. `GET /health` returns `{ "ok": true }`.

Protections: JSON only, 16 KB body cap, 4,000-character message cap, plausible-email check,
honeypot field (`website`) answered with a silent 200, and a generic error on provider failure
so no account detail leaks. Errors are always `{ "error": "..." }`, which the form shows as is.

Rate limits, cheapest first:

1. Cloudflare's `BURST` binding: about 3 a minute per network, per data centre.
2. 5 messages per network per hour (`429`).
3. 30 messages a day for everyone together (owner decision 2026-11-09) (`503`).

Limits 2 and 3 live in one Durable Object, `FeedbackLimiter` (`src/limiter.ts`). It handles one
request at a time, so counts are exact under concurrency (KV counters were not: review of PR #11).
If the limiter cannot be reached the relay answers `503` and sends nothing. A send that fails
(`502`/`504`) gives the allowance back. An IPv6 address counts as its /64 network.

A network's counter is named by an HMAC-SHA256 of its address under `IP_HASH_SECRET`, never the
address; an hourly alarm deletes stale counters, so none outlives 26 hours. The Resend call times out after 8 seconds (`504`),
inside the extension's 12-second timeout.

## Setup

```bash
npm install
npx wrangler secret put RESEND_API_KEY                 # send-only key scoped to palworks.ai
openssl rand -base64 48 | npx wrangler secret put IP_HASH_SECRET
npx --yes node@22.18 --test test/index.test.ts && npm run typecheck
npx wrangler deploy
```

`FEEDBACK_FROM` and `FEEDBACK_TO` are plain vars in `wrangler.toml`; the API key and
`IP_HASH_SECRET` are secrets and never in this repository. The Worker fails closed without
`IP_HASH_SECRET`.

## Deployed instance

`https://bookmarks-feedback.palworks.ai` (custom domain, attached 2026-11-10) and
`https://thumbnail-bookmarks-feedback.sunmooncal.workers.dev` (kept for 1.6.0 and 1.7.0), deployed
2026-11-09 on the PalWorks Cloudflare account, preview URLs off. Durable Object `FeedbackLimiter`
(SQLite-backed, migration `v1`, redeployed 2026-11-09); rate-limit namespace `2003` (2001 and 2002 belong to
other PalWorks workers on the same account). Sender `feedback.ThumbnailBookmarks@palworks.ai`,
recipient `support@palworks.ai`. The Resend key is a sending-only key named
"thumbnail-bookmarks-feedback worker", scoped to the `palworks.ai` domain.

## Pointing the extension at it

`FEEDBACK_ENDPOINT` in [../src/lib/feedback.ts](../src/lib/feedback.ts) holds the deployed URL.
Change it there and rebuild the extension if the Worker moves.
