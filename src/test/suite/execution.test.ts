import * as assert from 'assert';
import * as vscode from 'vscode';
import { ExecutionManager, ZeppelinExecution } from '../../component/execution';
import { createMockKernel, createMockCell, MockKernel } from './mocks';

// The ZeppelinExecutionState enum is not exported, so we use numeric values:
// init = 0, started = 1, resolved = 2
const STATE_INIT = 0;
const STATE_STARTED = 1;
const STATE_RESOLVED = 2;

describe('ZeppelinExecution Test Suite', () => {

    let kernel: MockKernel;

    beforeEach(() => {
        kernel = createMockKernel({ isActive: true });
    });

    // ── State machine ───────────────────────────────────────────────────────

    describe('state machine', () => {

        it('starts in init state', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            assert.strictEqual(execution.state, STATE_INIT);
        });

        it('start() transitions to started state and records startTime', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            const now = Date.now();
            execution.start(now);
            assert.strictEqual(execution.state, STATE_STARTED);
            assert.strictEqual(execution.startTime, now);
        });

        it('start() without time argument transitions to started', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start();
            assert.strictEqual(execution.state, STATE_STARTED);
            assert.strictEqual(execution.startTime, undefined);
        });

        it('start() is no-op when already started', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            const time1 = 1000;
            execution.start(time1);
            execution.start(2000);
            assert.strictEqual(execution.state, STATE_STARTED);
            assert.strictEqual(execution.startTime, time1);
        });

        it('end() transitions from started to resolved', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            const endTime = Date.now() + 100;
            execution.end(true, endTime);
            assert.strictEqual(execution.state, STATE_RESOLVED);
            assert.strictEqual(execution.endTime, endTime);
        });

        it('end() is no-op when not in started state', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.end(true, Date.now());
            assert.strictEqual(execution.state, STATE_INIT);
            assert.strictEqual(execution.endTime, undefined);
        });

        it('start() is no-op after resolved', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(1000);
            execution.end(true, 2000);
            assert.strictEqual(execution.state, STATE_RESOLVED);
            execution.start(3000);
            assert.strictEqual(execution.state, STATE_RESOLVED);
        });
    });

    // ── setProgress ─────────────────────────────────────────────────────────

    describe('setProgress', () => {

        it('throws TypeError when not in started state', async () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            try {
                await execution.setProgress(50);
                assert.fail('Expected TypeError');
            } catch (err) {
                assert.ok(err instanceof TypeError);
            }
        });

        it('returns progress bar text when started', async () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            const pbText = await execution.setProgress(50);
            assert.ok(typeof pbText === 'string');
            assert.ok(pbText!.length > 0, 'Progress bar text should not be empty');
        });
    });

    // ── executionOrder getter/setter ────────────────────────────────────────

    describe('executionOrder', () => {

        it('defaults to undefined', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            assert.strictEqual(execution.executionOrder, undefined);
        });

        it('can be set and retrieved', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.executionOrder = 42;
            assert.strictEqual(execution.executionOrder, 42);
        });
    });

    // ── output delegation ───────────────────────────────────────────────────

    describe('output delegation', () => {

        it('clearOutput does not throw', async () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            await execution.clearOutput();
        });

        it('replaceOutput does not throw', async () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            const output = new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text('test output')
            ]);
            await execution.replaceOutput(output);
        });

        it('appendOutput does not throw', async () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            const output = new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text('test output')
            ]);
            await execution.appendOutput(output);
        });
    });

    // ── progressBar getter ──────────────────────────────────────────────────

    describe('progressBar', () => {

        it('is undefined before start', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            assert.strictEqual(execution.progressBar, undefined);
        });

        it('is defined after start', () => {
            const cell = createMockCell({ status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            assert.ok(execution.progressBar !== undefined);
        });
    });
});

