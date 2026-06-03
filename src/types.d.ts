export { };

declare global {
    // ── Chrome Built-in AI (Gemini Nano) — Chrome 127+ ────────────────────────
    interface AILanguageModelSession {
        prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
        promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
        clone(options?: { signal?: AbortSignal }): Promise<AILanguageModelSession>;
        destroy(): void;
        readonly tokensSoFar: number;
        readonly maxTokens: number;
        readonly tokensLeft: number;
    }

    interface AILanguageModelCreateOptions {
        systemPrompt?: string;
        initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        temperature?: number;
        topK?: number;
        signal?: AbortSignal;
        monitor?: (monitor: EventTarget) => void;
        expectedInputs?: Array<{ type: 'text'; languages?: string[] }>;
        expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
    }

    interface AIDownloadProgressEvent extends Event {
        loaded: number; // 0–1
        total: number;  // 1
    }

    interface AILanguageModelFactory {
        availability(options?: {
            expectedInputs?: Array<{ type: 'text'; languages?: string[] }>;
            expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
        }): Promise<'available' | 'after-download' | 'downloadable' | 'downloading' | 'unavailable'>;
        create(options?: AILanguageModelCreateOptions): Promise<AILanguageModelSession>;
    }

    var LanguageModel: AILanguageModelFactory;
    interface Window {
        showDirectoryPicker(options?: unknown): Promise<FileSystemDirectoryHandle>;
    }

    interface FileSystemHandlePermissionDescriptor {
        mode?: 'read' | 'readwrite';
    }

    interface FileSystemHandle {
        kind: 'file' | 'directory';
        name: string;
        isSameEntry(other: FileSystemHandle): Promise<boolean>;
        queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
        requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    }

    interface FileSystemDirectoryHandle extends FileSystemHandle {
        kind: 'directory';
        getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
        getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
        removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
        resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
        values(): AsyncIterableIterator<FileSystemHandle>;
    }

    interface FileSystemFileHandle extends FileSystemHandle {
        kind: 'file';
        getFile(): Promise<File>;
        createWritable(options?: unknown): Promise<FileSystemWritableFileStream>;
    }

    interface FileSystemWritableFileStream extends WritableStream {
        write(data: unknown): Promise<void>;
        seek(position: number): Promise<void>;
        truncate(size: number): Promise<void>;
    }
}
