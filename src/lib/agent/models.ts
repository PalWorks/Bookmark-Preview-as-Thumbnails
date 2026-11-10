// SPDX-License-Identifier: AGPL-3.0-only
//
// The model picker in Ask AI: every chat model the saved key can reach, and the
// Ask AI choice, which is separate from the model Auto-Tag uses (Provider Settings).

import type { AIProvider } from '../ai_settings_storage';
import { endpointProblem, fetchWithRetry } from '../ai_provider_rules';

export const ASK_MODEL_KEY = 'ask_ai_model';
const LIST_TIMEOUT_MS = 15_000;
const MAX_MODELS = 500;

/** Model ids that cannot chat: speech, images, embeddings, moderation and similar. */
const NOT_CHAT = /(whisper|tts|transcribe|audio|realtime|embed|embedding|moderation|dall-e|image|imagen|veo|davinci|babbage|search|guard|rerank|vision-preview|-ocr|computer-use)/i;

const BASES: Partial<Record<AIProvider, string>> = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    mistral: 'https://api.mistral.ai/v1',
    deepseek: 'https://api.deepseek.com/v1',
    xai: 'https://api.x.ai/v1',
    together: 'https://api.together.xyz/v1',
    cerebras: 'https://api.cerebras.ai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
};

/** Pull ids out of the usual list shapes; keep only chat models. Exported for tests. */
export function chatModelIds(provider: AIProvider, data: unknown): string[] {
    const d = data as { data?: unknown[]; models?: unknown[] } | unknown[];
    const list = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.models) ? d.models : [];
    const ids: string[] = [];
    for (const m of list) {
        if (typeof m === 'string') { ids.push(m); continue; }
        const o = m as { id?: string; name?: string; supportedGenerationMethods?: string[]; supported_parameters?: string[]; type?: string };
        if (provider === 'gemini' && Array.isArray(o.supportedGenerationMethods) && !o.supportedGenerationMethods.includes('generateContent')) continue;
        // OpenRouter says which models take tools; Ask AI needs them.
        if (provider === 'openrouter' && Array.isArray(o.supported_parameters) && !o.supported_parameters.includes('tools')) continue;
        if (provider === 'together' && o.type && o.type !== 'chat') continue;
        const id = (o.id || o.name || '').replace(/^models\//, '');
        if (id) ids.push(id);
    }
    const seen = new Set<string>();
    return ids
        .filter(id => id.length <= 200 && /^[\w.:/@+-]+$/.test(id) && !NOT_CHAT.test(id))
        .filter(id => (seen.has(id) ? false : (seen.add(id), true)))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_MODELS);
}

/**
 * Every chat model this key can reach. Throws with a short reason when the list
 * cannot be read; the picker then lets the user type an id instead.
 */
export async function listModels(provider: AIProvider, apiKey: string, customUrl?: string, signal?: AbortSignal): Promise<string[]> {
    let url: string;
    const headers: Record<string, string> = {};
    if (provider === 'anthropic') {
        url = 'https://api.anthropic.com/v1/models?limit=1000';
        Object.assign(headers, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    } else if (provider === 'gemini') {
        url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
        headers['x-goog-api-key'] = apiKey;
    } else if (provider === 'ollama' || provider === 'custom') {
        const base = provider === 'ollama' ? (customUrl?.replace(/\/$/, '') || 'http://localhost:11434') + '/v1' : (customUrl ?? '').replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('Set the server address in Provider Settings first.');
        const problem = endpointProblem(base);
        if (problem) throw new Error(problem);
        url = `${base}/models`;
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    } else {
        const base = BASES[provider];
        if (!base) throw new Error('This provider has no model list.');
        url = `${base}/models`;
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const resp = await fetchWithRetry(url, { headers }, { signal, timeoutMs: LIST_TIMEOUT_MS, retries: 1 });
    if (!resp.ok) throw new Error(resp.status === 401 || resp.status === 403 ? 'The provider refused the saved key.' : `The provider answered ${resp.status}.`);
    return chatModelIds(provider, await resp.json());
}

/** The model Ask AI uses: its own choice for this provider, else the Provider Settings model. */
export async function loadAskModel(provider: AIProvider, fallback: string): Promise<string> {
    const got = await chrome.storage.sync.get(ASK_MODEL_KEY).catch(() => ({} as Record<string, unknown>));
    const raw = got?.[ASK_MODEL_KEY];
    if (typeof raw !== 'string') return fallback;
    const cut = raw.indexOf('|');
    if (cut < 0 || raw.slice(0, cut) !== provider) return fallback;
    const model = raw.slice(cut + 1).trim();
    return model && model.length <= 200 ? model : fallback;
}

/** Remember the Ask AI model for this provider; an empty model goes back to the default. */
export async function saveAskModel(provider: AIProvider, model: string): Promise<void> {
    const m = model.trim();
    if (!m) await chrome.storage.sync.remove(ASK_MODEL_KEY);
    else await chrome.storage.sync.set({ [ASK_MODEL_KEY]: `${provider}|${m.slice(0, 200)}` });
}
