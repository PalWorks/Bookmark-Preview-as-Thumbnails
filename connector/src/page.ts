// SPDX-License-Identifier: AGPL-3.0-only
//
// The authorize page: plain HTML forms, no script, styles from /assets/authorize.css
// so the Content-Security-Policy allows nothing inline. Mobile first (360 px),
// light and dark, tap targets of at least 44 px.

import { escapeHtml as h } from './util.ts';

export const CSS_PATH = '/assets/authorize.css';

export const AUTHORIZE_CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--muted:#57606a;--line:#d0d7de;--accent:#0b57d0;--accent-text:#fff;--err-bg:#fdecea;--err:#8a1c12;--ok-bg:#e6f4ea;--ok:#0d652d;--focus:#0b57d0;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1b1f24;--text:#e6e8eb;--muted:#a3abb5;--line:#3a414a;--accent:#8ab4f8;--accent-text:#0b1a33;--err-bg:#3b1714;--err:#ffb4a9;--ok-bg:#12321f;--ok:#a8dab5;--focus:#8ab4f8;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:28rem;margin:0 auto;padding:1.5rem 1rem 2rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.25rem}
h1{font-size:1.3rem;line-height:1.3;margin:0 0 .75rem}
p{margin:0 0 .75rem}
.muted{color:var(--muted);font-size:.9rem}
.steps{margin:1rem 0 .5rem;font-weight:600}
label{display:block;font-weight:600;margin:.75rem 0 .35rem}
input[type=text]{width:100%;min-height:48px;font-size:1.5rem;letter-spacing:.3em;text-align:center;padding:.4rem .6rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
button{width:100%;min-height:48px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;margin-top:.75rem;padding:.6rem 1rem}
.primary{background:var(--accent);color:var(--accent-text);border:0}
.secondary{background:transparent;color:var(--accent);border:1px solid var(--line);font-weight:500}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.alert{background:var(--err-bg);color:var(--err);border-radius:8px;padding:.75rem;margin:0 0 1rem}
.note{background:var(--ok-bg);color:var(--ok);border-radius:8px;padding:.75rem;margin:0 0 1rem}
form+form{margin-top:.25rem}
`.trim();

function shell(title: string, inner: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)}</title>
<link rel="stylesheet" href="${CSS_PATH}">
</head>
<body>
<main>
<div class="card">
${inner}
</div>
</main>
</body>
</html>`;
}

export interface CodePageOptions {
    clientName: string;
    redirectHost: string;
    /** The signed page state (hidden field). */
    signed: string;
    /** Where the forms post (this authorize path). */
    action: string;
    error?: string;
    notice?: string;
}

/** The page a person sees: who is asking, the code field, and a way to ask for a code. */
export function codePage(o: CodePageOptions): string {
    const name = h(o.clientName);
    const hidden = `<input type="hidden" name="p" value="${h(o.signed)}">`;
    return shell(`Connect ${o.clientName} to your bookmarks`, `
<h1>Connect ${name} to your bookmarks</h1>
<p>${name} wants to read and organise your Chrome bookmarks. You choose which folders it can see.</p>
<p class="muted">When you are done, you go back to ${h(o.redirectHost)}.</p>
${o.error ? `<p class="alert" role="alert">${h(o.error)}</p>` : ''}
${o.notice ? `<p class="note" role="status">${h(o.notice)}</p>` : ''}
<form method="post" action="${h(o.action)}">
${hidden}
<input type="hidden" name="action" value="finish">
<p class="steps">On your computer, open the extension: menu &gt; Connect Claude or ChatGPT. Type the 6-digit code shown there.</p>
<label for="code">6-digit code</label>
<input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus aria-describedby="code-help">
<p id="code-help" class="muted">Digits only. The code in the extension changes every 10 minutes; use the one showing now.</p>
<button class="primary" type="submit">Connect</button>
</form>
<form method="post" action="${h(o.action)}">
${hidden}
<input type="hidden" name="action" value="start">
<button class="secondary" type="submit">No code showing? Ask the extension for one</button>
</form>`);
}

/** A dead end with one clear next step (bad link, expired page). */
export function messagePage(title: string, text: string): string {
    return shell(title, `<h1>${h(title)}</h1>\n<p>${h(text)}</p>`);
}
