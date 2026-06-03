// AI engine for auto-tagging and smart search.
// Supports:
//   • Built-in  — Chrome's on-device Gemini Nano (LanguageModel API, Chrome 138+)
//   • Cloud     — OpenAI / Anthropic / Gemini / Groq / Mistral / xAI / DeepSeek /
//                 Together / Cerebras / Perplexity / OpenRouter / Ollama / Custom

import { loadAISettings, getDecryptedApiKey, type AIProvider, type AICloudConfig } from './ai_settings_storage';

export const AI_TAGS = [
    'Dev', 'Design', 'Finance', 'Shopping', 'News',
    'Reading', 'Social', 'Tools', 'Video', 'Work',
    'Health', 'Travel', 'Education', 'Entertainment', 'Other',
] as const;

export type AITag = typeof AI_TAGS[number];
export type AIAvailability = 'available' | 'after-download' | 'unavailable' | 'unsupported';

// Single AI request must not block forever — a hung on-device model or an
// unreachable endpoint is bounded by this, so the batch loop (and Stop) stays responsive.
const AI_CALL_TIMEOUT_MS = 60000;

// Combine an optional caller signal (batch abort) with a per-call timeout.
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Turn raw provider/SDK errors into something a user can act on.
export function friendlyError(err: unknown): string {
    if (err instanceof DOMException && err.name === 'AbortError') return 'Request cancelled.';
    if (err instanceof DOMException && err.name === 'TimeoutError') return 'AI request timed out. The model may be busy or unreachable.';
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) return 'Request cancelled.';
    if (/timed? ?out|timeout/i.test(msg)) return 'AI request timed out. The model may be busy or unreachable.';
    if (/\b401\b|invalid.*api.*key|unauthor|invalid_api_key/i.test(msg)) return 'Invalid or missing API key — check Provider Settings.';
    if (/\b403\b|permission|forbidden/i.test(msg)) return 'Access denied by the provider (key lacks permission or wrong region).';
    if (/\b404\b|not found|no longer available|does not exist/i.test(msg)) return 'Model not found — update the model name in Provider Settings.';
    if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return 'Rate limited by the provider — wait a moment and retry.';
    if (/quota|billing|insufficient|exceeded your current/i.test(msg)) return 'Quota or billing issue with your provider account.';
    if (/failed to fetch|networkerror|load failed|err_connection|fetch failed/i.test(msg)) return 'Network error — provider unreachable. Check the URL, your connection, and (for local servers) CORS.';
    if (/\b5\d\d\b|internal server|service unavailable|bad gateway/i.test(msg)) return 'Provider server error — try again shortly.';
    return msg.length > 220 ? msg.slice(0, 220) + '…' : msg;
}

// A "fatal" error is a misconfiguration that will fail identically for EVERY
// bookmark (bad key, wrong model, quota, unsupported) — so a batch should stop
// and report rather than retry it hundreds of times. Everything else (timeout,
// rate-limit, a single odd response, a transient network blip) is per-item and
// safe to skip-and-continue. Classifies the normalised friendlyError() text.
export function isFatalAIError(friendlyMessage: string): boolean {
    return /invalid or missing api key|access denied|model not found|quota or billing|no api key configured|no model name configured|custom endpoint url not configured|not available|chrome 138/i.test(friendlyMessage);
}

// The curated list is now a STEER, not a hard whitelist: the model is encouraged
// to reuse these common tags (so similar bookmarks group under the same pill), but
// may coin a more specific tag when none fits. Keeps filters consistent without
// boxing everything into 15 buckets.
const SUGGESTED_TAGS = AI_TAGS.filter(t => t !== 'Other');

