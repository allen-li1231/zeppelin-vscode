import * as vscode from 'vscode';

/**
 * Lightweight mock/stub factories for unit-testing components that depend on
 * ZeppelinKernel and the VS Code notebook API.
 *
 * These run inside the VS Code test-electron host, so the real `vscode` module
 * is available for constructing NotebookCellStatusBarItem, NotebookCellOutput,
 * etc.  Only the heavy kernel / service layer is stubbed out.
 */

// ── Mock CancellationToken ──────────────────────────────────────────────────

export function createMockCancellationToken(): vscode.CancellationToken {
    const emitter = new vscode.EventEmitter<void>();
    return {
        isCancellationRequested: false,
        onCancellationRequested: emitter.event,
    };
}

// ── Mock NotebookCellExecution ──────────────────────────────────────────────

export interface MockNotebookCellExecution {
    executionOrder: number | undefined;
    token: vscode.CancellationToken;
    start: (startTime?: number) => void;
    end: (success: boolean | undefined, endTime?: number) => void;
    clearOutput: (cell?: vscode.NotebookCell) => Thenable<void>;
    replaceOutput: (
        out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[],
        cell?: vscode.NotebookCell
    ) => Thenable<void>;
    appendOutput: (
        out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[],
        cell?: vscode.NotebookCell
    ) => Thenable<void>;
    replaceOutputItems: (
        items: vscode.NotebookCellOutputItem | readonly vscode.NotebookCellOutputItem[],
        output: vscode.NotebookCellOutput
    ) => Thenable<void>;
    appendOutputItems: (
        items: vscode.NotebookCellOutputItem | readonly vscode.NotebookCellOutputItem[],
        output: vscode.NotebookCellOutput
    ) => Thenable<void>;

    // tracking helpers
    _started: boolean;
    _ended: boolean;
    _startTime: number | undefined;
    _endTime: number | undefined;
    _success: boolean | undefined;
}

export function createMockExecution(): MockNotebookCellExecution {
    const token = createMockCancellationToken();
    const exec: MockNotebookCellExecution = {
        executionOrder: undefined,
        token,
        _started: false,
        _ended: false,
        _startTime: undefined,
        _endTime: undefined,
        _success: undefined,
        start(startTime?: number) {
            exec._started = true;
            exec._startTime = startTime;
        },
        end(success: boolean | undefined, endTime?: number) {
            exec._ended = true;
            exec._success = success;
            exec._endTime = endTime;
        },
        clearOutput: () => Promise.resolve(),
        replaceOutput: () => Promise.resolve(),
        appendOutput: () => Promise.resolve(),
        replaceOutputItems: () => Promise.resolve(),
        appendOutputItems: () => Promise.resolve(),
    };
    return exec;
}

// ── Mock NotebookController ─────────────────────────────────────────────────

export interface MockNotebookController {
    executeHandler: ((
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ) => void) | undefined;
    label: string;
    description: string | undefined;
    detail: string | undefined;
    supportedLanguages: string[] | undefined;
    supportsExecutionOrder: boolean;
    createNotebookCellExecution: (cell: vscode.NotebookCell) => MockNotebookCellExecution;
    dispose: () => void;
}

export function createMockController(): MockNotebookController {
    return {
        executeHandler: undefined,
        label: 'Mock Controller',
        description: undefined,
        detail: undefined,
        supportedLanguages: undefined,
        supportsExecutionOrder: false,
        createNotebookCellExecution: (_cell: vscode.NotebookCell) => createMockExecution(),
        dispose: () => {},
    };
}

// ── Mock NotebookCell ───────────────────────────────────────────────────────

export interface MockCellOptions {
    id?: string;
    status?: string | number | undefined;
    syncConflict?: any;
    kind?: vscode.NotebookCellKind;
    text?: string;
    languageId?: string;
    index?: number;
    isClosed?: boolean;
    notebookClosed?: boolean;
    notebookId?: string;
}

export interface MockNotebookCell {
    kind: vscode.NotebookCellKind;
    metadata: { [key: string]: any };
    document: {
        getText: () => string;
        isClosed: boolean;
        languageId: string;
        uri: vscode.Uri;
    };
    notebook: {
        isClosed: boolean;
        metadata: { [key: string]: any };
        uri: vscode.Uri;
    };
    index: number;
    outputs: vscode.NotebookCellOutput[];
}

