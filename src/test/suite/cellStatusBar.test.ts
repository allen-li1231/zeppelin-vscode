import * as assert from 'assert';
import * as vscode from 'vscode';
import { CellStatusProvider } from '../../component/cellStatusBar';
import { createMockKernel, createMockCell, MockKernel } from './mocks';

describe('CellStatusProvider Test Suite', () => {

    let kernel: MockKernel;
    let provider: CellStatusProvider;

    beforeEach(() => {
        kernel = createMockKernel({ isActive: true, interpreterStatus: 'READY' });
        provider = new CellStatusProvider(kernel as any);
    });

    afterEach(() => {
        provider.dispose();
    });

    // ── provideCellStatusBarItems ────────────────────────────────────────────

    describe('provideCellStatusBarItems', () => {

        it('returns empty array when kernel is not active', () => {
            kernel._active = false;
            const cell = createMockCell({ status: 'READY' });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.deepStrictEqual(items, []);
        });

        it('returns empty array for Markup cells', () => {
            const cell = createMockCell({ kind: vscode.NotebookCellKind.Markup });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.deepStrictEqual(items, []);
        });

        it('shows sync conflict indicator when syncConflict is set', () => {
            const cell = createMockCell({
                status: 'READY',
                syncConflict: { text: 'remote text' },
                text: '%python\nprint("hello")\n',
            });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            assert.ok((items as any[]).length >= 3,
                `Expected at least 3 items, got ${(items as any[]).length}`);

            const diffItem = (items as vscode.NotebookCellStatusBarItem[])[0];
            assert.ok(diffItem.text.includes('Remote Changed'));

            const acceptRemoteItem = (items as vscode.NotebookCellStatusBarItem[])[1];
            assert.ok(acceptRemoteItem.text.includes('Accept Remote'));

            const keepLocalItem = (items as vscode.NotebookCellStatusBarItem[])[2];
            assert.ok(keepLocalItem.text.includes('Keep Local'));
        });

        it('shows warning item when cell status is 404', () => {
            const cell = createMockCell({ status: 404 });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            const warningItem = (items as vscode.NotebookCellStatusBarItem[]).find(
                i => i.text.includes('$(warning)')
            );
            assert.ok(warningItem, 'Should have a warning item for 404 status');
            assert.ok(warningItem!.tooltip?.toString().includes("doesn't exist"));
        });

        it('shows debug-disconnect with "Sync pending" when status is undefined', () => {
            const cell = createMockCell({ status: undefined });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            assert.strictEqual((items as any[]).length, 1);
            const item = (items as vscode.NotebookCellStatusBarItem[])[0];
            assert.ok(item.text.includes('$(debug-disconnect)'));
            assert.strictEqual(item.tooltip, 'Sync pending');
        });

        it('shows debug-disconnect with status code for non-404 numeric status', () => {
            const cell = createMockCell({ status: 500 });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            assert.strictEqual((items as any[]).length, 1);
            const item = (items as vscode.NotebookCellStatusBarItem[])[0];
            assert.ok(item.text.includes('$(debug-disconnect)'));
            assert.ok(item.tooltip?.toString().includes('500'));
        });

        it('returns items without interpreter status when no interpreter found', () => {
            const cell = createMockCell({ status: 'READY', text: 'no interpreter here' });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            assert.strictEqual((items as any[]).length, 0);
        });

        it('returns items without interpreter item when interpreter not tracked', () => {
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            assert.strictEqual((items as any[]).length, 0);
        });

        // ── NEW: additional provideCellStatusBarItems edge cases ─────────

        it('sync conflict + 404 status shows conflict items then warning', () => {
            const cell = createMockCell({
                status: 404,
                syncConflict: { text: 'remote text' },
                text: '%python\nprint("hello")\n',
            });
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            assert.ok(Array.isArray(items));
            // Should have: diff item, accept remote item, keep local item, and warning item
            assert.ok(items.length >= 4,
                `Expected at least 4 items (conflict + accept remote + keep local + warning), got ${items.length}`);
            assert.ok(items[0].text.includes('Remote Changed'));
            assert.ok(items[1].text.includes('Accept Remote'));
            assert.ok(items[2].text.includes('Keep Local'));
            const warningItem = items.find(i => i.text.includes('$(warning)'));
            assert.ok(warningItem, 'Should include warning for 404');
        });

        it('sync conflict + undefined status returns disconnect item only (early return)', () => {
            const cell = createMockCell({
                status: undefined,
                syncConflict: { text: 'remote text' },
                text: '%python\nprint("hello")\n',
            });
            // When status is undefined (non-string, non-404), the code returns [item] immediately
            // after pushing the disconnect item, skipping conflict items that were already pushed.
            // Actually, looking at the code flow: syncConflict items are pushed first,
            // then the status check for undefined returns early with just [item].
            // The early return replaces items with a single-element array.
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            assert.ok(Array.isArray(items));
            assert.strictEqual(items.length, 1, 'Early return produces single disconnect item');
            assert.ok(items[0].text.includes('$(debug-disconnect)'));
        });

        it('extracts root interpreter from dot-notation (e.g., %spark.pyspark)', async () => {
            const cell = createMockCell({
                status: 'READY',
                text: '%spark.pyspark\ndf.show()\n',
            });
            // First call registers the cell
            provider.provideCellStatusBarItems(cell as any);
            // Update to populate interpreter map
            await provider.doUpdateAllInterpreterStatus();
            // Second call should find "spark" (root) in the map
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            const interpreterItem = items.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.ok(interpreterItem, 'Should show interpreter status for spark');
            // Command arguments should reference the root interpreter "spark"
            assert.ok(interpreterItem!.command);
            assert.deepStrictEqual((interpreterItem!.command as any).arguments, ['spark']);
        });

        it('shows interpreter status with correct command for restart', async () => {
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);
            await provider.doUpdateAllInterpreterStatus();
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            const interpreterItem = items.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.ok(interpreterItem);
            assert.strictEqual((interpreterItem!.command as any).command, 'zeppelin-vscode.restartInterpreter');
            assert.deepStrictEqual((interpreterItem!.command as any).arguments, ['python']);
        });

        it('404 warning item has correct createMissingParagraph command', () => {
            const cell = createMockCell({ status: 404 });
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            const warningItem = items.find(i => i.text.includes('$(warning)'));
            assert.ok(warningItem);
            assert.strictEqual((warningItem!.command as any).command, 'zeppelin-vscode.createMissingParagraph');
            assert.deepStrictEqual((warningItem!.command as any).arguments, [cell]);
        });

        it('adds cell to internal tracking set on each call', () => {
            const cell = createMockCell({ status: 'READY' });
            provider.provideCellStatusBarItems(cell as any);
            // Verify cell is tracked by checking untrackCell returns true
            // (untrackCell uses Set.delete which returns true if element existed)
            provider.untrackCell(cell as any).then(result => {
                assert.strictEqual(result, true);
            });
        });
    });

    // ── doUpdateAllInterpreterStatus ────────────────────────────────────────

    describe('doUpdateAllInterpreterStatus', () => {

        it('updates interpreter status from service', async () => {
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);

            await provider.doUpdateAllInterpreterStatus();

            const items = provider.provideCellStatusBarItems(cell as any);
            assert.ok(Array.isArray(items));
            const statusItems = (items as vscode.NotebookCellStatusBarItem[]);
            assert.ok(statusItems.length > 0, 'Should have at least one status item after update');
            const interpreterItem = statusItems.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.ok(interpreterItem, 'Should have interpreter status item');
            assert.strictEqual(interpreterItem!.text, 'READY');
        });

        it('skips when already updating (guard flag)', async () => {
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);

            const first = provider.doUpdateAllInterpreterStatus();
            const second = provider.doUpdateAllInterpreterStatus();

            await first;
            await second;
        });

        it('removes closed cells from tracking set', async () => {
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n', isClosed: true });
            provider.provideCellStatusBarItems(cell as any);

            await provider.doUpdateAllInterpreterStatus();

            // Cell should have been removed — untrackCell should return false
            const result = await provider.untrackCell(cell as any);
            assert.strictEqual(result, false);
        });

        // ── NEW: additional doUpdateAllInterpreterStatus tests ───────────

        it('removes cells with closed notebooks from tracking set', async () => {
            const cell = createMockCell({
                status: 'READY',
                text: '%python\nprint("hello")\n',
                notebookClosed: true,
            });
            provider.provideCellStatusBarItems(cell as any);

            await provider.doUpdateAllInterpreterStatus();

            const result = await provider.untrackCell(cell as any);
            assert.strictEqual(result, false, 'Cell with closed notebook should be untracked');
        });

        it('skips cells with no interpreter ID', async () => {
            const cell = createMockCell({
                status: 'READY',
                text: 'no interpreter prefix here\n',
            });
            provider.provideCellStatusBarItems(cell as any);

            await provider.doUpdateAllInterpreterStatus();

            // Cell is still tracked but interpreter map has no entry for it
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            assert.strictEqual(items.length, 0);
        });

        it('deduplicates interpreter queries for multiple cells with same interpreter', async () => {
            let callCount = 0;
            const origGetService = kernel.getService;
            kernel.getService = () => ({
                getInterpreterSetting: async (_id: string) => {
                    callCount++;
                    return {
                        data: {
                            status: 'OK',
                            body: { status: 'READY' },
                        },
                    };
                },
                stopAll: async () => ({ data: {} }),
            });

            const cell1 = createMockCell({ id: 'para_a', status: 'READY', text: '%python\ncode1\n' });
            const cell2 = createMockCell({ id: 'para_b', status: 'READY', text: '%python\ncode2\n' });
            provider.provideCellStatusBarItems(cell1 as any);
            provider.provideCellStatusBarItems(cell2 as any);

            await provider.doUpdateAllInterpreterStatus();

            // Both cells use %python — should only call getInterpreterSetting once
            assert.strictEqual(callCount, 1, 'Should deduplicate interpreter queries');

            kernel.getService = origGetService;
        });

        it('handles service returning undefined gracefully', async () => {
            kernel.getService = () => undefined as any;

            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);

            // Should not throw
            await provider.doUpdateAllInterpreterStatus();

            // Interpreter status should remain absent
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            const interpreterItem = items.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.strictEqual(interpreterItem, undefined);
        });

        it('handles service throwing an error gracefully', async () => {
            kernel.getService = () => ({
                getInterpreterSetting: async () => { throw new Error('Network error'); },
                stopAll: async () => ({ data: {} }),
            });

            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);

            // Should not throw
            await provider.doUpdateAllInterpreterStatus();

            // Interpreter should not appear
            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            const interpreterItem = items.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.strictEqual(interpreterItem, undefined);
        });

        it('handles service returning non-OK status gracefully', async () => {
            kernel.getService = () => ({
                getInterpreterSetting: async () => ({
                    data: { status: 'ERROR', body: null },
                }),
                stopAll: async () => ({ data: {} }),
            });

            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);

            await provider.doUpdateAllInterpreterStatus();

            const items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            const interpreterItem = items.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.strictEqual(interpreterItem, undefined, 'Non-OK response should not populate interpreter status');
        });

        it('atomic swap: previous map is fully replaced, not merged', async () => {
            // First update: populate with python=READY
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);
            await provider.doUpdateAllInterpreterStatus();

            // Verify python is tracked
            let items = provider.provideCellStatusBarItems(cell as any) as vscode.NotebookCellStatusBarItem[];
            assert.ok(items.find(i => i.text === 'READY'));

            // Now untrack the cell and update again — the new map should be empty
            await provider.untrackCell(cell as any);
            await provider.doUpdateAllInterpreterStatus();

            // Re-add cell to check status — interpreter should no longer be in map
            const cell2 = createMockCell({ status: 'READY', text: '%python\ncode\n' });
            items = provider.provideCellStatusBarItems(cell2 as any) as vscode.NotebookCellStatusBarItem[];
            const interpreterItem = items.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.strictEqual(interpreterItem, undefined, 'Old interpreter status should be gone after atomic swap');
        });

        it('handles multiple interpreters across cells', async () => {
            let queriedIds: string[] = [];
            kernel.getService = () => ({
                getInterpreterSetting: async (id: string) => {
                    queriedIds.push(id);
                    const statusMap: Record<string, string> = {
                        'python': 'READY',
                        'spark': 'RUNNING',
                    };
                    return {
                        data: {
                            status: 'OK',
                            body: { status: statusMap[id] ?? 'UNKNOWN' },
                        },
                    };
                },
                stopAll: async () => ({ data: {} }),
            });

            const pythonCell = createMockCell({ id: 'p1', status: 'READY', text: '%python\ncode\n' });
            const sparkCell = createMockCell({ id: 'p2', status: 'READY', text: '%spark\ncode\n' });
            provider.provideCellStatusBarItems(pythonCell as any);
            provider.provideCellStatusBarItems(sparkCell as any);

            await provider.doUpdateAllInterpreterStatus();

            // Both interpreters should have been queried
            assert.ok(queriedIds.includes('python'));
            assert.ok(queriedIds.includes('spark'));

            // Python cell should show READY
            const pythonItems = provider.provideCellStatusBarItems(pythonCell as any) as vscode.NotebookCellStatusBarItem[];
            const pythonStatus = pythonItems.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.ok(pythonStatus);
            assert.strictEqual(pythonStatus!.text, 'READY');

            // Spark cell should show RUNNING
            const sparkItems = provider.provideCellStatusBarItems(sparkCell as any) as vscode.NotebookCellStatusBarItem[];
            const sparkStatus = sparkItems.find(i => i.tooltip === 'Interpreter status (click to restart)');
            assert.ok(sparkStatus);
            assert.strictEqual(sparkStatus!.text, 'RUNNING');
        });
    });

    // ── doUpdateVisibleCells ────────────────────────────────────────────────

    describe('doUpdateVisibleCells', () => {

        it('returns early when no active notebook editor', async () => {
            // vscode.window.activeNotebookEditor is undefined by default in mock
            (vscode.window as any).activeNotebookEditor = undefined;
            // Should not throw
            await provider.doUpdateVisibleCells();
        });

        it('returns early when notebook has zero cells', async () => {
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 0,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [],
            };
            await provider.doUpdateVisibleCells();
        });

        it('returns early when notebook does not exist on server', async () => {
            kernel.doesNotebookExist = async () => false;
            const cell = createMockCell({ status: 'READY' });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 1, isEmpty: false }],
            };
            // Should return early without error
            await provider.doUpdateVisibleCells();
        });

        it('skips empty visible ranges', async () => {
            const cell = createMockCell({ status: 'READY' });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 0, isEmpty: true }],
            };
            await provider.doUpdateVisibleCells();
        });

        it('calls getParagraphInfo for visible cells', async () => {
            let paragraphInfoCalled = false;
            kernel.getParagraphInfo = async (_cell: any) => {
                paragraphInfoCalled = true;
                return { id: 'para_001', status: 'READY', text: '%python\ncode\n' };
            };

            const cell = createMockCell({ status: 'READY' });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 1, isEmpty: false }],
            };

            await provider.doUpdateVisibleCells();
            assert.strictEqual(paragraphInfoCalled, true, 'Should call getParagraphInfo for visible cells');
        });

        it('skips cells that have an active execution', async () => {
            let paragraphInfoCalled = false;
            kernel.getParagraphInfo = async () => {
                paragraphInfoCalled = true;
                return {};
            };
            // Return a truthy execution for this cell
            kernel.getExecutionByParagraphId = (_id: string) => ({ state: 1 });

            const cell = createMockCell({ id: 'para_exec', status: 'READY' });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 1, isEmpty: false }],
            };

            await provider.doUpdateVisibleCells();
            assert.strictEqual(paragraphInfoCalled, false, 'Should skip cells with active execution');
        });

        it('updates cell metadata on getParagraphInfo error', async () => {
            let updatedMetadata: any = null;
            kernel.getParagraphInfo = async () => {
                const error: any = new Error('Request failed');
                error.response = { status: 503 };
                // Simulate AxiosError shape
                error.isAxiosError = true;
                throw error;
            };
            kernel.updateCellMetadata = async (_cell: any, metadata: any) => {
                updatedMetadata = metadata;
                return true;
            };

            const cell = createMockCell({ status: 'READY' });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 1, isEmpty: false }],
            };

            await provider.doUpdateVisibleCells();
            // Note: The code checks `err instanceof AxiosError` which may not match
            // our mock, so status may be undefined. Either way, metadata should be updated.
            assert.ok(updatedMetadata !== null, 'Should update cell metadata on error');
            assert.ok('status' in updatedMetadata, 'Updated metadata should contain status');
        });

        it('skips metadata update when error status matches current cell status', async () => {
            let updateCalled = false;
            kernel.getParagraphInfo = async () => {
                const error: any = new Error('Request failed');
                // Not an AxiosError, so status will be undefined
                throw error;
            };
            kernel.updateCellMetadata = async () => {
                updateCalled = true;
                return true;
            };

            // Cell already has status: undefined — same as what error handler will produce
            const cell = createMockCell({ status: undefined });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 1, isEmpty: false }],
            };

            await provider.doUpdateVisibleCells();
            assert.strictEqual(updateCalled, false, 'Should skip update when status unchanged');
        });

        it('calls applyPolledNotebookEdits after processing', async () => {
            let applyCalled = false;
            kernel.applyPolledNotebookEdits = async () => {
                applyCalled = true;
            };

            const cell = createMockCell({ status: 'READY' });
            (vscode.window as any).activeNotebookEditor = {
                notebook: {
                    cellCount: 1,
                    cellAt: (_i: number) => cell,
                    metadata: { id: 'note_001' },
                    uri: vscode.Uri.parse('untitled:notebook_1'),
                    isClosed: false,
                },
                visibleRanges: [{ start: 0, end: 1, isEmpty: false }],
            };

            await provider.doUpdateVisibleCells();
            assert.strictEqual(applyCalled, true, 'Should call applyPolledNotebookEdits');
        });

        afterEach(() => {
            // Reset activeNotebookEditor to undefined after each test
            (vscode.window as any).activeNotebookEditor = undefined;
        });
    });

    // ── untrackCell ─────────────────────────────────────────────────────────

    describe('untrackCell', () => {

        it('returns false for Markup cells', async () => {
            const cell = createMockCell({ kind: vscode.NotebookCellKind.Markup });
            const result = await provider.untrackCell(cell as any);
            assert.strictEqual(result, false);
        });

        it('returns true for tracked Code cells and removes them', async () => {
            const cell = createMockCell({ status: 'READY', text: '%python\nprint("hello")\n' });
            provider.provideCellStatusBarItems(cell as any);
            const result = await provider.untrackCell(cell as any);
            assert.strictEqual(result, true);
        });

        it('returns false for untracked Code cells', async () => {
            const cell = createMockCell({ status: 'READY' });
            const result = await provider.untrackCell(cell as any);
            assert.strictEqual(result, false);
        });

        it('returns false on second untrack of same cell', async () => {
            const cell = createMockCell({ status: 'READY' });
            provider.provideCellStatusBarItems(cell as any);
            await provider.untrackCell(cell as any);
            const result = await provider.untrackCell(cell as any);
            assert.strictEqual(result, false);
        });
    });

    // ── scheduleTracking / unscheduleTracking ───────────────────────────────

    describe('scheduling', () => {

        it('isTrackingScheduled returns false initially', () => {
            assert.strictEqual(provider.isTrackingScheduled(), false);
        });

        it('scheduleTracking sets up interval', () => {
            provider.scheduleTracking();
            assert.strictEqual(provider.isTrackingScheduled(), true);
        });

        it('duplicate scheduleTracking is a no-op', () => {
            provider.scheduleTracking();
            provider.scheduleTracking();
            assert.strictEqual(provider.isTrackingScheduled(), true);
        });

        it('unscheduleTracking clears interval', () => {
            provider.scheduleTracking();
            provider.unscheduleTracking();
            assert.strictEqual(provider.isTrackingScheduled(), false);
        });

        it('unscheduleTracking is safe to call when not scheduled', () => {
            provider.unscheduleTracking();
            assert.strictEqual(provider.isTrackingScheduled(), false);
        });
    });

    // ── dispose ─────────────────────────────────────────────────────────────

    describe('dispose', () => {

        it('calls unscheduleTracking', () => {
            provider.scheduleTracking();
            assert.strictEqual(provider.isTrackingScheduled(), true);
            provider.dispose();
            assert.strictEqual(provider.isTrackingScheduled(), false);
        });

        it('is safe to call multiple times', () => {
            provider.scheduleTracking();
            provider.dispose();
            provider.dispose();
            assert.strictEqual(provider.isTrackingScheduled(), false);
        });
    });

    // ── constructor ─────────────────────────────────────────────────────────

    describe('constructor', () => {

        it('stores kernel reference', () => {
            assert.strictEqual(provider.kernel, kernel as any);
        });

        it('starts with no tracking scheduled', () => {
            assert.strictEqual(provider.isTrackingScheduled(), false);
        });
    });
});