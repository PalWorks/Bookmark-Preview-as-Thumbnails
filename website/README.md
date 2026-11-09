# Website

_Last updated: 2026-11-09T16:02:00+00:00 (replaced the AI Studio template text with how this site is actually built and deployed)._

The marketing site for Bookmarks as Thumbnails: https://palworks.github.io/Bookmark-Preview-as-Thumbnails/

React 19 and Vite, styled with the Tailwind CDN script in `index.html`. It needs no API key and
no environment variables; do not add one (see "No keys in anything shipped" in the root
[AGENTS.md](../AGENTS.md)).

## Pages

| Route | Component | Notes |
|---|---|---|
| `#` (home) | `HeroSection`, `FeaturesSection`, `PricingSection`, `Testimonials`, `TallyForm` | Features, pricing (AGPL and commercial), contact form (Tally) |
| `#privacy` | `components/Legal.tsx` | The privacy policy the Chrome Web Store listing links to. Keep it in line with [PRIVACY.md](../PRIVACY.md) in the same change |
| `#terms` | `components/Legal.tsx` | Terms and licence summary |
| `#contact` | `TallyForm` | Contact form |

## Run locally

```bash
cd website
npm ci
npm run dev       # http://localhost:3000
npm run build     # -> website/dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` that
changes `website/**` (or the workflow itself). There is no other deploy step.
