import { describe, it, expect, beforeEach } from 'vitest';
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
            expect(data.thumbnails).toHaveLength(1);
            expect(data.thumbnails[0].id).toBe('https://example.com');
            expect(data.thumbnails[0].url).toBe('https://example.com');
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
            expect(data.thumbnails[0].image_data).toBe(storedBase64);
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
            expect(data.thumbnails).toHaveLength(60);
        });

        it('returns empty thumbnails array when there are none', async () => {
            const data: BackupData = JSON.parse(await (await manager.createBackup()).text());
            expect(data.thumbnails).toHaveLength(0);
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

        it('throws on invalid JSON', async () => {
            const file = { text: async () => 'not-valid-json' } as unknown as File;
            await expect(manager.importBackup(file)).rejects.toThrow();
        });
    });
});
