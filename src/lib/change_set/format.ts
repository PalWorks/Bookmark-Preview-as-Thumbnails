// SPDX-License-Identifier: AGPL-3.0-only
//
// The change-set format: what an AI (pasted, from a file, or later through the
// coding-agent bridge) proposes. One format, one parser and one validator serve
// every source (DECISIONS D18). DOM-free; the worker and the page both import it.

export const CHANGES_FORMAT = 'bookmarks-thumbnails.changes';
export const SNAPSHOT_FORMAT = 'bookmarks-thumbnails.snapshot';
export const FORMAT_VERSION = 1;

/** Limits (docs/designs/agent-bridge.md, Stage 1.3). */
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_OPS = 200;
export const MAX_IMPACT_NODES = 1000;
export const MAX_PENDING_SETS = 10;
export const MAX_TITLE = 255;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type ChangeOp =
    | { op: 'create_folder'; tempId: string; parentId: string; title: string }
    | { op: 'move'; id: string; parentId: string; index?: number }
    | { op: 'rename'; id: string; title: string }
    | { op: 'set_tags'; id: string; tags: string[] }
    | { op: 'set_rating'; id: string; rating: number | null }
    | { op: 'trash'; id: string };

export type OpKind = ChangeOp['op'];

/** Every kind the format knows, in apply order. */
export const APPLY_ORDER: OpKind[] = ['create_folder', 'move', 'rename', 'set_tags', 'set_rating', 'trash'];

export interface ChangeSetInput {
    format: typeof CHANGES_FORMAT;
    v: number;
    snapshotId?: string;
    title?: string;
    ops: ChangeOp[];
}

export type ParseResult =
    | { ok: true; set: ChangeSetInput }
    | { ok: false; error: string };

const TEMP_ID = /^new:[1-9]\d{0,3}$/;
export const isTempId = (s: string) => TEMP_ID.test(s);

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** Remove control and bidi-override characters an AI or a paste might carry. */
export function cleanText(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}

/**
 * AIs often wrap JSON in a Markdown code fence or add a sentence before it. Take
 * the outermost JSON object in the text.
 */
export function extractJson(text: string): string | undefined {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const body = fenced ? fenced[1] : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    return body.slice(start, end + 1);
}

function parseOp(raw: unknown): ChangeOp | string {
    if (!raw || typeof raw !== 'object') return 'Each change must be an object.';
    const o = raw as Record<string, unknown>;
    switch (o.op) {
        case 'create_folder':
            if (typeof o.tempId !== 'string' || !isTempId(o.tempId)) return 'create_folder needs a tempId such as "new:1".';
            if (!isId(o.parentId)) return 'create_folder needs a parentId.';
            if (typeof o.title !== 'string') return 'create_folder needs a title.';
            return { op: 'create_folder', tempId: o.tempId, parentId: o.parentId, title: cleanText(o.title) };
        case 'move': {
            if (!isId(o.id) || !isId(o.parentId)) return 'move needs an id and a parentId.';
            const op: ChangeOp = { op: 'move', id: o.id, parentId: o.parentId };
            if (o.index !== undefined && o.index !== null) {
                if (typeof o.index !== 'number' || !Number.isInteger(o.index) || o.index < 0) return 'move index must be a whole number, 0 or more.';
                op.index = o.index;
            }
            return op;
        }
        case 'rename':
            if (!isId(o.id) || typeof o.title !== 'string') return 'rename needs an id and a title.';
            return { op: 'rename', id: o.id, title: cleanText(o.title) };
        case 'set_tags':
            if (!isId(o.id) || !Array.isArray(o.tags) || !o.tags.every(t => typeof t === 'string')) return 'set_tags needs an id and a list of tags.';
            return { op: 'set_tags', id: o.id, tags: (o.tags as string[]).map(cleanText) };
        case 'set_rating':
            if (!isId(o.id)) return 'set_rating needs an id.';
            if (o.rating !== null && (typeof o.rating !== 'number' || !Number.isInteger(o.rating))) return 'set_rating needs a rating from 1 to 5, or null to clear it.';
            return { op: 'set_rating', id: o.id, rating: o.rating as number | null };
        case 'trash':
            if (!isId(o.id)) return 'trash needs an id.';
            return { op: 'trash', id: o.id };
        default:
            return `Unknown change "${String(o.op).slice(0, 40)}". Use create_folder, move, rename, set_tags, set_rating or trash.`;
    }
}

/** Parse pasted or file text into a change set. Shape only; the worker validates against the tree. */
export function parseChangeSet(text: string): ParseResult {
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return { ok: false, error: 'That is more than 1 MB. Ask the AI for a smaller set of changes.' };
    const json = extractJson(text);
    if (!json) return { ok: false, error: "No changes found. Paste the AI's whole answer, including the part in curly brackets { }." };
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return { ok: false, error: "The AI's answer is not valid JSON. Ask it to answer with the JSON only." };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Expected one JSON object with an "ops" list.' };
    const o = raw as Record<string, unknown>;
    if (o.format !== undefined && o.format !== CHANGES_FORMAT) return { ok: false, error: `This is not a change set (format "${String(o.format).slice(0, 60)}").` };
    if (o.v !== undefined && o.v !== FORMAT_VERSION) return { ok: false, error: `Unsupported version ${String(o.v).slice(0, 10)}. Update the extension.` };
    if (!Array.isArray(o.ops) || o.ops.length === 0) return { ok: false, error: 'The change set has no "ops" list, or it is empty.' };
    if (o.ops.length > MAX_OPS) return { ok: false, error: `${o.ops.length} changes is too many; the limit is ${MAX_OPS}. Ask the AI to split them.` };
    const ops: ChangeOp[] = [];
    for (let i = 0; i < o.ops.length; i++) {
        const op = parseOp(o.ops[i]);
        if (typeof op === 'string') return { ok: false, error: `Change ${i + 1}: ${op}` };
        ops.push(op);
    }
    const set: ChangeSetInput = { format: CHANGES_FORMAT, v: FORMAT_VERSION, ops };
    if (typeof o.snapshotId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(o.snapshotId)) set.snapshotId = o.snapshotId;
    if (typeof o.title === 'string' && cleanText(o.title)) set.title = cleanText(o.title).slice(0, 120);
    return { ok: true, set };
}

export function opTargetId(op: ChangeOp): string {
    return op.op === 'create_folder' ? op.tempId : op.id;
}