// Build the tagging instruction. The user's preferred tags (if any) are a STEER:
// the model is pushed toward them and their level of specificity, but may still
// fall back to the common tags or coin its own when nothing fits.
function buildTagPrompt(customTags: string[] = []): string {
    const pref = customTags.length
        ? `Strongly prefer these user-defined tags whenever one fits, and match their level of specificity: ${customTags.join(', ')}. `
        : '';
    return 'You categorize web bookmarks into 1-3 concise topic tags (1-2 words each, Title Case). '
        + pref
        + `Otherwise prefer one of these common tags when it fits: ${SUGGESTED_TAGS.join(', ')}. `
        + 'If none fits well, use your own more specific tag instead. '
        + 'Respond with ONLY a comma-separated list of tags — no other text. Example: Dev, Tools';
}

const SEARCH_SYSTEM_PROMPT =
    'You are a bookmark search assistant. You receive a query and a numbered list of bookmarks, ' +
    'each line formatted "<number>. <title> — <url>". Return ONLY a JSON array of the NUMBERS of the ' +
    'bookmarks that match the query — by topic OR by keywords appearing in the title or URL. ' +
    'Return [] if none match. No explanation, just the array. Example: [2, 5, 9]';

// Smart Search list caps. Gemini Nano (on-device) has a small context window, so
// keep its list short; cloud models have large windows and handle far more.
export const SEARCH_CAP_BUILTIN = 50;
export const SEARCH_CAP_CLOUD = 1000;

// Output-token CEILINGS (not targets — models stop at their own stop token and
// you're billed for actual output). Tagging emits a few tokens, so its ceiling is
// small; search emits a numbers array, so it gets generous headroom. Both run with
// "thinking" disabled (see callGemini) — these are structured tasks, not reasoning.
const TAG_MAX_TOKENS = 256;
const SEARCH_MAX_TOKENS = 2048;

// ─── Built-in AI (Gemini Nano) ────────────────────────────────────────────────

let _templateSession: AILanguageModelSession | null = null;
let _templatePromise: Promise<AILanguageModelSession> | null = null;
let _templateKey = ''; // the systemPrompt the cached session was built with

async function getOrCreateTemplate(systemPrompt: string, signal?: AbortSignal): Promise<AILanguageModelSession> {
    if (_templateSession && _templateKey === systemPrompt) return _templateSession;
    if (_templatePromise && _templateKey === systemPrompt) return _templatePromise;
    // First run, or the prompt changed (e.g. preferred tags were edited) — drop any
    // stale session and rebuild. The very first create loads the model into memory
    // and can hang, so it's bound by the signal (batch-abort + timeout).
    if (_templateSession) { try { _templateSession.destroy(); } catch { /* ignore */ } _templateSession = null; }
    _templateKey = systemPrompt;
    _templatePromise = LanguageModel.create({ systemPrompt, temperature: 0.2, topK: 3, signal });
    try {
        _templateSession = await _templatePromise;
        return _templateSession;
    } finally {
        _templatePromise = null;
    }
}

export function invalidateAITemplate(): void {
    try { _templateSession?.destroy(); } catch { /* ignore */ }
    _templateSession = null;
    _templatePromise = null;
    _templateKey = '';
}

// Generic built-in call — creates a fresh session (no template caching needed for one-off calls)
async function callBuiltInRaw(systemPrompt: string, userMessage: string, signal?: AbortSignal): Promise<string> {
    const sig = withTimeout(signal, AI_CALL_TIMEOUT_MS);
    const session = await LanguageModel.create({ systemPrompt, temperature: 0, signal: sig });
    try {
        return await session.prompt(userMessage, { signal: sig });
    } finally {
        session.destroy();
    }
}

// ─── Cloud API helpers ────────────────────────────────────────────────────────

async function callOpenAICompat(
    apiKey: string, model: string, systemPrompt: string, userContent: string, endpoint: string,
    signal?: AbortSignal, maxTokens = 150
): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: withTimeout(signal, AI_CALL_TIMEOUT_MS),
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
            max_tokens: maxTokens,
            temperature: 0.2,
        }),
    });
    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(
    apiKey: string, model: string, systemPrompt: string, userContent: string, signal?: AbortSignal, maxTokens = 150
): Promise<string> {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: withTimeout(signal, AI_CALL_TIMEOUT_MS),
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model, system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
            max_tokens: maxTokens,
        }),
    });
    if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? '';
}

