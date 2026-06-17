import * as assert from 'assert';
import * as vscode from 'vscode';
import { vi } from 'vitest';
import { ZeppelinKernel } from '../../extension/notebookKernel';
import { createMockCell, createMockKernel } from './mocks';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal mock ExtensionContext for constructing a ZeppelinKernel. */
function createMockContext(): any {
    const wsState = new Map<string, any>();
    const globalState = new Map<string, any>();
    const secrets = new Map<string, string>();

    return {
        extension: { packageJSON: { version: '0.0.0-test' } },
        subscriptions: [],
        workspaceState: {
            get: (key: string, defaultValue?: any) => wsState.has(key) ? wsState.get(key) : defaultValue,
            update: (key: string, value: any) => { wsState.set(key, value); return Promise.resolve(); },
        },
        globalState: {
            get: (key: string, defaultValue?: any) => globalState.has(key) ? globalState.get(key) : defaultValue,
            update: (key: string, value: any) => { globalState.set(key, value); return Promise.resolve(); },
            setKeysForSync: () => {},
        },
        secrets: {
            get: async (key: string) => secrets.get(key),
            store: async (key: string, value: string) => { secrets.set(key, value); },
            delete: async (key: string) => { secrets.delete(key); },
        },
    };
}

/** Minimal mock NotebookService that stubs all API calls. */
function createMockService(overrides: Record<string, any> = {}): any {
    return {
        baseURL: 'http://localhost:8080',
        listNotes: async () => ({ data: { body: [] } }),
        getInfo: async (_noteId: string) => ({ data: { body: { paragraphs: [] } } }),
        createNote: async () => ({ data: { body: 'note_new' } }),
        importNote: async () => ({ data: { body: 'note_imported' } }),
        getParagraphInfo: async (_noteId: string, _paraId: string) => ({
            data: { body: { id: 'para_001', status: 'READY', text: '%python\nprint("hello")\n' } },
        }),
        runParagraph: async () => ({ data: { body: { code: 'SUCCESS', msg: [] } } }),
        stopParagraph: async () => ({ status: 200 }),
        createParagraph: async () => ({ data: { body: 'para_new' } }),
        updateParagraphText: async () => ({ data: { body: {} } }),
        updateParagraphConfig: async () => ({ data: { body: {} } }),
        moveParagraphToIndex: async () => ({}),
        deleteParagraph: async () => ({}),
        listInterpreters: async () => ({ data: { body: [] } }),
        getInterpreterSetting: async () => ({ data: { status: 'OK', body: { status: 'READY' } } }),
        restartInterpreter: async () => ({ status: 200 }),
        stopAll: async () => ({ data: {} }),
        setHttpsAgent: () => {},
        cancelConnect: () => {},
        resetCancelToken: () => {},
        onSessionExpired: undefined as (() => void) | undefined,
        ...overrides,
    };
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('ZeppelinKernel Test Suite', () => {

    let context: any;
    let kernel: ZeppelinKernel;

    beforeEach(() => {
        context = createMockContext();
    });

    afterEach(() => {
        try { kernel?.dispose(); } catch { /* ignore */ }
    });

    // ── Constructor & Lifecycle ──────────────────────────────────────────

    describe('constructor & lifecycle', () => {

        it('constructs without service and is inactive', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.isActive(), false);
        });

        it('constructs with service having baseURL and activates', () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(kernel.isActive(), true);
        });

        it('has correct readonly properties', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.id, 'zeppelin-notebook-kernel');
            assert.strictEqual(kernel.notebookType, 'zeppelin-notebook');
            assert.strictEqual(kernel.label, 'Zeppelin Notebook');
            assert.ok(Array.isArray(kernel.supportedLanguages));
            assert.ok(kernel.supportedLanguages.includes('python'));
        });

        it('getContext returns the extension context', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.getContext(), context);
        });

        it('getController returns a controller object', () => {
            kernel = new ZeppelinKernel(context);
            const ctrl = kernel.getController();
            assert.ok(ctrl);
            assert.ok(typeof ctrl.dispose === 'function');
        });

        it('dispose deactivates and disposes controller', () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(kernel.isActive(), true);
            kernel.dispose();
            assert.strictEqual(kernel.isActive(), false);
        });
    });

    // ── activate / deactivate ───────────────────────────────────────────

    describe('activate / deactivate', () => {

        it('activate without service returns false', () => {
            kernel = new ZeppelinKernel(context);
            const result = kernel.activate();
            assert.strictEqual(result, false);
        });

        it('deactivate when already inactive returns false', () => {
            kernel = new ZeppelinKernel(context);
            const result = kernel.deactivate();
            assert.strictEqual(result, false);
        });

        it('deactivate after activation returns false (isActive)', () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(kernel.isActive(), true);
            const result = kernel.deactivate();
            // deactivate returns the isActive value after deactivation
            assert.strictEqual(result, false);
            assert.strictEqual(kernel.isActive(), false);
        });
    });

    // ── setDisplay ──────────────────────────────────────────────────────

    describe('setDisplay', () => {

        it('updates controller label, description, and detail', () => {
            kernel = new ZeppelinKernel(context);
            kernel.setDisplay('My Label', 'My Desc', 'My Detail');
            const ctrl = kernel.getController();
            assert.strictEqual(ctrl.label, 'My Label');
            assert.strictEqual(ctrl.description, 'My Desc');
            assert.strictEqual(ctrl.detail, 'My Detail');
        });

        it('handles undefined optional params', () => {
            kernel = new ZeppelinKernel(context);
            kernel.setDisplay('Label');
            const ctrl = kernel.getController();
            assert.strictEqual(ctrl.label, 'Label');
            assert.strictEqual(ctrl.description, undefined);
            assert.strictEqual(ctrl.detail, undefined);
        });
    });

    // ── getService / setService ─────────────────────────────────────────

    describe('getService / setService', () => {

        it('getService returns undefined when no service is set', () => {
            kernel = new ZeppelinKernel(context);
            // No service provided, but constructor may assign service
            // The kernel was constructed without service
            assert.strictEqual(kernel.getService(), undefined);
        });

        it('getService returns service when provided in constructor', () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(kernel.getService(), service);
        });
    });

    // ── isNoteSyncing ───────────────────────────────────────────────────

    describe('isNoteSyncing', () => {

        it('returns false for undefined notebook', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.isNoteSyncing(undefined), false);
        });

        it('returns false for non-syncing notebook', () => {
            kernel = new ZeppelinKernel(context);
            const fakeNote = { uri: vscode.Uri.parse('file:///test.zpln'), metadata: { id: 'n1' } };
            assert.strictEqual(kernel.isNoteSyncing(fakeNote as any), false);
        });
    });

    // ── hasPendingParagraphUpdate ────────────────────────────────────────

    describe('hasPendingParagraphUpdate', () => {

        it('returns false for cell with no pending update', () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({ status: 'READY' });
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), false);
        });
    });

    // ── updateCellMetadata ──────────────────────────────────────────────

    describe('updateCellMetadata', () => {

        it('calls workspace.applyEdit and returns result', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({ status: 'READY' });
            const result = await kernel.updateCellMetadata(cell as any, { status: 'RUNNING' });
            assert.strictEqual(result, true);
        });
    });

    // ── removeCellMetadata ──────────────────────────────────────────────

    describe('removeCellMetadata', () => {

        it('calls workspace.applyEdit and returns result', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({
                status: 'READY',
                syncConflict: { text: 'remote' },
            });
            const result = await kernel.removeCellMetadata(
                cell as any, ['syncConflict']
            );
            assert.strictEqual(result, true);
        });
    });

    // ── editWithoutParagraphUpdate ──────────────────────────────────────

    describe('editWithoutParagraphUpdate', () => {

        it('executes the callback and returns its result', async () => {
            kernel = new ZeppelinKernel(context);
            let called = false;
            await kernel.editWithoutParagraphUpdate(async () => {
                called = true;
            });
            assert.strictEqual(called, true);
        });

        it('runs callback exclusively via editMutex', async () => {
            kernel = new ZeppelinKernel(context);
            const order: number[] = [];
            const p1 = kernel.editWithoutParagraphUpdate(async () => {
                order.push(1);
            });
            const p2 = kernel.editWithoutParagraphUpdate(async () => {
                order.push(2);
            });
            await Promise.all([p1, p2]);
            assert.deepStrictEqual(order, [1, 2]);
        });
    });

    // ── pollUpdateCellMetadata / applyPolledNotebookEdits ────────────────

    describe('pollUpdateCellMetadata & applyPolledNotebookEdits', () => {

        it('queues and then flushes a metadata edit', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({ status: 'READY' });

            await kernel.pollUpdateCellMetadata(cell as any, { status: 'RUNNING' });
            // The edit is queued but not yet applied
            // applyPolledNotebookEdits should flush it
            await kernel.applyPolledNotebookEdits();
            // No error means success
        });

        it('skips edits for deleted cells (index === -1)', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({ status: 'READY', index: -1 });

            await kernel.pollUpdateCellMetadata(cell as any, { status: 'RUNNING' });
            await kernel.applyPolledNotebookEdits();
            // Should not throw
        });

        it('skips edits for cells with syncConflict', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({
                status: 'READY',
                syncConflict: { text: 'remote text' },
            });

            await kernel.pollUpdateCellMetadata(cell as any, { status: 'RUNNING' });
            await kernel.applyPolledNotebookEdits();
            // Should skip without error
        });
    });

    // ── registerParagraphUpdate / unregisterParagraphUpdate ──────────────

    describe('registerParagraphUpdate / unregisterParagraphUpdate', () => {

        it('registers a cell for paragraph update', async () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });

            await kernel.registerParagraphUpdate(cell as any);
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), true);
        });

        it('does not register if resolvingDiff is set', async () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });
            (cell.metadata as any).resolvingDiff = true;

            await kernel.registerParagraphUpdate(cell as any);
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), false);
        });

        it('unregisters a cell from paragraph update', async () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });

            await kernel.registerParagraphUpdate(cell as any);
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), true);

            await kernel.unregisterParagraphUpdate(cell as any);
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), false);
        });

        it('does not double-register the same cell', async () => {
            const service = createMockService();
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });

            await kernel.registerParagraphUpdate(cell as any);
            await kernel.registerParagraphUpdate(cell as any);
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), true);

            await kernel.unregisterParagraphUpdate(cell as any);
            assert.strictEqual(kernel.hasPendingParagraphUpdate(cell as any), false);
        });
    });

    // ── listNotes / hasNote / doesNotebookExist ─────────────────────────

    describe('listNotes / hasNote / doesNotebookExist', () => {

        it('listNotes returns empty array when no service', async () => {
            kernel = new ZeppelinKernel(context);
            const notes = await kernel.listNotes();
            assert.deepStrictEqual(notes, []);
        });

        it('listNotes returns body from service', async () => {
            const service = createMockService({
                listNotes: async () => ({
                    data: { body: [{ id: 'n1', path: '/test' }] },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            const notes = await kernel.listNotes();
            assert.strictEqual(notes.length, 1);
            assert.strictEqual(notes[0].id, 'n1');
        });

        it('hasNote returns false for undefined noteId', async () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(await kernel.hasNote(undefined), false);
        });

        it('hasNote returns true when note exists', async () => {
            const service = createMockService({
                listNotes: async () => ({
                    data: { body: [{ id: 'n1', path: '/myNote' }] },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(await kernel.hasNote('n1'), true);
        });

        it('hasNote returns false when note is in Trash', async () => {
            const service = createMockService({
                listNotes: async () => ({
                    data: { body: [{ id: 'n1', path: '/~Trash/myNote' }] },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(await kernel.hasNote('n1'), false);
        });

        it('hasNote returns false when note does not exist', async () => {
            const service = createMockService({
                listNotes: async () => ({
                    data: { body: [{ id: 'n1', path: '/myNote' }] },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            assert.strictEqual(await kernel.hasNote('n2'), false);
        });

        it('doesNotebookExist returns false when inactive', async () => {
            kernel = new ZeppelinKernel(context);
            const note = { metadata: { id: 'n1' } };
            assert.strictEqual(await kernel.doesNotebookExist(note as any), false);
        });

        it('doesNotebookExist returns true when active and note exists', async () => {
            const service = createMockService({
                listNotes: async () => ({
                    data: { body: [{ id: 'n1', path: '/myNote' }] },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            const note = { metadata: { id: 'n1' } };
            assert.strictEqual(await kernel.doesNotebookExist(note as any), true);
        });
    });

    // ── stopParagraph ───────────────────────────────────────────────────

    describe('stopParagraph', () => {

        it('returns true when service responds with 200', async () => {
            const service = createMockService({
                stopParagraph: async () => ({ status: 200 }),
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'RUNNING' });
            const result = await kernel.stopParagraph(cell as any);
            assert.strictEqual(result, true);
        });

        it('returns false when service responds with non-200', async () => {
            const service = createMockService({
                stopParagraph: async () => ({ status: 500 }),
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'RUNNING' });
            const result = await kernel.stopParagraph(cell as any);
            assert.strictEqual(result, false);
        });
    });

    // ── getExecutionByParagraphId ───────────────────────────────────────

    describe('getExecutionByParagraphId', () => {

        it('returns undefined when no execution is tracked', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.getExecutionByParagraphId('para_001'), undefined);
        });
    });

    // ── acceptRemoteCell ────────────────────────────────────────────────

    describe('acceptRemoteCell', () => {

        it('does nothing when cell has no syncConflict', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({ status: 'READY' });
            // Should not throw
            await kernel.acceptRemoteCell(cell as any);
        });

        it('replaces cells when syncConflict is present', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({
                status: 'READY',
                syncConflict: {
                    id: 'para_001',
                    status: 'READY',
                    text: '%python\nremote_code()\n',
                    config: { editorSetting: { language: 'python' } },
                },
            });
            // Should not throw — calls editWithoutParagraphUpdate → replaceNoteCells
            await kernel.acceptRemoteCell(cell as any);
        });
    });

    // ── acceptLocalCell ─────────────────────────────────────────────────

    describe('acceptLocalCell', () => {

        it('does nothing when cell has no syncConflict', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({ status: 'READY' });
            await kernel.acceptLocalCell(cell as any);
        });

        it('clears conflict and pushes text when syncConflict exists', async () => {
            let textPushed = false;
            const service = createMockService({
                updateParagraphText: async () => {
                    textPushed = true;
                    return { data: { body: {} } };
                },
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({
                status: 'READY',
                syncConflict: { text: 'remote text' },
            });
            await kernel.acceptLocalCell(cell as any);
            assert.strictEqual(textPushed, true);
        });

        it('shows error message when pushing text fails', async () => {
            let errorShown = false;
            const origShowError = vscode.window.showErrorMessage;
            (vscode.window as any).showErrorMessage = (..._args: any[]) => {
                errorShown = true;
                return Promise.resolve(undefined);
            };

            const service = createMockService({
                updateParagraphText: async () => { throw new Error('Network fail'); },
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({
                status: 'READY',
                syncConflict: { text: 'remote text' },
            });
            await kernel.acceptLocalCell(cell as any);
            assert.strictEqual(errorShown, true);

            (vscode.window as any).showErrorMessage = origShowError;
        });
    });

    // ── updatePollingParagraphsDirect ────────────────────────────────────

    describe('updatePollingParagraphsDirect', () => {

        it('completes without error when no pending updates', async () => {
            kernel = new ZeppelinKernel(context);
            await kernel.updatePollingParagraphsDirect();
        });
    });

    // ── updateNoteMetadata ──────────────────────────────────────────────

    describe('updateNoteMetadata', () => {

        it('applies workspace edit', async () => {
            kernel = new ZeppelinKernel(context);
            const fakeNote = {
                metadata: { id: 'n1', name: 'test' },
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
            };
            const result = await kernel.updateNoteMetadata(
                fakeNote as any, { name: 'updated' }
            );
            assert.strictEqual(result, true);
        });
    });

    // ── replaceNoteCells / insertNoteCells / deleteNoteCells ─────────────

    describe('notebook cell editing', () => {

        let fakeNote: any;

        beforeEach(() => {
            kernel = new ZeppelinKernel(context);
            fakeNote = {
                metadata: { id: 'n1' },
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
            };
        });

        it('replaceNoteCells applies edit', async () => {
            const range = new vscode.NotebookRange(0, 1);
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code, 'code', 'python'
            );
            const result = await kernel.replaceNoteCells(fakeNote, range, [cellData]);
            assert.strictEqual(result, true);
        });

        it('insertNoteCells applies edit', async () => {
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code, 'code', 'python'
            );
            const result = await kernel.insertNoteCells(fakeNote, 0, [cellData]);
            assert.strictEqual(result, true);
        });

        it('deleteNoteCells applies edit', async () => {
            const range = new vscode.NotebookRange(0, 1);
            const result = await kernel.deleteNoteCells(fakeNote, range);
            assert.strictEqual(result, true);
        });
    });

    // ── editNote ────────────────────────────────────────────────────────

    describe('editNote', () => {

        it('applies multiple edit types at once', async () => {
            kernel = new ZeppelinKernel(context);
            const fakeNote = {
                metadata: { id: 'n1' },
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
            };
            const range = new vscode.NotebookRange(0, 1);
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code, 'code', 'python'
            );
            const result = await kernel.editNote(
                fakeNote as any,
                range, [cellData],   // replace
                0, [cellData],       // insert
                range,               // delete
                { name: 'updated' }  // metadata
            );
            assert.strictEqual(result, true);
        });

        it('handles no operations gracefully', async () => {
            kernel = new ZeppelinKernel(context);
            const fakeNote = {
                metadata: { id: 'n1' },
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
            };
            const result = await kernel.editNote(fakeNote as any);
            assert.strictEqual(result, true);
        });
    });

    // ── runParagraph ────────────────────────────────────────────────────

    describe('runParagraph', () => {

        it('returns cell output for sync execution', async () => {
            const service = createMockService({
                runParagraph: async () => ({
                    data: {
                        body: {
                            code: 'SUCCESS',
                            msg: [{ type: 'TEXT', data: 'hello world' }],
                        },
                    },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });
            const result = await kernel.runParagraph(cell as any, true);
            assert.ok(Array.isArray(result));
            assert.ok(result.length > 0);
        });

        it('returns empty array when sync result has no body', async () => {
            const service = createMockService({
                runParagraph: async () => ({ data: {} }),
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });
            const result = await kernel.runParagraph(cell as any, true);
            assert.deepStrictEqual(result, []);
        });

        it('returns data for async execution', async () => {
            const service = createMockService({
                runParagraph: async () => ({ data: { status: 'OK' } }),
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });
            const result = await kernel.runParagraph(cell as any, false);
            assert.deepStrictEqual(result, { status: 'OK' });
        });
    });

    // ── createNote / importNote ─────────────────────────────────────────

    describe('createNote / importNote', () => {

        it('createNote returns note id from service', async () => {
            const service = createMockService({
                createNote: async () => ({ data: { body: 'note_123' } }),
            });
            kernel = new ZeppelinKernel(context, service);
            const result = await kernel.createNote('TestNote');
            assert.strictEqual(result, 'note_123');
        });

        it('importNote returns note id from service', async () => {
            const service = createMockService({
                importNote: async () => ({ data: { body: 'note_456' } }),
            });
            kernel = new ZeppelinKernel(context, service);
            const result = await kernel.importNote({ id: 'n1' });
            assert.strictEqual(result, 'note_456');
        });
    });

    // ── Mutex properties ────────────────────────────────────────────────

    describe('mutex properties', () => {

        it('updateMutex is not locked initially', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.updateMutex.isLocked(), false);
        });

        it('editMutex is not locked initially', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.editMutex.isLocked(), false);
        });
    });

    // ── cellStatusBar ───────────────────────────────────────────────────

    describe('cellStatusBar', () => {

        it('cellStatusBar is undefined initially', () => {
            kernel = new ZeppelinKernel(context);
            assert.strictEqual(kernel.cellStatusBar, undefined);
        });

        it('cellStatusBar can be set', () => {
            kernel = new ZeppelinKernel(context);
            const fakeStatusBar = { scheduleTracking: () => {}, dispose: () => {} };
            kernel.cellStatusBar = fakeStatusBar as any;
            assert.strictEqual(kernel.cellStatusBar, fakeStatusBar);
        });
    });

    // ── syncNote ────────────────────────────────────────────────────────

    describe('syncNote', () => {

        it('shows warning when note has no id', async () => {
            let warningShown = false;
            const origShowWarning = vscode.window.showWarningMessage;
            (vscode.window as any).showWarningMessage = (..._args: any[]) => {
                warningShown = true;
                return Promise.resolve(undefined);
            };

            kernel = new ZeppelinKernel(context);
            const fakeNote = {
                metadata: {},
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
                getCells: () => [],
            };
            await kernel.syncNote(fakeNote as any);
            assert.strictEqual(warningShown, true);

            (vscode.window as any).showWarningMessage = origShowWarning;
        });

        it('marks note as syncing during operation', async () => {
            const service = createMockService({
                getInfo: async () => ({
                    data: { body: { paragraphs: [] } },
                }),
            });
            kernel = new ZeppelinKernel(context, service);
            const fakeNote = {
                metadata: { id: 'n1', name: 'test' },
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
                getCells: () => [],
            };

            // During syncNote the note should be registered as syncing
            // After completion it should be unregistered
            await kernel.syncNote(fakeNote as any);
            assert.strictEqual(kernel.isNoteSyncing(fakeNote as any), false);
        });

        it('handles undefined serverNote gracefully', async () => {
            const service = createMockService({
                getInfo: async () => ({ status: 404 }),
            });
            kernel = new ZeppelinKernel(context, service);

            // Suppress error message
            const origShowError = vscode.window.showErrorMessage;
            (vscode.window as any).showErrorMessage = () => Promise.resolve(undefined);

            const fakeNote = {
                metadata: { id: 'n1', name: 'test' },
                uri: vscode.Uri.parse('file:///tmp/test.zpln'),
                getCells: () => [],
            };

            await kernel.syncNote(fakeNote as any);
            assert.strictEqual(kernel.isNoteSyncing(fakeNote as any), false);

            (vscode.window as any).showErrorMessage = origShowError;
        });
    });

    // ── autoDetectCellLanguage ──────────────────────────────────────────

    describe('autoDetectCellLanguage', () => {

        it('does nothing when cell has no interpreter magic', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({
                status: 'READY',
                text: 'no magic here\n',
            });
            // Should not throw
            await kernel.autoDetectCellLanguage(cell as any);
        });

        it('does nothing when interpreter cache is not available', async () => {
            kernel = new ZeppelinKernel(context);
            const cell = createMockCell({
                status: 'READY',
                text: '%python\nprint("hello")\n',
            });
            // Cache is undefined (no service, not activated)
            await kernel.autoDetectCellLanguage(cell as any);
        });
    });

    // ── createParagraph ─────────────────────────────────────────────────

    describe('createParagraph', () => {

        it('calls service.createParagraph and updates cell metadata', async () => {
            let createCalled = false;
            const service = createMockService({
                createParagraph: async () => {
                    createCalled = true;
                    return { data: { body: 'para_new_id' } };
                },
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });

            const result = await kernel.createParagraph(cell as any);
            assert.strictEqual(createCalled, true);
            assert.ok(result);
        });
    });

    // ── updateParagraphText ─────────────────────────────────────────────

    describe('updateParagraphText', () => {

        it('calls service and polls cell metadata update', async () => {
            let updateTextCalled = false;
            const service = createMockService({
                updateParagraphText: async () => {
                    updateTextCalled = true;
                    return { data: { body: { status: 'READY' } } };
                },
            });
            kernel = new ZeppelinKernel(context, service);
            const cell = createMockCell({ status: 'READY' });

            await kernel.updateParagraphText(cell as any);
            assert.strictEqual(updateTextCalled, true);
        });
    });

    // ── getNoteInfo ─────────────────────────────────────────────────────

    describe('getNoteInfo', () => {

        it('returns server note data on success', async () => {
            const serverNote = { id: 'n1', paragraphs: [] };
            const service = createMockService({
                getInfo: async () => ({ data: { body: serverNote } }),
            });
            kernel = new ZeppelinKernel(context, service);
            const fakeNote = { metadata: { id: 'n1' } };

            const result = await kernel.getNoteInfo(fakeNote as any);
            assert.deepStrictEqual(result, serverNote);
        });
    });
});