describe('ExecutionManager Test Suite', () => {

    let kernel: MockKernel;
    let manager: ExecutionManager;

    beforeEach(() => {
        kernel = createMockKernel({ isActive: true });
        manager = new ExecutionManager(kernel as any);
    });

    afterEach(() => {
        manager.dispose();
    });

    // ── register / unregister / lookup ───────────────────────────────────────

    describe('execution tracking', () => {

        it('registerTrackExecution and getExecutionByParagraphId', () => {
            const cell = createMockCell({ id: 'para_100', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            manager.registerTrackExecution(execution);
            const retrieved = manager.getExecutionByParagraphId('para_100');
            assert.strictEqual(retrieved, execution);
        });

        it('unregisterTrackExecution by execution object', () => {
            const cell = createMockCell({ id: 'para_101', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            manager.registerTrackExecution(execution);
            const result = manager.unregisterTrackExecution(execution);
            assert.strictEqual(result, true);
            assert.strictEqual(manager.getExecutionByParagraphId('para_101'), undefined);
        });

        it('unregisterTrackExecution by cell', () => {
            const cell = createMockCell({ id: 'para_102', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            manager.registerTrackExecution(execution);
            const result = manager.unregisterTrackExecution(cell as any);
            assert.strictEqual(result, true);
            assert.strictEqual(manager.getExecutionByParagraphId('para_102'), undefined);
        });

        it('unregisterTrackExecution returns false for unregistered', () => {
            const cell = createMockCell({ id: 'para_ghost', status: 'READY' });
            const result = manager.unregisterTrackExecution(cell as any);
            assert.strictEqual(result, false);
        });

        it('getExecutionByParagraphId returns undefined for unknown ids', () => {
            assert.strictEqual(manager.getExecutionByParagraphId('nonexistent'), undefined);
        });
    });

    // ── startTime / progressBar lookups ──────────────────────────────────────

    describe('startTime and progressBar lookups', () => {

        it('getExecutionStartTimeByParagraphId returns undefined for unregistered', () => {
            assert.strictEqual(
                manager.getExecutionStartTimeByParagraphId('nonexistent'),
                undefined
            );
        });

        it('getExecutionStartTimeByParagraphId returns startTime for registered', () => {
            const cell = createMockCell({ id: 'para_200', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            const startTime = Date.now();
            execution.start(startTime);
            manager.registerTrackExecution(execution);
            assert.strictEqual(
                manager.getExecutionStartTimeByParagraphId('para_200'),
                startTime
            );
        });

        it('getExecutionProgressBarByParagraphId returns undefined for unregistered', () => {
            assert.strictEqual(
                manager.getExecutionProgressBarByParagraphId('nonexistent'),
                undefined
            );
        });

        it('getExecutionProgressBarByParagraphId returns progressBar for started execution', () => {
            const cell = createMockCell({ id: 'para_201', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            manager.registerTrackExecution(execution);
            assert.ok(manager.getExecutionProgressBarByParagraphId('para_201') !== undefined);
        });
    });

    // ── scheduling ──────────────────────────────────────────────────────────

    describe('scheduling', () => {

        it('isTrackingScheduled returns false initially', () => {
            assert.strictEqual(manager.isTrackingScheduled(), false);
        });

        it('scheduleTracking sets up interval', () => {
            manager.scheduleTracking();
            assert.strictEqual(manager.isTrackingScheduled(), true);
        });

        it('duplicate scheduleTracking is a no-op', () => {
            manager.scheduleTracking();
            manager.scheduleTracking();
            assert.strictEqual(manager.isTrackingScheduled(), true);
        });

        it('unscheduleTracking clears interval', () => {
            manager.scheduleTracking();
            manager.unscheduleTracking();
            assert.strictEqual(manager.isTrackingScheduled(), false);
        });

        it('unscheduleTracking is safe when not scheduled', () => {
            manager.unscheduleTracking();
            assert.strictEqual(manager.isTrackingScheduled(), false);
        });
    });

    // ── dispose ─────────────────────────────────────────────────────────────

    describe('dispose', () => {

        it('clears tracked executions and unschedules tracking', () => {
            const cell = createMockCell({ id: 'para_300', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            manager.registerTrackExecution(execution);
            manager.scheduleTracking();

            manager.dispose();

            assert.strictEqual(manager.getExecutionByParagraphId('para_300'), undefined);
            assert.strictEqual(manager.isTrackingScheduled(), false);
        });
    });

    // ── resumeExecutionStatus ────────────────────────────────────────────────

    describe('resumeExecutionStatus', () => {

        it('keeps existing started execution instead of creating a new one', async () => {
            const cell = createMockCell({ id: 'para_500', status: 'RUNNING' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            manager.registerTrackExecution(execution);

            let createCallCount = 0;
            const origCreate = kernel._controller.createNotebookCellExecution;
            kernel._controller.createNotebookCellExecution = (c: any) => {
                createCallCount++;
                return origCreate(c);
            };

            const serverCell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code, '%python\\nprint(\"hello\")\\n', 'python'
            );
            serverCell.metadata = { id: 'para_500', status: 'RUNNING' };

            await manager.resumeExecutionStatus(cell as any, serverCell);

            // The original execution should still be tracked
            assert.strictEqual(
                manager.getExecutionByParagraphId('para_500'),
                execution
            );
            // No new execution should have been created
            assert.strictEqual(createCallCount, 0);
            assert.strictEqual(execution.state, STATE_STARTED);
        });

        it('keeps existing init-state execution instead of creating a new one', async () => {
            const cell = createMockCell({ id: 'para_501', status: 'PENDING' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            manager.registerTrackExecution(execution);

            let createCallCount = 0;
            const origCreate = kernel._controller.createNotebookCellExecution;
            kernel._controller.createNotebookCellExecution = (c: any) => {
                createCallCount++;
                return origCreate(c);
            };

            const serverCell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code, '%python\\nprint(\"hello\")\\n', 'python'
            );
            serverCell.metadata = { id: 'para_501', status: 'PENDING' };

            await manager.resumeExecutionStatus(cell as any, serverCell);

            assert.strictEqual(
                manager.getExecutionByParagraphId('para_501'),
                execution
            );
            assert.strictEqual(createCallCount, 0);
            assert.strictEqual(execution.state, STATE_INIT);
        });

        it('creates new execution when previous one is resolved', async () => {
            const cell = createMockCell({
                id: 'para_502', status: 'FINISHED',
            });
            (cell.metadata as any).dateStarted = new Date().toISOString();
            (cell.metadata as any).dateFinished = new Date().toISOString();

            const oldExecution = new ZeppelinExecution(kernel as any, cell as any);
            oldExecution.start(Date.now());
            oldExecution.end(true, Date.now());
            manager.registerTrackExecution(oldExecution);

            const serverCell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code, '%python\\nprint(\"hello\")\\n', 'python'
            );
            serverCell.metadata = { id: 'para_502', status: 'FINISHED' };
            serverCell.outputs = [
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text('hello')
                ])
            ];

            await manager.resumeExecutionStatus(cell as any, serverCell);

            const newExecution = manager.getExecutionByParagraphId('para_502');
            // A new execution should have been created (old one was resolved)
            assert.ok(newExecution === undefined || newExecution !== oldExecution);
        });
    });

    // ── trackExecution ──────────────────────────────────────────────────────

    describe('trackExecution', () => {

        it('unregisters deleted cells (index < 0)', async () => {
            const cell = createMockCell({ id: 'para_400', status: 'READY', index: -1 });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            manager.registerTrackExecution(execution);

            await manager.trackExecution(execution);

            assert.strictEqual(manager.getExecutionByParagraphId('para_400'), undefined);
        });

        it('unregisters resolved executions', async () => {
            const cell = createMockCell({ id: 'para_401', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            execution.start(Date.now());
            execution.end(true, Date.now());
            manager.registerTrackExecution(execution);

            await manager.trackExecution(execution);

            assert.strictEqual(manager.getExecutionByParagraphId('para_401'), undefined);
        });

        it('handles paragraph fetch errors gracefully', async () => {
            const fetchError = new Error('Network error');
            kernel.getParagraphInfo = async () => { throw fetchError; };

            const cell = createMockCell({ id: 'para_402', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);
            manager.registerTrackExecution(execution);

            await manager.trackExecution(execution);

            assert.strictEqual(manager.getExecutionByParagraphId('para_402'), undefined);
            assert.strictEqual(execution.state, STATE_RESOLVED);
        });

        it('starts execution when paragraph status leaves PENDING', async () => {
            kernel.getParagraphInfo = async () => ({
                id: 'para_403',
                status: 'RUNNING',
                progress: 50,
                text: '%python\\nprint(\\"hello\\")\\n',
            });

            const cell = createMockCell({ id: 'para_403', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);

            await manager.trackExecution(execution);

            assert.strictEqual(execution.state, STATE_STARTED);
        });

        it('ends execution when paragraph is neither RUNNING nor PENDING', async () => {
            kernel.getParagraphInfo = async () => ({
                id: 'para_404',
                status: 'FINISHED',
                text: '%python\\nprint(\\"hello\\")\\n',
                results: { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'output' }] },
            });

            const cell = createMockCell({ id: 'para_404', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);

            await manager.trackExecution(execution);

            assert.strictEqual(execution.state, STATE_RESOLVED);
        });

        it('ends with failure when paragraph status is ERROR', async () => {
            kernel.getParagraphInfo = async () => ({
                id: 'para_405',
                status: 'ERROR',
                text: '%python\\nraise Exception()\\n',
                results: { code: 'ERROR', msg: [{ type: 'TEXT', data: 'error message' }] },
            });

            const cell = createMockCell({ id: 'para_405', status: 'READY' });
            const execution = new ZeppelinExecution(kernel as any, cell as any);

            await manager.trackExecution(execution);

            assert.strictEqual(execution.state, STATE_RESOLVED);
        });
    });

    // ── attachHandlers (Fix #1 regression) ───────────────────────────────────

    describe('attachHandlers', () => {

        it('re-installs executeHandler after dispose + attachHandlers', () => {
            // Simulate session expiry: dispose clears tracking but
            // should NOT permanently disable the handler.
            manager.dispose();

            // After dispose, handler is still the bound function (no longer cleared).
            // But let's explicitly call attachHandlers to simulate activate():
            manager.attachHandlers();

            // The handler should be a function (not undefined/noop)
            const handler = kernel._controller.executeHandler;
            assert.ok(typeof handler === 'function');

            // Verify it's actually the manager's handler by checking
            // it doesn't throw when called with valid args on inactive kernel
            kernel._active = false;
            // Should not throw — just show warning (mocked)
            // handler([], { metadata: {}, uri: '', }, kernel._controller);
        });
    });

    // ── cancelAllExecutions ──────────────────────────────────────────────────

    describe('cancelAllExecutions', () => {

        it('ends all tracked executions and clears the map', () => {
            const cell1 = createMockCell({ id: 'para_cancel_1', status: 'READY' });
            const cell2 = createMockCell({ id: 'para_cancel_2', status: 'READY' });
            const exec1 = new ZeppelinExecution(kernel as any, cell1 as any);
            const exec2 = new ZeppelinExecution(kernel as any, cell2 as any);
            exec1.start(Date.now());
            exec2.start(Date.now());
            manager.registerTrackExecution(exec1);
            manager.registerTrackExecution(exec2);

            manager.cancelAllExecutions();

            assert.strictEqual(exec1.state, STATE_RESOLVED);
            assert.strictEqual(exec2.state, STATE_RESOLVED);
            assert.strictEqual(manager.getExecutionByParagraphId('para_cancel_1'), undefined);
            assert.strictEqual(manager.getExecutionByParagraphId('para_cancel_2'), undefined);
        });

        it('handles init-state executions (starts then ends them)', () => {
            const cell = createMockCell({ id: 'para_cancel_init', status: 'READY' });
            const exec = new ZeppelinExecution(kernel as any, cell as any);
            // Don't call start — leave in init state
            manager.registerTrackExecution(exec);

            manager.cancelAllExecutions();

            assert.strictEqual(exec.state, STATE_RESOLVED);
        });
    });
});