async function callGemini(
    apiKey: string, model: string, systemPrompt: string, userContent: string, signal?: AbortSignal, maxTokens = 150
): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature: 0.2 };
    // Gemini 2.5 Flash enables "thinking" by default, drawn from the SAME output
    // budget — so a small budget gets spent on hidden reasoning and the visible
    // reply comes back empty/truncated. Disable it for these short structured tasks.
    if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const resp = await fetch(url, {
        method: 'POST',
        signal: withTimeout(signal, AI_CALL_TIMEOUT_MS),
        // Key goes in a header, never the URL — URLs leak into logs/proxies/timing APIs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userContent }] }],
            generationConfig,
        }),
    });
    if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

const OPENAI_COMPAT_ENDPOINTS: Partial<Record<AIProvider, string>> = {
    openai:      'https://api.openai.com/v1/chat/completions',
    groq:        'https://api.groq.com/openai/v1/chat/completions',
    mistral:     'https://api.mistral.ai/v1/chat/completions',
    deepseek:    'https://api.deepseek.com/v1/chat/completions',
    xai:         'https://api.x.ai/v1/chat/completions',
    together:    'https://api.together.xyz/v1/chat/completions',
    cerebras:    'https://api.cerebras.ai/v1/chat/completions',
    perplexity:  'https://api.perplexity.ai/chat/completions',
    openrouter:  'https://openrouter.ai/api/v1/chat/completions',
};

