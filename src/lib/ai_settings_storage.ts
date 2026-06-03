export type AIMode = 'builtin' | 'cloud';
export type AIProvider =
    | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral'
    | 'deepseek' | 'xai' | 'together' | 'cerebras' | 'perplexity'
    | 'openrouter' | 'ollama' | 'custom';

export interface AICloudConfig {
    provider: AIProvider;
    model: string;
    customUrl?: string; // used by ollama + custom
}

export interface AISettings {
    mode: AIMode;
    cloud: AICloudConfig;
    customTags?: string[]; // user's preferred tags, biases auto-tagging (always set by loadAISettings)
}

// Parse a comma-separated preferred-tags string into a clean, de-duplicated list.
export function parseCustomTags(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(',')) {
        const t = part.replace(/\s+/g, ' ').trim().slice(0, 30);
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
        if (out.length >= 40) break;
    }
    return out;
}

// Preferred tags persist independently of provider settings (edited on the
// Auto-Tag tab, not Provider Settings), so they have their own save path.
export async function saveCustomTags(tags: string[]): Promise<void> {
    await chrome.storage.sync.set({ ai_custom_tags: tags.join(', ') });
}

export interface ProviderMeta {
    id: AIProvider;
    label: string;
    defaultModel: string;
    keyPlaceholder: string;
    requiresKey: boolean;
    endpoint?: string; // fixed endpoint; absent = user-supplied (custom/ollama)
}

