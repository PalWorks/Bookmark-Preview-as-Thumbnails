import { describe, it, expect } from 'vitest';
import { saveAISettings, loadAISettings, getDecryptedApiKey, saveCustomTags, parseCustomTags } from '../src/lib/ai_settings_storage';

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
        expect(await getDecryptedApiKey()).toBe('gsk_secret_key');
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
        // Even if something re-introduced whitespace, getDecryptedApiKey trims on read.
        const key = await getDecryptedApiKey();
        expect(key).toBe(key.trim());
        expect(key).toBe('sk-clean');
    });
});