async function callCloudRaw(
    systemPrompt: string, userContent: string, cloud: AICloudConfig, signal?: AbortSignal, maxTokens = 150
): Promise<string> {
    if (!cloud.model || !cloud.model.trim()) {
        throw new Error('No model name configured. Open Provider Settings to set one.');
    }
    const apiKey = await getDecryptedApiKey();
    if (!apiKey && cloud.provider !== 'ollama' && cloud.provider !== 'custom') {
        throw new Error('No API key configured. Open Provider Settings to add one.');
    }
    if (cloud.provider === 'anthropic') return callAnthropic(apiKey, cloud.model, systemPrompt, userContent, signal, maxTokens);
    if (cloud.provider === 'gemini')    return callGemini(apiKey, cloud.model, systemPrompt, userContent, signal, maxTokens);

    let endpoint: string;
    if (cloud.provider === 'ollama') {
        endpoint = (cloud.customUrl?.replace(/\/$/, '') ?? 'http://localhost:11434') + '/v1/chat/completions';
    } else if (cloud.provider === 'custom') {
        if (!cloud.customUrl) throw new Error('Custom endpoint URL not configured.');
        endpoint = cloud.customUrl.replace(/\/$/, '') + '/chat/completions';
    } else {
        endpoint = OPENAI_COMPAT_ENDPOINTS[cloud.provider] ?? 'https://api.openai.com/v1/chat/completions';
    }
    return callOpenAICompat(apiKey, cloud.model, systemPrompt, userContent, endpoint, signal, maxTokens);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkAIAvailability(): Promise<AIAvailability> {
    const { settings, hasApiKey } = await loadAISettings();
    if (settings.mode === 'cloud') {
        // Ollama and Custom don't require a key
        const noKeyRequired = settings.cloud.provider === 'ollama' || settings.cloud.provider === 'custom';
        return (hasApiKey || noKeyRequired) ? 'available' : 'unavailable';
    }
    if (typeof LanguageModel === 'undefined') return 'unsupported';
    try {
        return await LanguageModel.availability() as AIAvailability;
    } catch {
        return 'unsupported';
    }
}

// ─── API-key validation + model discovery ─────────────────────────────────────

export interface KeyValidationResult {
    ok: boolean;
    models: string[];   // up to a handful of discovered model ids
    message: string;
}

// Base (without the trailing /chat/completions) for OpenAI-compatible providers.
function providerBaseUrl(provider: AIProvider, customUrl?: string): string {
    if (provider === 'ollama') return (customUrl?.replace(/\/$/, '') || 'http://localhost:11434') + '/v1';
    if (provider === 'custom') return (customUrl || '').replace(/\/$/, '');
    const ep = OPENAI_COMPAT_ENDPOINTS[provider] ?? 'https://api.openai.com/v1/chat/completions';
    return ep.replace(/\/chat\/completions$/, '');
}

function parseModelList(data: unknown): string[] {
    const d = data as { data?: unknown[]; models?: unknown[] };
    const list = Array.isArray(d?.data) ? d.data : (Array.isArray(d?.models) ? d.models : []);
    return list
        .map(m => {
            if (typeof m === 'string') return m;
            const o = m as { id?: string; name?: string; slug?: string };
            return (o.id || o.name || o.slug || '').replace(/^models\//, '');
        })
        .filter((s): s is string => !!s)
        .slice(0, 6);
}

/**
 * Validate a provider API key (or local-endpoint reachability) and, where the
 * provider exposes a models list, return a few available model ids. Mirrors the
 * approach used in Reply Wizard. Runs from the popup (host_permissions: <all_urls>).
 */
export async function validateProviderKey(
    provider: AIProvider, apiKey: string, model: string, customUrl?: string
): Promise<KeyValidationResult> {
    const sig = withTimeout(undefined, 15000);
    try {
        // Anthropic — list models with the direct-browser-access header.
        if (provider === 'anthropic') {
            const res = await fetch('https://api.anthropic.com/v1/models', {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                signal: sig,
            });
            if (!res.ok) return { ok: false, models: [], message: friendlyError(`error ${res.status}`) };
            const models = parseModelList(await res.json());
            return { ok: true, models, message: 'Key verified.' };
        }

        // Gemini — list models via the generativelanguage endpoint.
        if (provider === 'gemini') {
            const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
                headers: { 'x-goog-api-key': apiKey },
                signal: sig,
            });
            if (!res.ok) return { ok: false, models: [], message: friendlyError(`error ${res.status}`) };
            const models = parseModelList(await res.json()).filter(m => m.startsWith('gemini')).slice(0, 6);
            return { ok: true, models, message: 'Key verified.' };
        }

        // Perplexity — no GET /models; probe with a 1-token chat completion.
        if (provider === 'perplexity') {
            const res = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: model || 'sonar', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
                signal: sig,
            });
            if (res.ok) return { ok: true, models: [], message: 'Key verified.' };
            if (res.status === 401 || res.status === 403) return { ok: false, models: [], message: 'Invalid key.' };
            // A server error is inconclusive — don't claim the key is valid.
            if (res.status >= 500) return { ok: false, models: [], message: friendlyError(`error ${res.status}`) };
            // Anything else (e.g. 400 for an unknown model) still proves the key authenticated.
            return { ok: true, models: [], message: 'Key verified.' };
        }

        // Standard OpenAI-compatible: GET {base}/models.
        const base = providerBaseUrl(provider, customUrl);
        if ((provider === 'custom' || provider === 'ollama') && !base) {
            return { ok: false, models: [], message: 'Enter the base URL first.' };
        }
        const headers: Record<string, string> = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const res = await fetch(`${base}/models`, { headers, signal: sig });
        if (!res.ok) {
            // Local servers (ollama/custom) don't require a key — reachability is the test.
            return { ok: false, models: [], message: friendlyError(`error ${res.status}`) };
        }
        const models = parseModelList(await res.json());
        const verified = (provider === 'ollama' || provider === 'custom') ? 'Endpoint reachable.' : 'Key verified.';
        return { ok: true, models, message: verified };
    } catch (err) {
        return { ok: false, models: [], message: friendlyError(err) };
    }
}

