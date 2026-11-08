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
    try {
        const res = await chrome.runtime.sendMessage({ type: 'META_PATCH', id, update, titleIfNew });
        if (res && typeof res === 'object' && 'ok' in res && (res as { ok: boolean }).ok) return;
        const error = res && typeof res === 'object' && 'error' in res ? String((res as { error: unknown }).error) : 'no response';
        throw new Error(error);
    } catch (err) {
        // Service worker unreachable: fall back to a local patch (still a merge, so
        // no fields are dropped), and say so in the console for debugging.
        console.warn('[Metadata] META_PATCH via service worker failed, patching locally:', err);
        const existing = await storageIndex.get(id);
        await storageIndex.patch(id, existing ? update : { title: titleIfNew ?? '', ...update });
    }
}
