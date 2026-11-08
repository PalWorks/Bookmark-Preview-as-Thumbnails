// SPDX-License-Identifier: AGPL-3.0-only
//
// Popup-side metadata writes. The service worker owns the per-URL write queue in
// StorageIndex.patch(), so popup writes go through it as META_PATCH messages and
// cannot interleave with a capture or auto-tag write for the same URL.

import { storageIndex, type MetadataRecord } from './storage_index';

export async function patchMetadata(
    id: string,
    update: Partial<Omit<MetadataRecord, 'id'>>,
    titleIfNew?: string,
): Promise<void> {
    const defaultsIfNew = titleIfNew !== undefined ? { title: titleIfNew } : {};
    let res: unknown;
    try {
        res = await chrome.runtime.sendMessage({ type: 'META_PATCH', id, update, titleIfNew });
    } catch (err) {
        // Service worker unreachable: fall back to a local patch (still a merge, so
        // no fields are dropped), and say so in the console for debugging.
        console.warn('[Metadata] Service worker unreachable for META_PATCH, patching locally:', err);
        await storageIndex.patch(id, update, defaultsIfNew);
        return;
    }
    if (res === undefined) {
        // No listener answered (for example in tests or during worker start-up).
        await storageIndex.patch(id, update, defaultsIfNew);
        return;
    }
    if (typeof res === 'object' && res !== null && 'ok' in res && (res as { ok: boolean }).ok) return;
    // The worker answered with an error: surface it instead of writing behind its back.
    const error = typeof res === 'object' && res !== null && 'error' in res ? String((res as { error: unknown }).error) : 'META_PATCH failed';
    throw new Error(error);
}