// Open-vocabulary parse: accept whatever the model returns, just cleaned up.
// Strips quotes/brackets/list markers, collapses whitespace, caps length, and
// de-duplicates case-insensitively so "Dev"/"dev" don't both appear. Capped at 3.
export function parseTags(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(',')) {
        const tag = part
            .replace(/["'[\]]/g, '')          // quotes / brackets from JSON-ish output
            .replace(/^\s*[-*\d.)]+\s+/, '')   // leading bullets or "1." numbering
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 24);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= 3) break;
    }
    return out;
}

export async function tagBookmark(title: string, url: string, signal?: AbortSignal): Promise<string[]> {
    const { settings } = await loadAISettings();
    let domain = '';
    let path = '';
    try {
        const u = new URL(url);
        domain = u.hostname.replace(/^www\./, '');
        // Decode and trim the path+query — it often carries the real topic signal
        // (e.g. /better-marketing/10-steps…) that the bare domain lacks. Bounded so
        // a huge query string can't dominate the prompt.
        path = decodeURIComponent(u.pathname + u.search).replace(/\/+$/, '').slice(0, 200);
    } catch { /* ignore */ }
    const userContent = `Title: ${title}\nDomain: ${domain}`
        + (path && path !== '/' ? `\nPath: ${path}` : '');
    const sysPrompt = buildTagPrompt(settings.customTags);

    let raw: string;
    if (settings.mode === 'cloud') {
        raw = await callCloudRaw(sysPrompt, userContent, settings.cloud, signal, TAG_MAX_TOKENS);
    } else {
        const sig = withTimeout(signal, AI_CALL_TIMEOUT_MS);
        const template = await getOrCreateTemplate(sysPrompt, sig);
        const session = await template.clone({ signal: sig });
        try {
            raw = await session.prompt(userContent, { signal: sig });
        } finally {
            session.destroy();
        }
    }
    const tags = parseTags(raw);
    return tags.length > 0 ? tags : ['Other'];
}

export async function searchBookmarks(
    query: string,
    bookmarks: Array<{ title: string; url: string }>,
    signal?: AbortSignal
): Promise<string[]> {
    if (!query.trim() || bookmarks.length === 0) return [];
    const { settings } = await loadAISettings();

    // Cap by provider: on-device Gemini Nano has a tiny context window, cloud
    // models have large ones — so don't throttle cloud search to a token budget
    // it doesn't have.
    const cap = settings.mode === 'builtin' ? SEARCH_CAP_BUILTIN : SEARCH_CAP_CLOUD;
    const capped = bookmarks.slice(0, cap);

    // Literal keyword matches ALWAYS count, so obvious hits surface even if the
    // model misses them. Token-AND (all words must appear) so "south indian"
    // matches "south-indian-recipes" in a title or URL.
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = new Set<string>();
    for (const b of capped) {
        const hay = `${b.title} ${b.url}`.toLowerCase();
        if (terms.every(t => hay.includes(t))) results.add(b.url);
    }

    const bookmarkList = capped
        .map((b, i) => `${i + 1}. "${b.title}" — ${b.url}`)
        .join('\n');
    const userMessage = `Query: "${query}"\n\nBookmarks:\n${bookmarkList}`;

    // AI semantic matches (returned as item NUMBERS — short output, no fragile
    // URL string-matching). If the AI call fails but we already have literal hits,
    // return those rather than erroring.
    let raw = '';
    try {
        if (settings.mode === 'cloud') {
            raw = await callCloudRaw(SEARCH_SYSTEM_PROMPT, userMessage, settings.cloud, signal, SEARCH_MAX_TOKENS);
        } else {
            raw = await callBuiltInRaw(SEARCH_SYSTEM_PROMPT, userMessage, signal);
        }
    } catch (err) {
        if (results.size === 0) throw err;
    }

    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) {
        try {
            const nums = JSON.parse(match[0]) as unknown[];
            for (const n of nums) {
                const idx = typeof n === 'number' ? n : parseInt(String(n), 10);
                const bm = capped[idx - 1];
                if (bm) results.add(bm.url);
            }
        } catch { /* ignore parse errors — literal matches still returned */ }
    }
    return Array.from(results);
}
