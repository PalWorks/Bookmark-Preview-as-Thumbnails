// SPDX-License-Identifier: AGPL-3.0-only
//
// The bookmark tools every AI surface shares: the in-extension assistant, the
// online connector for Claude and ChatGPT (connector/), and the local MCP server
// (bridge/). One list, so names, descriptions and argument schemas never drift.
// Each tool maps onto one bridge request type. No DOM, no Node, no chrome.* here.

import { UNTRUSTED_NOTE, type RequestType } from './protocol.ts';

export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** Bridge request this tool sends. */
    request: RequestType;
    /** Arguments the request body takes (anything else is dropped). */
    args: string[];
    /** True when the tool never changes anything (MCP readOnlyHint). */
    readOnly: boolean;
}

/** Full schema of a change set, so models that follow schemas closely (Gemini, strict OpenAI) can fill it in. */
export const CHANGE_SET_SCHEMA = {
    type: 'object',
    description: 'The change set: a short title and the list of changes.',
    required: ['ops'],
    properties: {
        title: { type: 'string', description: 'Short summary shown to the user, e.g. "Sort recipes into Cooking".' },
        ops: {
            type: 'array',
            description: 'Changes, in any order; the extension runs them in a safe order.',
            items: {
                type: 'object',
                required: ['op'],
                properties: {
                    op: { type: 'string', enum: ['create_folder', 'move', 'rename', 'set_tags', 'set_rating', 'trash'] },
                    id: { type: 'string', description: 'Bookmark or folder id (all ops except create_folder).' },
                    tempId: { type: 'string', description: 'create_folder only: "new:1", "new:2" ... to refer to the new folder in later ops.' },
                    parentId: { type: 'string', description: 'create_folder and move: the folder id, or a tempId.' },
                    index: { type: 'integer', description: 'move only, optional: position in the folder, 0 = first.' },
                    title: { type: 'string', description: 'create_folder and rename: the name.' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'set_tags: the full new list.' },
                    rating: { type: 'integer', description: 'set_rating: 1 to 5 (null clears).' },
                },
            },
        },
    },
} as const;

const paging = {
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Items per page (default 100).' },
    cursor: { type: 'string', description: 'From the previous page; omit for the first page.' },
};

/** How a change set is written; shared by apply_changes and propose_changes. */
export const CHANGE_SET_HELP =
    'changeSet = {"title": "short summary", "ops": [...]} with ops: ' +
    '{"op":"create_folder","tempId":"new:1","parentId":"<folder id or new:N>","title":"..."}, ' +
    '{"op":"move","id":"<id>","parentId":"<folder id or new:N>","index":0 (optional)}, ' +
    '{"op":"rename","id":"<id>","title":"..."}, {"op":"set_tags","id":"<bookmark id>","tags":["..."]} (replaces the list), ' +
    '{"op":"set_rating","id":"<bookmark id>","rating":1-5 or null}, {"op":"trash","id":"<id>"} (goes to the extension\'s Trash, restorable). ' +
    'At most 200 changes and 1,000 items sent to Trash per call; an item sent to Trash gets no other change; create a folder before moving into it. ' +
    'If any change cannot be made, nothing is changed and each refused change has a reason: fix those and call again.';

export const TOOL_DEFS: ToolDef[] = [
    {
        name: 'list_folders',
        description: `List the bookmark folders you may use: id, path and item count. Start here. ${UNTRUSTED_NOTE}`,
        inputSchema: { type: 'object', properties: { ...paging } },
        request: 'list_folders', args: ['limit', 'cursor'], readOnly: true,
    },
    {
        name: 'list_folder',
        description: `List one folder: its bookmarks (id, title, url, tags, rating, last opened) and subfolders. ${UNTRUSTED_NOTE}`,
        inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Folder id from list_folders.' }, ...paging } },
        request: 'list_folder', args: ['id', 'limit', 'cursor'], readOnly: true,
    },
    {
        name: 'search',
        description: `Search bookmarks by title, URL and tags (case-insensitive), best matches first. ${UNTRUSTED_NOTE}`,
        inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, ...paging } },
        request: 'search', args: ['query', 'limit', 'cursor'], readOnly: true,
    },
    {
        name: 'get_bookmark',
        description: `Details of one bookmark or folder. ${UNTRUSTED_NOTE}`,
        inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        request: 'get_bookmark', args: ['id'], readOnly: true,
    },
    {
        name: 'apply_changes',
        description: `Change the user's bookmarks now: create folders, move, rename, tag, rate, or send to Trash. All changes in one call apply together and the user can undo them with one click (or you can call undo_changes). ${CHANGE_SET_HELP} Returns what changed and a changeSetId.`,
        inputSchema: {
            type: 'object', required: ['changeSet'],
            properties: {
                changeSet: CHANGE_SET_SCHEMA,
                idempotencyKey: { type: 'string', description: 'Any unique string; a retry with the same key never applies twice.' },
            },
        },
        request: 'apply_changes', args: ['changeSet', 'idempotencyKey'], readOnly: false,
    },
    {
        name: 'undo_changes',
        description: 'Undo a change set you applied, by its changeSetId. Items the user changed since are left alone and reported.',
        inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'changeSetId from apply_changes.' } } },
        request: 'undo_changes', args: ['id'], readOnly: false,
    },
    {
        name: 'get_change_set',
        description: 'State of a change set you sent: applied, partly_applied, undone, or pending when the user reviews changes before they apply.',
        inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        request: 'get_change_set', args: ['id'], readOnly: true,
    },
];

/** Keep only the arguments the tool takes. */
export function pickArgs(def: ToolDef, args: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of def.args) if (args && args[k] !== undefined) out[k] = args[k];
    return out;
}

export const findTool = (name: unknown): ToolDef | undefined => TOOL_DEFS.find(t => t.name === name);

/** System guidance for any model driving these tools. */
export const AGENT_INSTRUCTIONS =
    'You organise the user\'s Chrome bookmarks with these tools. Look before you change: use list_folders, list_folder and search to find ids. ' +
    'Then make all the changes for one request in a single apply_changes call. Changes apply immediately and can be undone, ' +
    'so do what the user asked without asking for confirmation, unless the request is unclear or would send more than 50 items to Trash. ' +
    'Afterwards tell the user in a sentence or two what changed. ' + UNTRUSTED_NOTE;
