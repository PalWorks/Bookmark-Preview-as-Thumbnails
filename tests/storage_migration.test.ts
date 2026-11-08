// SPDX-License-Identifier: AGPL-3.0-only
// Regression (1.2.1): the pre-1.2.1 update migration renamed every unprefixed
// chrome.storage.local key, which would have destroyed saved AI keys on the first
// update after 1.2.0.
import { describe, it, expect } from 'vitest';
import {
    migrateStorageSchema, markFreshInstall, repairMisMigratedKeys, isLegacyMetaRecord,
    SCHEMA_KEY, CURRENT_SCHEMA,
} from '../src/lib/storage_migration';
import { localStore } from './setup';

const LEGACY_URL = 'https://legacy.example/page';
const legacyRecord = { id: LEGACY_URL, url: LEGACY_URL, title: 'Old', status: 'saved_indexeddb' };

function seed1_2_0Store(): void {
    localStore.ai_enc_key = 'ENC_KEY_B64';
    localStore.ai_api_key_encrypted = 'CIPHERTEXT_B64';
    localStore.hasSeenWelcome = true;
    localStore['thumb_https://a.example'] = { id: 'https://a.example', base64: 'x' };
    localStore['meta_https://a.example'] = { id: 'https://a.example', url: 'https://a.example', title: 'A', status: 'saved_indexeddb', tags: ['Dev'] };
    localStore[LEGACY_URL] = { ...legacyRecord };
}

describe('migrateStorageSchema', () => {
    it('leaves AI keys and other unprefixed keys untouched (regression)', async () => {
        seed1_2_0Store();
        await migrateStorageSchema();
        expect(localStore.ai_enc_key).toBe('ENC_KEY_B64');
        expect(localStore.ai_api_key_encrypted).toBe('CIPHERTEXT_B64');
        expect(localStore.hasSeenWelcome).toBe(true);
        expect(localStore.meta_ai_enc_key).toBeUndefined();
        expect(localStore.meta_ai_api_key_encrypted).toBeUndefined();
    });

    it('moves only legacy-shaped raw-URL metadata records and sets the marker', async () => {
        seed1_2_0Store();
        const moved = await migrateStorageSchema();
        expect(moved).toBe(1);
        expect(localStore[LEGACY_URL]).toBeUndefined();
        expect(localStore[`meta_${LEGACY_URL}`]).toEqual(legacyRecord);
        expect(localStore['meta_https://a.example']).toMatchObject({ tags: ['Dev'] });
        expect(localStore[SCHEMA_KEY]).toBe(CURRENT_SCHEMA);
    });

    it('is a no-op once the marker is set, even if a legacy-shaped key appears', async () => {
        localStore[SCHEMA_KEY] = CURRENT_SCHEMA;
        localStore[LEGACY_URL] = { ...legacyRecord };
        expect(await migrateStorageSchema()).toBe(0);
        expect(localStore[LEGACY_URL]).toEqual(legacyRecord);
    });

    it('does not move future keys such as trash entries', async () => {
        localStore.trash_v1_abc = { version: 1, entryId: 'abc', state: 'deleted' };
        await migrateStorageSchema();
        expect(localStore.trash_v1_abc).toBeDefined();
        expect(localStore.meta_trash_v1_abc).toBeUndefined();
    });

    it('runs on an empty store and only writes the marker', async () => {
        expect(await migrateStorageSchema()).toBe(0);
        expect(Object.keys(localStore)).toEqual([SCHEMA_KEY]);
    });
});

describe('isLegacyMetaRecord', () => {
    it('requires id === url === key and a string status', () => {
        expect(isLegacyMetaRecord(LEGACY_URL, legacyRecord)).toBe(true);
        expect(isLegacyMetaRecord('ai_enc_key', 'ENC_KEY_B64')).toBe(false);
        expect(isLegacyMetaRecord('x', { id: 'x', url: 'y', status: 'none' })).toBe(false);
        expect(isLegacyMetaRecord('x', { id: 'x', url: 'x' })).toBe(false);
        expect(isLegacyMetaRecord('x', null)).toBe(false);
    });
});

describe('markFreshInstall', () => {
    it('sets the schema marker so a later update never runs the legacy rename', async () => {
        await markFreshInstall();
        localStore[LEGACY_URL] = { ...legacyRecord };
        expect(await migrateStorageSchema()).toBe(0);
        expect(localStore[LEGACY_URL]).toEqual(legacyRecord);
    });
});

describe('repairMisMigratedKeys', () => {
    it('moves mis-migrated AI keys back', async () => {
        localStore.meta_ai_enc_key = 'ENC_KEY_B64';
        localStore.meta_ai_api_key_encrypted = 'CIPHERTEXT_B64';
        const repaired = await repairMisMigratedKeys();
        expect(repaired.sort()).toEqual(['ai_api_key_encrypted', 'ai_enc_key']);
        expect(localStore.ai_enc_key).toBe('ENC_KEY_B64');
        expect(localStore.ai_api_key_encrypted).toBe('CIPHERTEXT_B64');
        expect(localStore.meta_ai_enc_key).toBeUndefined();
    });

    it('keeps the current key when both copies exist and drops the stray one', async () => {
        localStore.ai_enc_key = 'CURRENT';
        localStore.meta_ai_enc_key = 'STALE';
        expect(await repairMisMigratedKeys()).toEqual([]);
        expect(localStore.ai_enc_key).toBe('CURRENT');
        expect(localStore.meta_ai_enc_key).toBeUndefined();
    });

    it('does nothing on a clean store', async () => {
        expect(await repairMisMigratedKeys()).toEqual([]);
        expect(Object.keys(localStore)).toEqual([]);
    });
});
