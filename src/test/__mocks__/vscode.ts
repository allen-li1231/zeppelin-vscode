/**
 * Lightweight mock of the 'vscode' module for Vitest unit tests.
 * These tests run outside the VS Code extension host, so every API that
 * the source files touch must be stubbed here.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum NotebookCellKind {
    Markup = 1,
    Code = 2,
}

export enum NotebookCellStatusBarAlignment {
    Left = 1,
    Right = 2,
}

export enum TextEditorLineNumbersStyle {
    Off = 0,
    On = 1,
    Relative = 2,
    Interval = 3,
}

// ── Classes ───────────────────────────────────────────────────────────────────

export class NotebookCellStatusBarItem {
    text: string;
    alignment: NotebookCellStatusBarAlignment;
    command?: {
        title: string;
        command: string;
        arguments?: unknown[];
    };
    tooltip?: string;

    constructor(text: string, alignment: NotebookCellStatusBarAlignment) {
        this.text = text;
        this.alignment = alignment;
    }
}

export class NotebookCellOutputItem {
    data: Uint8Array;
    mime: string;

    constructor(data: Uint8Array, mime: string) {
        this.data = data;
        this.mime = mime;
    }

    static text(value: string, mime = 'text/plain'): NotebookCellOutputItem {
        return new NotebookCellOutputItem(
            new TextEncoder().encode(value),
            mime,
        );
    }

    static stdout(value: string): NotebookCellOutputItem {
        return new NotebookCellOutputItem(
            new TextEncoder().encode(value),
            'application/vnd.code.notebook.stdout',
        );
    }

    static stderr(value: string): NotebookCellOutputItem {
        return new NotebookCellOutputItem(
            new TextEncoder().encode(value),
            'application/vnd.code.notebook.stderr',
        );
    }

    static error(err: { name: string; message: string; stack?: string }): NotebookCellOutputItem {
        return new NotebookCellOutputItem(
            new TextEncoder().encode(JSON.stringify(err)),
            'application/vnd.code.notebook.error',
        );
    }
}

export class NotebookCellOutput {
    items: NotebookCellOutputItem[];
    metadata?: Record<string, unknown>;

    constructor(items: NotebookCellOutputItem[], metadata?: Record<string, unknown>) {
        this.items = items;
        this.metadata = metadata;
    }
}

export class NotebookCellData {
    kind: NotebookCellKind;
    value: string;
    languageId: string;
    outputs?: NotebookCellOutput[];
    metadata?: Record<string, unknown>;

    constructor(kind: NotebookCellKind, value: string, languageId: string) {
        this.kind = kind;
        this.value = value;
        this.languageId = languageId;
    }
}

type EventListener<T> = (e: T) => unknown;

export class EventEmitter<T = void> {
    private _listeners: Array<EventListener<T>> = [];

    get event(): (listener: EventListener<T>) => { dispose: () => void } {
        return (listener: EventListener<T>) => {
            this._listeners.push(listener);
            return {
                dispose: () => {
                    this._listeners = this._listeners.filter(l => l !== listener);
                },
            };
        };
    }

    fire(data: T): void {
        this._listeners.forEach(l => l(data));
    }

    dispose(): void {
        this._listeners = [];
    }
}

export class Uri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly fsPath: string;

    private constructor(scheme: string, authority: string, path: string) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.fsPath = path;
    }

    static parse(value: string): Uri {
        const colonIdx = value.indexOf(':');
        const scheme = colonIdx >= 0 ? value.slice(0, colonIdx) : '';
        const rest = colonIdx >= 0 ? value.slice(colonIdx + 1) : value;
        return new Uri(scheme, '', rest);
    }

    toString(): string {
        return `${this.scheme}:${this.path}`;
    }
}

// ── Workspace / Window namespaces ─────────────────────────────────────────────

function createWorkspaceConfiguration(defaults: Record<string, unknown> = {}) {
    return {
        get<T>(key: string, defaultValue?: T): T {
            return (key in defaults ? defaults[key] : defaultValue) as T;
        },
        has: (_key: string) => false,
        inspect: (_key: string) => undefined,
        update: () => Promise.resolve(),
    };
}

export const workspace = {
    getConfiguration: (_section?: string) => createWorkspaceConfiguration(),
    applyEdit: (_edit: unknown) => Promise.resolve(true),
};

export const notebooks = {
    createNotebookController: (
        _id: string,
        _notebookType: string,
        _label: string
    ) => ({
        executeHandler: undefined as any,
        interruptHandler: undefined as any,
        label: _label,
        description: undefined as string | undefined,
        detail: undefined as string | undefined,
        supportedLanguages: undefined as string[] | undefined,
        supportsExecutionOrder: false,
        onDidChangeSelectedNotebooks: (_listener: any) => ({ dispose: () => {} }),
        createNotebookCellExecution: (_cell: any) => ({
            executionOrder: undefined,
            token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
            start: () => {},
            end: () => {},
            clearOutput: () => Promise.resolve(),
            replaceOutput: () => Promise.resolve(),
            appendOutput: () => Promise.resolve(),
            replaceOutputItems: () => Promise.resolve(),
            appendOutputItems: () => Promise.resolve(),
        }),
        dispose: () => {},
    }),
};

export const window = {
    showInformationMessage: (_message: string, ..._args: unknown[]) =>
        Promise.resolve(undefined as string | undefined),
    showWarningMessage: (_message: string, ..._args: unknown[]) =>
        Promise.resolve(undefined as string | undefined),
    showErrorMessage: (_message: string, ..._args: unknown[]) =>
        Promise.resolve(undefined as string | undefined),
    activeNotebookEditor: undefined as unknown,
};

// ── Minimal interface re-exports ──────────────────────────────────────────────

export interface Command {
    title: string;
    command: string;
    tooltip?: string;
    arguments?: unknown[];
}

export type Event<T> = (listener: (e: T) => unknown) => { dispose: () => void };

export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

export interface CancellationToken {
    isCancellationRequested: boolean;
    onCancellationRequested: Event<void>;
}

export interface NotebookController {
    executeHandler: ((
        cells: NotebookCell[],
        notebook: NotebookDocument,
        controller: NotebookController
    ) => void) | undefined;
    label: string;
    description?: string;
    detail?: string;
    supportedLanguages?: string[];
    supportsExecutionOrder: boolean;
    createNotebookCellExecution: (cell: NotebookCell) => NotebookCellExecution;
    dispose: () => void;
}

export interface NotebookCellExecution {
    executionOrder: number | undefined;
    token: CancellationToken;
    start: (startTime?: number) => void;
    end: (success: boolean | undefined, endTime?: number) => void;
    clearOutput: (cell?: NotebookCell) => Thenable<void>;
    replaceOutput: (
        out: NotebookCellOutput | readonly NotebookCellOutput[],
        cell?: NotebookCell
    ) => Thenable<void>;
    appendOutput: (
        out: NotebookCellOutput | readonly NotebookCellOutput[],
        cell?: NotebookCell
    ) => Thenable<void>;
    replaceOutputItems: (
        items: NotebookCellOutputItem | readonly NotebookCellOutputItem[],
        output: NotebookCellOutput
    ) => Thenable<void>;
    appendOutputItems: (
        items: NotebookCellOutputItem | readonly NotebookCellOutputItem[],
        output: NotebookCellOutput
    ) => Thenable<void>;
}

export interface NotebookCell {
    kind: NotebookCellKind;
    metadata: { [key: string]: unknown };
    document: {
        getText: () => string;
        isClosed: boolean;
        languageId: string;
        uri: Uri;
    };
    notebook: {
        isClosed: boolean;
        metadata: { [key: string]: unknown };
        uri: Uri;
    };
    index: number;
    outputs: NotebookCellOutput[];
}

export interface NotebookDocument {
    isClosed: boolean;
    metadata: { [key: string]: unknown };
    uri: Uri;
    cellCount: number;
    cellAt: (index: number) => NotebookCell;
}

export type NotebookCellStatusBarItemProvider = {
    onDidChangeCellStatusBarItems?: Event<void>;
    provideCellStatusBarItems: (
        cell: NotebookCell,
        token?: CancellationToken
    ) => ProviderResult<NotebookCellStatusBarItem | NotebookCellStatusBarItem[]>;
};