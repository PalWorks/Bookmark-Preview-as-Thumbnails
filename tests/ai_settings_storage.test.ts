import { describe, it, expect } from 'vitest';
import { saveAISettings, loadAISettings, getBoundApiKey as getBoundApiKeyForTrim, saveCustomTags, parseCustomTags } from '../src/lib/ai_settings_storage';

describe('parseCustomTags', () => {
    it('parses, trims, and de-duplicates a comma-separated list', () => {
        expect(parseCustomTags('Tamil Video, Tutorial , Crash Course')).toEqual(['Tamil Video', 'Tutorial', 'Crash Course']);
    });
    it('drops empties and case-insensitive duplicates', () => {
        expect(parseCustomTags(' Dev , , dev ,DEV ')).toEqual(['Dev']);
    });
    it('caps each tag length', () => {
        const long = 'x'.repeat(50);
        expect(parseCustomTags(long)[0]).toHaveLength(30);
    });
    it('returns empty for blank input', () => {
        expect(parseCustomTags('   ')).toEqual([]);
    });
});

describe('preferred tags persistence', () => {
    it('saves and reloads preferred tags via loadAISettings', async () => {
        await saveCustomTags(['Tamil Video', 'Crash Course']);
        const { settings } = await loadAISettings();
        expect(settings.customTags).toEqual(['Tamil Video', 'Crash Course']);
    });
});

// Regression: a pasted key/model/URL often carries a trailing newline or spaces.
// Validation trims, so the stored value must trim too — otherwise the SW sends
// `Bearer <key>\n` and the provider rejects a key the user just "verified".

describe('saveAISettings trimming', () => {
    it('trims a whitespace-padded API key end-to-end (save → decrypt)', async () => {
        await saveAISettings(
            { mode: 'cloud', cloud: { provider: 'groq', model: 'llama-3.3-70b-versatile' } },
            '  gsk_secret_key\n'
        );
        expect((await getBoundApiKeyForTrim('groq')).key).toBe('gsk_secret_key');
    });

    it('trims the model name and custom URL on save', async () => {
        await saveAISettings({
            mode: 'cloud',
            cloud: { provider: 'custom', model: '  my-model  ', customUrl: '  http://localhost:1234/v1  ' },
        });
        const { settings } = await loadAISettings();
        expect(settings.cloud.model).toBe('my-model');
        expect(settings.cloud.customUrl).toBe('http://localhost:1234/v1');
    });

    it('trims a legacy key that was stored un-trimmed (trim-on-read)', async () => {
        // Simulate an old save path by storing a key whose plaintext has whitespace.
        await saveAISettings(
            { mode: 'cloud', cloud: { provider: 'openai', model: 'gpt-4o-mini' } },
            'sk-clean'
        );
        // Even if something re-introduced whitespace, getBoundApiKey trims on read.
        const { key } = await getBoundApiKeyForTrim('openai');
        expect(key).toBe(key.trim());
        expect(key).toBe('sk-clean');
    });
});

// 1.2.1: the saved key is bound to the provider and endpoint it was entered for,
// so a changed provider or custom URL (sync, restored backup) cannot redirect it.
import { getBoundApiKey, apiKeyBinding, bindLegacyApiKey, encryptApiKey } from '../src/lib/ai_settings_storage';
import { localStore as boundLocal, syncStore as boundSync } from './setup';

describe('API key binding', () => {
    it('returns the key for the provider it was saved for', async () => {
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'groq', model: 'm' } }, 'gsk_1');
        expect(await getBoundApiKey('groq')).toEqual({ key: 'gsk_1', mismatch: false });
    });

    it('withholds the key when the provider changed', async () => {
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'groq', model: 'm' } }, 'gsk_1');
        expect(await getBoundApiKey('custom', 'https://attacker.example')).toEqual({ key: '', mismatch: true });
    });

    it('withholds the key when a custom endpoint origin changed', async () => {
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'custom', model: 'm', customUrl: 'https://llm.mine.example/v1' } }, 'k');
        expect((await getBoundApiKey('custom', 'https://llm.mine.example/v2')).key).toBe('k');
        expect(await getBoundApiKey('custom', 'https://evil.example/v1')).toEqual({ key: '', mismatch: true });
    });

    it('binding ignores path for custom endpoints and URL entirely for fixed providers', () => {
        expect(apiKeyBinding('custom', 'https://h.example/a/b')).toBe('custom|https://h.example');
        expect(apiKeyBinding('openai', 'https://ignored.example')).toBe('openai|');
        expect(apiKeyBinding('custom', 'not a url')).toBe('custom|invalid');
    });

    it('binds a legacy (unbound) key to the current settings once', async () => {
        boundLocal.ai_api_key_encrypted = await encryptApiKey('legacy_key');
        boundSync.ai_provider = 'openai';
        expect(await bindLegacyApiKey()).toBe(true);
        expect(boundLocal.ai_api_key_binding).toBe('openai|');
        expect(await bindLegacyApiKey()).toBe(false);
        expect((await getBoundApiKey('openai')).key).toBe('legacy_key');
        expect((await getBoundApiKey('anthropic')).mismatch).toBe(true);
    });

    it('accepts an unbound legacy key before binding runs', async () => {
        boundLocal.ai_api_key_encrypted = await encryptApiKey('legacy_key');
        expect(await getBoundApiKey('anthropic')).toEqual({ key: 'legacy_key', mismatch: false });
    });

    it('reports no mismatch when no key is saved', async () => {
        expect(await getBoundApiKey('openai')).toEqual({ key: '', mismatch: false });
    });
});

import { checkAIAvailability } from '../src/lib/ai_tagger';

describe('checkAIAvailability with a mismatched key binding', () => {
    it('reports unavailable when the saved key belongs to another provider', async () => {
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'groq', model: 'm' } }, 'gsk_1');
        boundSync.ai_provider = 'anthropic';
        expect(await checkAIAvailability()).toBe('unavailable');
    });
    it('reports available when the key matches', async () => {
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'groq', model: 'm' } }, 'gsk_1');
        expect(await checkAIAvailability()).toBe('available');
    });
});

describe('keyless providers with a mismatched key', () => {
    it('stay available for Ollama even if a key for another provider is saved', async () => {
        await saveAISettings({ mode: 'cloud', cloud: { provider: 'groq', model: 'm' } }, 'gsk_1');
        boundSync.ai_provider = 'ollama';
        boundSync.ai_custom_url = 'http://localhost:11434';
        expect(await checkAIAvailability()).toBe('available');
    });
});
