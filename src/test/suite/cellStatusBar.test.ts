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
            assert.ok((items as any[]).length >= 2,
                `Expected at least 2 items, got ${(items as any[]).length}`);

            const diffItem = (items as vscode.NotebookCellStatusBarItem[])[0];
            assert.ok(diffItem.text.includes('Remote Changed'));

            const acceptItem = (items as vscode.NotebookCellStatusBarItem[])[1];
            assert.ok(acceptItem.text.includes('$(check)'));
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
    });
});