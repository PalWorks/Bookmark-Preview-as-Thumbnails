// SPDX-License-Identifier: AGPL-3.0-only
//
// Storage schema migration, kept free of import side effects so it can be unit
// tested without loading the service worker.
//
// History: up to 1.2.0 the update handler renamed EVERY chrome.storage.local key
// that was not thumb_*, meta_* or hasSeenWelcome to meta_<key>. That was meant for
// legacy metadata records stored under their raw URL, but it also caught keys added
// later (ai_enc_key, ai_api_key_encrypted), so the first update after AI settings
// shipped would have destroyed users' saved API keys. Schema version 2 gates the
// legacy rename behind a marker and a shape check.

export const SCHEMA_KEY = 'storage_schema_version';
export const CURRENT_SCHEMA = 2;

// Keys that must never be renamed and that an older build may have mis-migrated.
const PROTECTED_LOCAL_KEYS = ['ai_enc_key', 'ai_api_key_encrypted', 'ai_api_key_binding'] as const;

interface LegacyMetaShape {
    id: string;
    url: string;
    status: string;
}

/**
 * A legacy metadata record is stored under its own id (the original bookmark URL)
 * as key. `url` may differ from the id: older builds stored the captured tab's URL
 * after redirects.
 */
export function isLegacyMetaRecord(key: string, value: unknown): value is LegacyMetaShape {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Partial<LegacyMetaShape>;
    return v.id === key && typeof v.url === 'string' && typeof v.status === 'string';
}

/**
 * Rename legacy raw-URL metadata keys to meta_<url>, once. Only records with the
 * legacy shape are touched; every other key is left alone. Sets the schema marker.
 * Returns the number of migrated keys.
 */
export async function migrateStorageSchema(): Promise<number> {
    const marker = await chrome.storage.local.get(SCHEMA_KEY);
    if (typeof marker[SCHEMA_KEY] === 'number' && (marker[SCHEMA_KEY] as number) >= CURRENT_SCHEMA) {
        return 0;
    }
    const all = await chrome.storage.local.get(null);
    const toSet: Record<string, unknown> = {};
    const toRemove: string[] = [];
    for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('thumb_') || k.startsWith('meta_')) continue;
        if (!isLegacyMetaRecord(k, v)) continue;
        toSet[`meta_${k}`] = v;
        toRemove.push(k);
    }
    if (toRemove.length > 0) {
        await chrome.storage.local.set(toSet);
        await chrome.storage.local.remove(toRemove);
    }
    await chrome.storage.local.set({ [SCHEMA_KEY]: CURRENT_SCHEMA });
    return toRemove.length;
}

/** Fresh installs have no legacy data: just record the current schema. */
export async function markFreshInstall(): Promise<void> {
    await chrome.storage.local.set({ [SCHEMA_KEY]: CURRENT_SCHEMA });
}

/**
 * Undo the pre-1.2.1 blanket rename for protected keys (meta_ai_enc_key back to
 * ai_enc_key, and so on). Cheap: reads only the few keys involved. Safe to run on
 * every service worker start. Returns the keys repaired.
 */
export async function repairMisMigratedKeys(): Promise<string[]> {
    const wanted = PROTECTED_LOCAL_KEYS.flatMap(k => [k, `meta_${k}`]);
    const found = await chrome.storage.local.get(wanted);
    const repaired: string[] = [];
    for (const k of PROTECTED_LOCAL_KEYS) {
        const misplaced = found[`meta_${k}`];
        if (misplaced === undefined) continue;
        if (found[k] === undefined) {
            await chrome.storage.local.set({ [k]: misplaced });
            repaired.push(k);
        }
        await chrome.storage.local.remove(`meta_${k}`);
    }
    return repaired;
}
