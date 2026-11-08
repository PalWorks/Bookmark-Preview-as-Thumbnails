#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Post-build checks on the extension bundle (run in CI after `npm run build`):
//
// 1. Service worker hygiene. sw.js and every chunk it statically imports must
//    not contain React, dynamic import() (not allowed in an MV3 service worker),
//    or DOM access, except the known guarded fallbacks listed in ALLOWED_DOM.
// 2. No secrets and no source maps anywhere in the output.
//
// Usage: node scripts/check-bundle.mjs [distDir]   (default: dist)

import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const problems = [];

// Known DOM references reachable from the worker, each guarded at runtime:
// - capture.ts resizeDOM: used only when OffscreenCanvas is unavailable.
// - fsaccess.ts chooseDirectory: only ever called from the page, never the worker.
const ALLOWED_DOM = [
    { pattern: /document\.createElement\("canvas"\)/g, max: 1 },
    { pattern: /window\.showDirectoryPicker/g, max: 2 },
];

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

// ── 1. Service worker graph ─────────────────────────────────────────────────

const swEntry = path.join(dist, 'sw.js');
if (!fs.existsSync(swEntry)) {
    console.error(`check-bundle: ${swEntry} not found. Run the build first.`);
    process.exit(2);
}

const seen = new Set();
const queue = [swEntry];
while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = read(file);
    for (const m of code.matchAll(/(?:from|import)\s*"(\.{1,2}\/[^"]+)"/g)) {
        queue.push(path.resolve(path.dirname(file), m[1]));
    }
}

let swCode = '';
for (const file of seen) swCode += `\n${read(file)}`;

if (/\bimport\(/.test(swCode)) problems.push('Service worker graph contains dynamic import(), which MV3 workers reject.');
for (const marker of ['react.production', 'react-dom', '__SECRET_INTERNALS', 'useState(', 'createRoot(']) {
    if (swCode.includes(marker)) problems.push(`Service worker graph contains React (${marker}).`);
}

let domLeft = swCode;
for (const { pattern, max } of ALLOWED_DOM) {
    const count = (domLeft.match(pattern) ?? []).length;
    if (count > max) problems.push(`Allowed DOM reference ${pattern} appears ${count} times (max ${max}).`);
    domLeft = domLeft.replace(pattern, '');
}
for (const m of domLeft.matchAll(/\b(document|window|localStorage|sessionStorage)\.[A-Za-z_$]+/g)) {
    problems.push(`Service worker graph uses ${m[0]} outside the guarded allowlist.`);
}

// ── 2. Secrets and source maps ──────────────────────────────────────────────

const SECRET_PATTERNS = [
    [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
    [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/, 'OpenAI/Anthropic style key'],
    [/\bghp_[A-Za-z0-9]{36}\b/, 'GitHub token'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
    [/\bre_[A-Za-z0-9]{24,}/, 'Resend key'],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
    [/hooks\.slack\.com\/services\//, 'Slack webhook URL'],
    [/discord(?:app)?\.com\/api\/webhooks\//, 'Discord webhook URL'],
];

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}

for (const file of walk(dist)) {
    const rel = path.relative(dist, file);
    if (rel.endsWith('.map')) { problems.push(`Source map shipped: ${rel}`); continue; }
    if (!/\.(js|css|html|json|txt|svg)$/.test(rel)) continue;
    const code = read(file);
    if (/sourceMappingURL=/.test(code)) problems.push(`Source map reference in ${rel}`);
    for (const [re, label] of SECRET_PATTERNS) {
        const hit = code.match(re);
        if (hit) problems.push(`Possible ${label} in ${rel}: ${hit[0].slice(0, 8)}…`);
    }
}

if (problems.length) {
    console.error(`check-bundle: ${problems.length} problem(s) in ${dist}`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
}
console.log(`check-bundle: OK (${seen.size} service worker file(s) checked, no secrets or source maps in ${path.basename(dist)})`);