export function createMockCell(opts: MockCellOptions = {}): MockNotebookCell {
    const metadata: { [key: string]: any } = {
        id: opts.id ?? 'para_001',
        status: 'status' in opts ? opts.status : 'READY',
    };
    if (opts.syncConflict !== undefined) {
        metadata.syncConflict = opts.syncConflict;
    }

    return {
        kind: opts.kind ?? vscode.NotebookCellKind.Code,
        metadata,
        document: {
            getText: () => opts.text ?? '%python\nprint("hello")\n',
            isClosed: opts.isClosed ?? false,
            languageId: opts.languageId ?? 'python',
            uri: vscode.Uri.parse('vscode-notebook-cell:/tmp/test-note.zpln'),
        },
        notebook: {
            isClosed: opts.notebookClosed ?? false,
            metadata: { id: opts.notebookId ?? 'note_001', name: 'test-note' },
            uri: vscode.Uri.parse('file:///tmp/test-note.zpln'),
        },
        index: opts.index ?? 0,
        outputs: [],
    };
}

// ── Mock ZeppelinKernel (partial) ───────────────────────────────────────────

export interface MockKernelOptions {
    isActive?: boolean;
    interpreterStatus?: string;
    paragraphInfo?: any;
    paragraphInfoError?: Error;
}

export interface MockKernel {
    isActive: () => boolean;
    getController: () => MockNotebookController;
    getService: () => MockService | undefined;
    getParagraphInfo: (cell: any) => Promise<any>;
    getExecutionByParagraphId: (id: string) => any;
    doesNotebookExist: (note: any) => Promise<boolean>;
    runParagraph: (cell: any, sync: boolean) => Promise<any>;
    stopParagraph: (cell: any) => Promise<boolean>;
    updatePollingParagraphsDirect: () => Promise<void>;
    editWithoutParagraphUpdate: (fn: () => Promise<void>) => Promise<void>;
    updateCellMetadata: (cell: any, metadata: any) => Promise<boolean>;
    removeCellMetadata: (cell: any, keys: string[]) => Promise<boolean>;
    applyPolledNotebookEdits: () => Promise<void>;
    isNoteSyncing: (note: any) => boolean;
    hasPendingParagraphUpdate: (cell: any) => boolean;
    editMutex: { isLocked: () => boolean };

    // internal controller
    _controller: MockNotebookController;
    _active: boolean;
}

export interface MockService {
    getInterpreterSetting: (id: string) => Promise<any>;
    stopAll: (noteId: string) => Promise<any>;
}

export function createMockKernel(opts: MockKernelOptions = {}): MockKernel {
    const controller = createMockController();
    const interpreterStatus = opts.interpreterStatus ?? 'READY';

    const kernel: MockKernel = {
        _controller: controller,
        _active: opts.isActive ?? true,
        isActive() {
            return kernel._active;
        },
        getController() {
            return controller;
        },
        getService() {
            return {
                getInterpreterSetting: async (_id: string) => ({
                    data: {
                        status: 'OK',
                        body: { status: interpreterStatus },
                    },
                }),
                stopAll: async (_noteId: string) => ({ data: {} }),
            };
        },
        getParagraphInfo: async (_cell: any) => {
            if (opts.paragraphInfoError) {
                throw opts.paragraphInfoError;
            }
            return opts.paragraphInfo ?? {
                id: 'para_001',
                status: 'READY',
                text: '%python\nprint("hello")\n',
            };
        },
        getExecutionByParagraphId: (_id: string) => undefined,
        doesNotebookExist: async (_note: any) => true,
        runParagraph: async (_cell: any, _sync: boolean) => ({}),
        stopParagraph: async (_cell: any) => true,
        updatePollingParagraphsDirect: async () => {},
        editWithoutParagraphUpdate: async (fn: () => Promise<void>) => { await fn(); },
        updateCellMetadata: async (_cell: any, _metadata: any) => true,
        removeCellMetadata: async (_cell: any, _keys: string[]) => true,
        applyPolledNotebookEdits: async () => {},
        isNoteSyncing: (_note: any) => false,
        hasPendingParagraphUpdate: (_cell: any) => false,
        editMutex: { isLocked: () => false },
    };

    return kernel;
}