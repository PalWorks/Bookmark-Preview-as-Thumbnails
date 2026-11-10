// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupManager } from '../src/lib/backup_manager';
import type { BackupData } from '../src/lib/backup_manager';
import { localStore, syncStore } from './setup';

describe('BackupManager', () => {
    let manager: BackupManager;

    beforeEach(() => {
        manager = new BackupManager();
    });

    // ─── createBackup ──────────────────────────────────────────────────────────

    describe('createBackup()', () => {
        it('returns a Blob with application/json content type', async () => {
            const blob = await manager.createBackup();
            expect(blob).toBeInstanceOf(Blob);
            expect(blob.type).toBe('application/json');
        });

        it('produces valid JSON', async () => {
            const blob = await manager.createBackup();
            const text = await blob.text();
            expect(() => JSON.parse(text)).not.toThrow();
        });

        it('output includes version, timestamp, settings, and thumbnails fields', async () => {
            syncStore['theme'] = 'dark';
            const blob = await manager.createBackup();
            const data: BackupData = JSON.parse(await blob.text());
            expect(data.version).toBe(1);
            expect(typeof data.timestamp).toBe('number');
            expect(data.settings).toBeDefined();
            expect(Array.isArray(data.thumbnails)).toBe(true);
        });

        it('settings are exported from chrome.storage.sync', async () => {
            syncStore['theme'] = 'dark';
            syncStore['captureDelay'] = 1000;
            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.settings['theme']).toBe('dark');
            expect(data.settings['captureDelay']).toBe(1000);
        });

        it('includes thumbnails stored under thumb_ prefix', async () => {
            localStore['thumb_https://example.com'] = {
                id: 'https://example.com',
                url: 'https://example.com',
                mime: 'image/webp',
                updatedAt: 1000,
                width: 600,
                height: 400,
                sizeBytes: 10,
                base64: 'data:image/webp;base64,ZmFrZQ==',
            };
            localStore['meta_https://example.com'] = { id: 'noise-meta' };
            localStore['hasSeenWelcome'] = true;

            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails!).toHaveLength(1);
            expect(data.thumbnails![0].id).toBe('https://example.com');
            expect(data.thumbnails![0].url).toBe('https://example.com');
        });

        it('exports raw base64 without double base64↔blob conversion', async () => {
            const storedBase64 = 'data:image/webp;base64,ZmFrZQ==';
            localStore['thumb_https://example.com'] = {
                id: 'https://example.com',
                url: 'https://example.com',
                mime: 'image/webp',
                updatedAt: 1000,
                width: 600,
                height: 400,
                sizeBytes: 10,
                base64: storedBase64,
            };

            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            // The image_data in backup equals the base64 field from storage — no round-trip
            expect(data.thumbnails![0].image_data).toBe(storedBase64);
        });

        it('handles chunked export: more than 25 thumbnails does not error', async () => {
            for (let i = 0; i < 60; i++) {
                localStore[`thumb_https://example.com/${i}`] = {
                    id: `https://example.com/${i}`,
                    url: `https://example.com/${i}`,
                    mime: 'image/webp',
                    updatedAt: 1000,
                    width: 600,
                    height: 400,
                    sizeBytes: 10,
                    base64: 'data:image/webp;base64,ZmFrZQ==',
                };
            }

            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails!).toHaveLength(60);
        });

        it('returns empty thumbnails array when there are none', async () => {
            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails!).toHaveLength(0);
        });

        it('populates title from meta_ record', async () => {
            localStore['thumb_https://example.com'] = {
                id: 'https://example.com', url: 'https://example.com',
                mime: 'image/webp', updatedAt: 1000, width: 600, height: 400, sizeBytes: 10,
                base64: 'data:image/webp;base64,ZmFrZQ==',
            };
            localStore['meta_https://example.com'] = {
                id: 'https://example.com', url: 'https://example.com',
                title: 'My Page', status: 'saved_indexeddb',
            };
            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails![0].title).toBe('My Page');
        });

        it('uses empty string when no meta_ record exists for a thumbnail', async () => {
            localStore['thumb_https://no-meta.example'] = {
                id: 'https://no-meta.example', url: 'https://no-meta.example',
                mime: 'image/webp', updatedAt: 1000, width: 600, height: 400, sizeBytes: 10,
                base64: 'data:image/webp;base64,ZmFrZQ==',
            };
            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails![0].title).toBe('');
        });
    });

    // ─── importBackup ─────────────────────────────────────────────────────────

    describe('importBackup()', () => {
        // jsdom's File doesn't expose .text(); use a duck-typed mock
        const makeBackupFile = (data: Partial<BackupData>): File => {
            const json = JSON.stringify({
                version: 1,
                timestamp: Date.now(),
                settings: {},
                thumbnails: [],
                ...data,
            });
            return { text: async () => json } as unknown as File;
        };

        it('restores settings to chrome.storage.sync', async () => {
            const file = makeBackupFile({ settings: { theme: 'dark', captureDelay: 750 } });
            await manager.importBackup(file);
            expect(syncStore['theme']).toBe('dark');
            expect(syncStore['captureDelay']).toBe(750);
        });

        it('returns the count of imported thumbnails', async () => {
            const file = makeBackupFile({
                thumbnails: [
                    { id: 'https://a.example', url: 'https://a.example', title: '', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                    { id: 'https://b.example', url: 'https://b.example', title: '', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                ],
            });
            const result = await manager.importBackup(file);
            expect(result.count).toBe(2);
            expect(result.success).toBe(true);
        });

        it('skips records with a non-string or empty id (hardening against malformed backups)', async () => {
            const file = makeBackupFile({
                thumbnails: [
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    { url: 'https://noid.example', title: '' } as any,                       // missing id
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    { id: 123, url: 'https://numid.example' } as any,                          // non-string id
                    { id: 'https://ok.example', url: 'https://ok.example', title: '', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                ],
            });
            const result = await manager.importBackup(file);
            expect(result.count).toBe(1);
            expect(localStore['thumb_undefined']).toBeUndefined();
        });

        it('does NOT fetch a non-data: image_data URL (no SSRF-style fetch from a hostile backup)', async () => {
            // The test fetch mock throws on any non-data: URL; if the code tried to
            // fetch it the import would reject. It must skip the fetch and still import metadata.
            const file = makeBackupFile({
                thumbnails: [
                    { id: 'https://evil.example', url: 'https://evil.example', title: '', image_data: 'https://attacker.example/internal' },
                ],
            });
            const result = await manager.importBackup(file);
            expect(result.success).toBe(true);
            expect(result.count).toBe(1);
            // Stored as metadata-only (no blob), proving the remote URL was never fetched.
            const rec = localStore['thumb_https://evil.example'] as { base64?: string } | undefined;
            expect(rec?.base64).toBeFalsy();
        });

        it('keeps existing AI tags when importing a record for the same URL (1.2.1 regression)', async () => {
            localStore['meta_https://tagged.example'] = {
                id: 'https://tagged.example', url: 'https://tagged.example', title: 'Old', status: 'none', tags: ['Dev'],
            };
            const file = makeBackupFile({
                thumbnails: [
                    { id: 'https://tagged.example', url: 'https://tagged.example', title: 'New', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                ],
            });
            await manager.importBackup(file);
            expect(localStore['meta_https://tagged.example']).toMatchObject({ title: 'New', tags: ['Dev'] });
        });

        it('stores imported thumbnails under thumb_ prefix in storage', async () => {
            const file = makeBackupFile({
                thumbnails: [
                    { id: 'https://example.com', url: 'https://example.com', title: '', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                ],
            });
            await manager.importBackup(file);
            expect(localStore['thumb_https://example.com']).toBeDefined();
        });

        it('skips thumbnails that already exist with a blob', async () => {
            // Pre-populate with an existing thumb that has base64 (i.e. has a blob)
            localStore['thumb_https://existing.example'] = {
                id: 'https://existing.example',
                url: 'https://existing.example',
                mime: 'image/webp',
                updatedAt: 1000,
                width: 600,
                height: 400,
                sizeBytes: 10,
                base64: 'data:image/webp;base64,ZXhpc3Rpbmc=', // existing data
            };

            const file = makeBackupFile({
                thumbnails: [
                    {
                        id: 'https://existing.example',
                        url: 'https://existing.example',
                        title: '',
                        image_data: 'data:image/webp;base64,bmV3',
                    },
                ],
            });
            const result = await manager.importBackup(file);
            // Existing record with blob should NOT be overwritten
            expect(result.count).toBe(0);
            const stored = localStore['thumb_https://existing.example'] as Record<string, unknown>;
            expect(stored.base64).toBe('data:image/webp;base64,ZXhpc3Rpbmc='); // unchanged
        });

        it('overwrites metadata-only record when import provides a blob', async () => {
            // Pre-populate with a metadata-only record (no base64)
            localStore['thumb_https://meta-only.example'] = {
                id: 'https://meta-only.example',
                url: 'https://meta-only.example',
                mime: 'image/webp',
                updatedAt: 1000,
                width: 0,
                height: 0,
                sizeBytes: 0,
                // no base64 → getThumbnail returns record with blob: undefined
            };

            const file = makeBackupFile({
                thumbnails: [
                    {
                        id: 'https://meta-only.example',
                        url: 'https://meta-only.example',
                        title: '',
                        image_data: 'data:image/webp;base64,bmV3',
                    },
                ],
            });
            const result = await manager.importBackup(file);
            expect(result.count).toBe(1);
        });

        it('restores a meta_ record so the index can see imported thumbnails', async () => {
            const file = makeBackupFile({
                thumbnails: [
                    { id: 'https://a.example', url: 'https://a.example', title: 'A Page', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                ],
            });
            await manager.importBackup(file);

            const meta = localStore['meta_https://a.example'] as Record<string, unknown> | undefined;
            expect(meta).toBeDefined();
            expect(meta!.title).toBe('A Page');
            // With a blob present and no explicit status, defaults to saved_indexeddb
            expect(meta!.status).toBe('saved_indexeddb');
        });

        it('preserves an exported error status on import (Regenerate Failed support)', async () => {
            const file = makeBackupFile({
                thumbnails: [
                    { id: 'https://err.example', url: 'https://err.example', title: 'Broken', status: 'error', image_data: 'data:image/webp;base64,ZmFrZQ==' },
                ],
            });
            await manager.importBackup(file);

            const meta = localStore['meta_https://err.example'] as Record<string, unknown> | undefined;
            expect(meta).toBeDefined();
            expect(meta!.status).toBe('error');
        });

        it('round-trips status through export then import', async () => {
            localStore['thumb_https://x.example'] = {
                id: 'https://x.example', url: 'https://x.example',
                mime: 'image/webp', updatedAt: 1000, width: 600, height: 400, sizeBytes: 10,
                base64: 'data:image/webp;base64,ZmFrZQ==',
            };
            localStore['meta_https://x.example'] = {
                id: 'https://x.example', url: 'https://x.example',
                title: 'X', status: 'error',
            };

            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails![0].status).toBe('error');
        });

        it('throws on invalid JSON', async () => {
            const file = { text: async () => 'not-valid-json' } as unknown as File;
            await expect(manager.importBackup(file)).rejects.toThrow();
        });

        it('accepts backup with version: 0 (legacy pre-versioning)', async () => {
            const json = JSON.stringify({
                version: 0, timestamp: Date.now(), settings: {}, thumbnails: [],
            });
            const file = { text: async () => json } as unknown as File;
            const result = await manager.importBackup(file);
            expect(result.success).toBe(true);
        });

        it('accepts backup with missing version field', async () => {
            const json = JSON.stringify({
                timestamp: Date.now(), settings: {}, thumbnails: [],
            });
            const file = { text: async () => json } as unknown as File;
            const result = await manager.importBackup(file);
            expect(result.success).toBe(true);
        });

        it('throws for backup version > 1', async () => {
            const json = JSON.stringify({
                version: 2, timestamp: Date.now(), settings: {}, thumbnails: [],
            });
            const file = { text: async () => json } as unknown as File;
            await expect(manager.importBackup(file)).rejects.toThrow('Unsupported backup version');
        });
    });

    describe('settings allowlist (1.3.0)', () => {
        const fileOf = (data: unknown) => new File([JSON.stringify(data)], 'b.json', { type: 'application/json' });

        it('settings-only export has the allowlisted settings and never a key', async () => {
            Object.assign(syncStore, {
                theme: 'dark', captureDelay: 900, sidebarHidden: true, ai_mode: 'cloud', ai_provider: 'openai',
                ai_model: 'gpt-4o-mini', ai_custom_tags: 'Dev, News', somethingElse: 'x',
            });
            localStore.ai_enc_key = 'SECRET_ENC';
            localStore.ai_api_key_encrypted = 'SECRET_CIPHER';
            localStore['thumb_https://a.example'] = { id: 'https://a.example', url: 'https://a.example', base64: 'data:image/webp;base64,QQ==' };
            const blob = await manager.createSettingsBackup();
            const text = await blob.text();
            const data = JSON.parse(text);
            expect(data).toMatchObject({ version: 1, kind: 'settings' });
            expect(data.thumbnails!).toBeUndefined();
            expect(data.settings).toEqual({
                theme: 'dark', captureDelay: 900, sidebarHidden: true, ai_mode: 'cloud', ai_provider: 'openai',
                ai_model: 'gpt-4o-mini', ai_custom_tags: 'Dev, News',
            });
            expect(text).not.toContain('SECRET');
            expect(text).not.toContain('base64');
        });

        it('full backup settings use the same allowlist', async () => {
            Object.assign(syncStore, { theme: 'light', unknownKey: 1 });
            const data = JSON.parse(await (await manager.createBackup()).text());
            expect(data.kind).toBe('full');
            expect(data.settings).toEqual({ theme: 'light' });
        });

        it('a tampered file: unknown keys and wrong types are ignored and counted', async () => {
            const r = await manager.importBackup(fileOf({
                version: 1, kind: 'settings', settings: {
                    theme: 'neon', captureDelay: '500', useIncognito: 'yes', sidebarHidden: false,
                    // Built at runtime so the fixture is not mistaken for a real credential.
                    ai_custom_url: `https://${'user'}:${'secret'}@evil.example/v1`, evil: true, ai_mode: 'cloud',
                },
            }));
            // ai_mode is valid but held: a file never decides where AI requests go (F4).
            expect(r).toMatchObject({ success: true, kind: 'settings', settingsSkipped: 5, aiProviderHeld: true });
            expect(syncStore).toEqual({ sidebarHidden: false });
        });

        it('rejects an endpoint with a query string, accepts a clean one', async () => {
            await manager.importBackup(fileOf({ settings: { ai_custom_url: 'https://llm.example/v1?key=abc' } }));
            expect(syncStore.ai_custom_url).toBeUndefined();
            const r = await manager.importBackup(fileOf({ settings: { ai_custom_url: 'https://llm.example/v1/chat/completions' } }));
            // Valid, but where AI requests go is never taken from a file.
            expect(r.aiProviderHeld).toBe(true);
            expect(syncStore.ai_custom_url).toBeUndefined();
        });

        it('never changes the AI provider or endpoint while an API key is saved', async () => {
            localStore.ai_api_key_encrypted = 'CIPHER';
            Object.assign(syncStore, { ai_provider: 'openai' });
            const r = await manager.importBackup(fileOf({
                settings: { ai_provider: 'custom', ai_custom_url: 'https://attacker.example/v1', theme: 'dark' },
            }));
            expect(r.aiProviderHeld).toBe(true);
            expect(syncStore.ai_provider).toBe('openai');
            expect(syncStore.ai_custom_url).toBeUndefined();
            expect(syncStore.theme).toBe('dark');
        });

        it('never applies the AI mode, provider or server from a file, even with no key saved (F4)', async () => {
            const r = await manager.importBackup(fileOf({ settings: { ai_mode: 'cloud', ai_provider: 'custom', ai_custom_url: 'https://attacker.example/v1', theme: 'dark' } }));
            expect(r.aiProviderHeld).toBe(true);
            expect(syncStore.ai_mode).toBeUndefined();
            expect(syncStore.ai_provider).toBeUndefined();
            expect(syncStore.ai_custom_url).toBeUndefined();
            expect(syncStore.theme).toBe('dark');
            // The same values as now are not reported.
            Object.assign(syncStore, { ai_provider: 'groq' });
            expect((await manager.importBackup(fileOf({ settings: { ai_provider: 'groq' } }))).aiProviderHeld).toBe(false);
        });

        it('a JSON file that is not a backup is refused with a clear message', async () => {
            await expect(manager.importBackup(fileOf([1, 2, 3]))).rejects.toThrow("That file isn't a backup from this extension.");
            await expect(manager.importBackup(fileOf({ hello: 'world' }))).rejects.toThrow("isn't a backup");
        });

        it('a settings file never imports thumbnails', async () => {
            const r = await manager.importBackup(fileOf({
                kind: 'settings', settings: {},
                thumbnails: [{ id: 'https://x.example', url: 'https://x.example', image_data: 'data:image/webp;base64,QQ==' }],
            }));
            expect(r.count).toBe(0);
            expect(localStore['thumb_https://x.example']).toBeUndefined();
        });
    });
});

describe('BackupManager 1.4.0: metadata and folder prefs', () => {
    it('exports ratings for links without previews, keyed by bookmark URL, and folder prefs by path', async () => {
        const { localStore } = await import('./setup');
        const { fakeBookmarks } = await import('./fakes/chrome_bookmarks');
        const { backupManager } = await import('../src/lib/backup_manager');
        const f = fakeBookmarks.seed('1', 'Work');
        localStore[`fpref_${f.id}`] = { color: 'red' };
        localStore['meta_https://a.example/'] = { id: 'https://a.example/', url: 'https://redirected.example/', title: 'A', status: 'none', rating: 4 };
        const blob = await backupManager.createBackup();
        const data = JSON.parse(await blob.text());
        expect(data.metadata).toEqual([{ url: 'https://a.example/', rating: 4 }]);
        expect(data.folderPrefs).toEqual([{ path: ['Bookmarks bar', 'Work'], color: 'red' }]);
        const settings = JSON.parse(await (await backupManager.createSettingsBackup()).text());
        expect(settings.folderPrefs).toEqual([{ path: ['Bookmarks bar', 'Work'], color: 'red' }]);
    });

    it('imports metadata without overwriting newer local choices, and hostile values are dropped', async () => {
        const { localStore } = await import('./setup');
        const { backupManager } = await import('../src/lib/backup_manager');
        localStore['meta_https://kept.example/'] = { id: 'https://kept.example/', url: 'https://kept.example/', title: '', status: 'none', rating: 2, lastOpenedAt: 500 };
        const file = new File([JSON.stringify({
            version: 1, kind: 'full', settings: {}, thumbnails: [],
            metadata: [
                { url: 'https://kept.example/', rating: 5, lastOpenedAt: 900 },
                { url: 'https://new.example/', rating: 3, tags: ['x'] },
                { url: 'https://bad.example/', rating: 'lots', status: 'error' },
                { url: 'x'.repeat(5000), rating: 1 },
            ],
        })], 'b.json');
        const r = await backupManager.importBackup(file);
        expect(r.metadataApplied).toBe(2);
        expect(localStore['meta_https://kept.example/']).toMatchObject({ rating: 2, lastOpenedAt: 900 });
        expect(localStore['meta_https://new.example/']).toMatchObject({ rating: 3, tags: ['x'] });
        expect(localStore['meta_https://bad.example/']).toBeUndefined();
    });

    it('imports folder prefs only for a unique exact path; bad items are skipped', async () => {
        const { fakeBookmarks } = await import('./fakes/chrome_bookmarks');
        const { backupManager } = await import('../src/lib/backup_manager');
        const work = fakeBookmarks.seed('1', 'Work');
        fakeBookmarks.seed('1', 'Twin');
        fakeBookmarks.seed('1', 'Twin');
        const send = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (m: { type: string; ids: string[] }) => (m.type === 'FOLDER_PREFS_SET' ? { ok: true, changed: m.ids } : undefined));
        const file = new File([JSON.stringify({
            version: 1, kind: 'settings', settings: {},
            folderPrefs: [
                { path: ['Bookmarks bar', 'Work'], color: 'teal', hideFromSearch: true },
                { path: ['Bookmarks bar', 'Twin'], color: 'red' },
                { path: ['Bookmarks bar', 'Missing'], color: 'red' },
                { path: 'not-a-path', color: 'red' },
                { path: ['Bookmarks bar', 'Work'], color: 'magenta' },
            ],
        })], 's.json');
        const r = await backupManager.importBackup(file);
        expect(r.folderPrefsApplied).toBe(1);
        expect(r.folderPrefsSkipped).toBe(4);
        expect(send).toHaveBeenCalledWith({ type: 'FOLDER_PREFS_SET', ids: [work.id], patch: { color: 'teal', hideFromSearch: true } });
    });

    it('listColumns and trashExternal are allowlisted settings', async () => {
        const { sanitizeSettings } = await import('../src/lib/backup_manager');
        expect(sanitizeSettings({ listColumns: ['added', 'evil', 'added', 'visits'], trashExternal: false }).settings)
            .toEqual({ listColumns: ['added', 'visits'], trashExternal: false });
        expect(sanitizeSettings({ trashExternal: 'yes' }).skipped).toEqual(['trashExternal']);
    });
});

describe('BackupManager 1.4.0: import never overwrites a rating saved meanwhile', () => {
    it('decides against the stored record at write time', async () => {
        const { localStore } = await import('./setup');
        const { backupManager } = await import('../src/lib/backup_manager');
        const send = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
        // Another tab saves rating 5 just before the import's write lands (no worker: local path).
        send.mockImplementation(async (m: { type: string }) => {
            if (m.type === 'META_PATCH') localStore['meta_https://race.example/'] = { id: 'https://race.example/', url: 'https://race.example/', title: '', status: 'none', rating: 5 };
            return undefined;
        });
        const file = new File([JSON.stringify({ version: 1, kind: 'full', settings: {}, thumbnails: [], metadata: [{ url: 'https://race.example/', rating: 2 }] })], 'b.json');
        await backupManager.importBackup(file);
        expect((localStore['meta_https://race.example/'] as { rating: number }).rating).toBe(5);
    });
});