export const PROVIDERS: ProviderMeta[] = [
    { id: 'openai',      label: 'OpenAI',                   defaultModel: 'gpt-4o-mini',                              keyPlaceholder: 'sk-...',     requiresKey: true,  endpoint: 'https://api.openai.com/v1/chat/completions' },
    { id: 'anthropic',   label: 'Anthropic (Claude)',        defaultModel: 'claude-haiku-4-5-20251001',                keyPlaceholder: 'sk-ant-...', requiresKey: true },
    { id: 'gemini',      label: 'Google Gemini',             defaultModel: 'gemini-2.5-flash',                        keyPlaceholder: 'AIza...',    requiresKey: true },
    { id: 'groq',        label: 'Groq',                      defaultModel: 'llama-3.3-70b-versatile',                  keyPlaceholder: 'gsk_...',    requiresKey: true,  endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
    { id: 'mistral',     label: 'Mistral AI',                defaultModel: 'mistral-small-latest',                     keyPlaceholder: 'API key',    requiresKey: true,  endpoint: 'https://api.mistral.ai/v1/chat/completions' },
    { id: 'deepseek',    label: 'DeepSeek',                  defaultModel: 'deepseek-chat',                            keyPlaceholder: 'sk-...',     requiresKey: true,  endpoint: 'https://api.deepseek.com/v1/chat/completions' },
    { id: 'xai',         label: 'xAI (Grok)',                defaultModel: 'grok-3-mini-fast',                         keyPlaceholder: 'xai-...',    requiresKey: true,  endpoint: 'https://api.x.ai/v1/chat/completions' },
    { id: 'together',    label: 'Together AI',               defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',  keyPlaceholder: 'API key',    requiresKey: true,  endpoint: 'https://api.together.xyz/v1/chat/completions' },
    { id: 'cerebras',    label: 'Cerebras',                  defaultModel: 'llama3.3-70b',                             keyPlaceholder: 'csk-...',    requiresKey: true,  endpoint: 'https://api.cerebras.ai/v1/chat/completions' },
    { id: 'perplexity',  label: 'Perplexity AI',             defaultModel: 'sonar',                                    keyPlaceholder: 'pplx-...',   requiresKey: true,  endpoint: 'https://api.perplexity.ai/chat/completions' },
    { id: 'openrouter',  label: 'OpenRouter',                defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',    keyPlaceholder: 'sk-or-...',  requiresKey: true,  endpoint: 'https://openrouter.ai/api/v1/chat/completions' },
    { id: 'ollama',      label: 'Ollama (local)',             defaultModel: 'llama3.2',                                 keyPlaceholder: 'none needed',requiresKey: false },
    { id: 'custom',      label: 'Custom (OpenAI-compatible)', defaultModel: '',                                         keyPlaceholder: 'API key',    requiresKey: false },
];

// ─── AES-256-GCM helpers ──────────────────────────────────────────────────────

function b64ToBuffer(b64: string): ArrayBuffer {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

function bufferToB64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function getOrCreateEncKey(): Promise<CryptoKey> {
    const stored = await chrome.storage.local.get('ai_enc_key');
    if (stored.ai_enc_key) {
        return crypto.subtle.importKey(
            'raw', b64ToBuffer(stored.ai_enc_key as string),
            { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
        );
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    await chrome.storage.local.set({ ai_enc_key: bufferToB64(raw) });
    return key;
}

export async function encryptApiKey(plaintext: string): Promise<string> {
    if (!plaintext) return '';
    const key = await getOrCreateEncKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
    );
    const out = new Uint8Array(12 + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), 12);
    return bufferToB64(out.buffer);
}

export async function decryptApiKey(encrypted: string): Promise<string> {
    if (!encrypted) return '';
    try {
        const key = await getOrCreateEncKey();
        const raw = new Uint8Array(b64ToBuffer(encrypted));
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)
        );
        return new TextDecoder().decode(plaintext);
    } catch {
        return '';
    }
}

// ─── Settings persistence ─────────────────────────────────────────────────────

export async function saveAISettings(settings: AISettings, apiKey?: string): Promise<void> {
    // Trim everything: a pasted key/URL/model often carries a trailing newline or
    // space. Validation already trims, so without this the stored value would
    // differ from the verified one — e.g. `Bearer <key>\n` → a 401 on real calls.
    await chrome.storage.sync.set({
        ai_mode: settings.mode,
        ai_provider: settings.cloud.provider,
        ai_model: settings.cloud.model.trim(),
        ai_custom_url: (settings.cloud.customUrl ?? '').trim(),
    });
    if (apiKey !== undefined) {
        const encrypted = await encryptApiKey(apiKey.trim());
        await chrome.storage.local.set({ ai_api_key_encrypted: encrypted });
    }
}

// Retired model names that were once our defaults — silently upgraded on read so
// existing users don't keep hitting "model no longer available" errors.
const RETIRED_MODELS: Record<string, string> = {
    'gemini-2.0-flash': 'gemini-2.5-flash',
    'gemini-1.5-flash': 'gemini-2.5-flash',
    'gemini-pro': 'gemini-2.5-flash',
};

export async function loadAISettings(): Promise<{ settings: AISettings; hasApiKey: boolean }> {
    const [sync, local] = await Promise.all([
        chrome.storage.sync.get(['ai_mode', 'ai_provider', 'ai_model', 'ai_custom_url', 'ai_custom_tags']),
        chrome.storage.local.get('ai_api_key_encrypted'),
    ]);
    const provider = (sync.ai_provider as AIProvider) ?? 'openai';
    let model = ((sync.ai_model as string) ?? PROVIDERS[0].defaultModel).trim();
    if (provider === 'gemini' && RETIRED_MODELS[model]) model = RETIRED_MODELS[model];
    const customUrl = ((sync.ai_custom_url as string) ?? '').trim();
    return {
        settings: {
            mode: (sync.ai_mode as AIMode) ?? 'builtin',
            cloud: {
                provider,
                model,
                customUrl: customUrl || undefined,
            },
            customTags: parseCustomTags((sync.ai_custom_tags as string) ?? ''),
        },
        hasApiKey: !!(local.ai_api_key_encrypted),
    };
}

export async function getDecryptedApiKey(): Promise<string> {
    const { ai_api_key_encrypted } = await chrome.storage.local.get('ai_api_key_encrypted');
    // Trim on read too, so keys saved before the trim-on-save fix still work.
    return (await decryptApiKey((ai_api_key_encrypted as string) ?? '')).trim();
}
