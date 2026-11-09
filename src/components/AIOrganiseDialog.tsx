// SPDX-License-Identifier: AGPL-3.0-only
//
// "Organise with an AI": step 1 shares chosen folders with any AI (copy or file),
// step 2 takes its answer back (paste or file) and hands it to the worker for
// review. Nothing changes here; changes happen only from the AI changes view.

import React, { useMemo, useRef, useState } from 'react';
import { Copy, Download, FileUp } from 'lucide-react';
import { Modal } from './Modal';
import { buildSnapshot, instructionsFor } from '../lib/change_set/snapshot';
import type { ChangeOp } from '../lib/change_set/format';
import type { OpVerdict } from '../lib/change_set/validate';
import type { ChangeSetsApi } from '../popup/hooks/useChangeSets';
import { plural } from '../lib/utils';
import { FolderChecklist } from './FolderChecklist';
import { folderRows } from '../lib/folder_rows';

type Node = chrome.bookmarks.BookmarkTreeNode;

interface Props {
    roots: Node[];
    hiddenFolderIds: Set<string>;
    api: ChangeSetsApi;
    startAt: 'export' | 'import';
    onClose: () => void;
    /** A set was imported: open it for review. */
    onImported: (id: string) => void;
}

function describeOp(op: ChangeOp): string {
    switch (op.op) {
        case 'create_folder': return `New folder "${op.title}"`;
        case 'move': return `Move ${op.id} to ${op.parentId}`;
        case 'rename': return `Rename ${op.id} to "${op.title}"`;
        case 'set_tags': return `Tags of ${op.id}`;
        case 'set_rating': return `Rating of ${op.id}`;
        case 'trash': return `Move ${op.id} to Trash`;
    }
}

export const AIOrganiseDialog: React.FC<Props> = ({ roots, hiddenFolderIds, api, startAt, onClose, onImported }) => {
    const [step, setStep] = useState<'export' | 'import'>(startAt);
    const rows = useMemo(() => folderRows(roots, hiddenFolderIds), [roots, hiddenFolderIds]);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [goal, setGoal] = useState('');
    const [strip, setStrip] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [answer, setAnswer] = useState('');
    const [refused, setRefused] = useState<{ ops: ChangeOp[]; verdicts: OpVerdict[] } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const answerRef = useRef<HTMLTextAreaElement>(null);
    const [source, setSource] = useState<{ kind: 'paste' | 'file'; name?: string }>({ kind: 'paste' });

    const sharedCount = rows.filter(r => chosen.has(r.id)).reduce((s, r) => s + r.count, 0);

    const makeExport = async (): Promise<string | null> => {
        if (chosen.size === 0) { setError('Choose at least one folder to share.'); return null; }
        const snapshotId = await api.registerSnapshot([...chosen]);
        if (!snapshotId) { setError("Couldn't prepare the export. Try again."); return null; }
        const urls: string[] = [];
        const collect = (n: Node) => { if (n.url) urls.push(n.url); (n.children ?? []).forEach(collect); };
        roots.forEach(collect);
        const keys = urls.map(u => `meta_${u}`);
        const metaRaw = keys.length ? await chrome.storage.local.get(keys).catch(() => ({})) : {};
        const meta: Record<string, { tags?: string[]; rating?: number }> = {};
        for (const [k, v] of Object.entries(metaRaw as Record<string, { tags?: string[]; rating?: number }>)) meta[k.slice(5)] = { tags: v?.tags, rating: v?.rating };
        const snap = buildSnapshot({ roots, folderIds: [...chosen], hiddenFolderIds, stripQuery: strip, snapshotId, meta });
        return `${instructionsFor(goal)}\n\n${JSON.stringify(snap, null, 1)}`;
    };

    const copy = async () => {
        setBusy(true); setError(null);
        try {
            const text = await makeExport();
            if (!text) return;
            await navigator.clipboard.writeText(text);
            setNotice('Copied. Paste it into your AI chat, then paste its answer below.');
            setStep('import');
            setTimeout(() => answerRef.current?.focus(), 0);
        } catch {
            setError("Couldn't copy. Use Save as file instead.");
        } finally { setBusy(false); }
    };

    const save = async () => {
        setBusy(true); setError(null);
        try {
            const text = await makeExport();
            if (!text) return;
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookmarks-for-ai-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setNotice('Saved. Give the file to your AI, then paste its answer below.');
            setStep('import');
        } finally { setBusy(false); }
    };

    const pickFile = async (file: File | undefined) => {
        if (!file) return;
        setAnswer(await file.text());
        setSource({ kind: 'file', name: file.name });
        setRefused(null); setError(null);
    };

    const review = async () => {
        if (!answer.trim()) { setError("Paste the AI's answer first."); return; }
        setBusy(true); setError(null); setRefused(null);
        const res = await api.importText(answer, source);
        setBusy(false);
        if (res.ok) { onImported(res.id); return; }
        setError(res.error);
        if (res.verdicts && res.ops) setRefused({ ops: res.ops, verdicts: res.verdicts });
    };

    const footer = step === 'export' ? (
        <div className="modal-actions">
            <button type="button" className="btn btn--secondary" onClick={() => { void save(); }} disabled={busy}>
                <Download size={16} aria-hidden="true" /> Save as file
            </button>
            <button type="button" className="btn btn--primary btn--grow" onClick={() => { void copy(); }} disabled={busy}>
                {busy ? <span className="btn-spinner" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                <span>Copy for your AI</span>
            </button>
        </div>
    ) : (
        <div className="modal-actions">
            <button type="button" className="btn btn--secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                <FileUp size={16} aria-hidden="true" /> Choose a file
            </button>
            <button type="button" className="btn btn--primary btn--grow" onClick={() => { void review(); }} disabled={busy}>
                {busy && <span className="btn-spinner" aria-hidden="true" />}
                <span>Review changes</span>
            </button>
        </div>
    );

    return (
        <Modal title={step === 'export' ? 'Organise with an AI' : "Bring back the AI's changes"} onClose={busy ? () => { } : onClose} className="modal--narrow ai-dialog" footer={footer}>
            {step === 'export' ? (
                <div className="ai-dialog-body">
                    <p className="modal-text">Choose the folders the AI may see. Its provider will see their titles and links. Nothing changes until you review and apply its answer.</p>
                    <FolderChecklist roots={roots} hiddenFolderIds={hiddenFolderIds} chosen={chosen} onChange={setChosen} legend="Folders to share" />
                    <p className="ai-dialog-hint" aria-live="polite">{chosen.size ? `${plural(sharedCount, 'bookmark')} in ${plural(chosen.size, 'folder')} will be shared.` : 'Nothing chosen yet. Folders hidden from search are never shared.'}</p>
                    <div>
                        <label className="field-label" htmlFor="ai-goal">What should the AI do? (optional)</label>
                        <textarea id="ai-goal" className="text-field" rows={2} value={goal} onChange={e => setGoal(e.target.value)} placeholder="For example: group these by topic and suggest dead links for Trash" />
                    </div>
                    <label className="ai-check">
                        <input type="checkbox" checked={strip} onChange={e => setStrip(e.target.checked)} />
                        <span>Remove the part of links after "?" (it can hold personal details)</span>
                    </label>
                    {error && <div className="inline-banner inline-banner--error" role="alert">{error}</div>}
                    <button type="button" className="link-btn" onClick={() => setStep('import')}>I already have an answer from an AI</button>
                </div>
            ) : (
                <div className="ai-dialog-body">
                    {notice && <div className="inline-banner" role="status">{notice}</div>}
                    <label className="field-label" htmlFor="ai-answer">The AI's answer</label>
                    <textarea
                        id="ai-answer"
                        ref={answerRef}
                        className="text-field ai-answer"
                        rows={8}
                        value={answer}
                        onChange={e => { setAnswer(e.target.value); setSource({ kind: 'paste' }); setError(null); setRefused(null); }}
                        placeholder='Paste the whole answer. It starts with { and contains "ops".'
                        spellCheck={false}
                    />
                    <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={e => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
                    {source.kind === 'file' && source.name && <p className="ai-dialog-hint">From file {source.name}</p>}
                    {error && <div className="inline-banner inline-banner--error" role="alert">{error}</div>}
                    {refused && (
                        <ul className="ai-refused" aria-label="Changes that can't be made">
                            {refused.verdicts.filter(v => !v.ok).slice(0, 20).map(v => (
                                <li key={v.n}><strong>Change {v.n + 1}</strong> ({describeOp(refused.ops[v.n])}): {v.reason}</li>
                            ))}
                        </ul>
                    )}
                    {startAt === 'export' && <button type="button" className="link-btn" onClick={() => setStep('export')}>Back to choosing folders</button>}
                </div>
            )}
        </Modal>
    );
};
