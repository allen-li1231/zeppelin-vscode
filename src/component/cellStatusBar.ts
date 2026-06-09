import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { logDebug } from '../common/common';
import { Mutex } from './mutex';
import { parseCellInterpreter } from '../common/parser';


export class CellStatusProvider implements vscode.NotebookCellStatusBarItemProvider {
    private _mapInterpreterStatus = new Map<string, string>();
    private _setCell = new Set<vscode.NotebookCell>();
    public kernel: ZeppelinKernel;
    private readonly _cellStatusUpdateMutex = new Mutex("_cellStatusUpdate");
    // boolean flag to replace TOCTOU isLocked() check
    private _isUpdatingStatus = false;
    private _timerUpdateCellStatus?: ReturnType<typeof setInterval>;

    constructor(kernel: ZeppelinKernel) {
        this.kernel = kernel;
        // caller should use scheduleTracking() when the kernel is active
    }

    onDidChangeCellStatusBarItems?: vscode.Event<void> | undefined;

    provideCellStatusBarItems(cell: vscode.NotebookCell):
        vscode.ProviderResult<vscode.NotebookCellStatusBarItem | vscode.NotebookCellStatusBarItem[]> {

        if (!this.kernel.isActive() || cell.kind === vscode.NotebookCellKind.Markup) {
            return [];
        }

        this._setCell.add(cell);
        const items: vscode.NotebookCellStatusBarItem[] = [];

        // Show sync conflict indicator if present
        if (cell.metadata.syncConflict !== undefined) {
            const conflictItem = new vscode.NotebookCellStatusBarItem(
                '$(diff) Remote Changed',
                vscode.NotebookCellStatusBarAlignment.Right,
            );
            conflictItem.command = <vscode.Command> {
                title: '$(diff) Remote Changed',
                command: 'zeppelin-vscode.showCellDiff',
                arguments: [cell],
            };
            conflictItem.tooltip = `Cell differs from server (click to view diff)`;
            items.push(conflictItem);

            const acceptItem = new vscode.NotebookCellStatusBarItem(
                '$(check)',
                vscode.NotebookCellStatusBarAlignment.Right,
            );
            acceptItem.command = <vscode.Command> {
                title: '$(check) Accept Remote',
                command: 'zeppelin-vscode.acceptRemoteCell',
                arguments: [cell],
            };
            acceptItem.tooltip = `Accept remote version of this cell`;
            items.push(acceptItem);
        }

        // status === string: normal status
        // status === undefined: cannot reach remote server
        // status === number: remote server responds with problem
        if (typeof cell.metadata.status !== 'string') {
            if (cell.metadata.status === 404) {
                const item = new vscode.NotebookCellStatusBarItem(
                    '$(warning)',
                    vscode.NotebookCellStatusBarAlignment.Right,
                );
                item.command = <vscode.Command> {
                    title: '$(warning)',
                    command: 'zeppelin-vscode.createMissingParagraph',
                    arguments: [cell],
                };
                item.tooltip = `Remote paragraph doesn't exist (click to create)`;
                items.push(item);
            }
            else {
                const item = new vscode.NotebookCellStatusBarItem(
                    '$(debug-disconnect)',
                    vscode.NotebookCellStatusBarAlignment.Right,
                );
                if (cell.metadata.status === undefined) {
                    item.tooltip = `Sync pending`;
                }
                else {
                    item.tooltip = `Sync pending (${cell.metadata.status})`;
                }
                return [item];
            }
        }

        let interpreterId = parseCellInterpreter(cell);
        if (interpreterId === undefined) {
            return items;
        }

        let status = this._mapInterpreterStatus.get(interpreterId);
        if (status === undefined) {
            return items;
        }
        const item = new vscode.NotebookCellStatusBarItem(
            status, vscode.NotebookCellStatusBarAlignment.Right,
        );
        item.command = <vscode.Command> {
            title: status,
            command: 'zeppelin-vscode.restartInterpreter',
            arguments: [interpreterId],
        };
        item.tooltip = `Interpreter status (click to restart)`;
        items.push(item);

        return items;
    }

    private async _updateInterpreterStatus(
        interpreterId: string,
        targetMap: Map<string, string>
    ) {
        try{
            var res = await this.kernel.getService()?.getInterpreterSetting(interpreterId);
        }
        catch (error) {
            logDebug(`error in _updateInterpreterStatus for '${interpreterId}'`);
            return undefined;
        }

        if (res === undefined || res.data === undefined || res.data.status !== 'OK') {
            return undefined;
        }

        const status: string = res.data.body.status;
        targetMap.set(interpreterId, status);
        return status;
    }

    public async doUpdateAllInterpreterStatus() {
        // use a synchronous boolean flag instead of TOCTOU isLocked() check
        if (this._isUpdatingStatus) {
            return;
        }
        this._isUpdatingStatus = true;

        return this._cellStatusUpdateMutex.runExclusive(async () => {
            try {
                // build a new map and swap atomically instead of
                // clear-and-repopulate in place, so provideCellStatusBarItems()
                // never sees a partially-populated map
                const newMap = new Map<string, string>();

                // It is safe to add elements or remove elements to a set while iterating it.
                // Supported in JavaScript 2015 (ES6)
                for (let cell of this._setCell) {
                    if (cell.document.isClosed || cell.notebook.isClosed) {
                        this._setCell.delete(cell);
                        continue;
                    }

                    let interpreterId = parseCellInterpreter(cell);
                    if (interpreterId === undefined) {
                        continue;
                    }

                    if (!newMap.has(interpreterId)) {
                        await this._updateInterpreterStatus(interpreterId, newMap);
                    }
                }

                // Atomic swap — provideCellStatusBarItems() always sees
                // either the old complete map or the new complete map
                this._mapInterpreterStatus = newMap;
            } finally {
                this._isUpdatingStatus = false;
            }
        });
    }

    public async untrackCell(cell: vscode.NotebookCell) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            return false;
        }
        return this._setCell.delete(cell);
    }

    public async doUpdateVisibleCells() {
        const activeNotebook = vscode.window.activeNotebookEditor;
        if (activeNotebook !== undefined) {
            const t = await this.kernel.doesNotebookExist(activeNotebook.notebook);
            logDebug(t);
        }
        if (activeNotebook === undefined
            || activeNotebook.notebook.cellCount === 0
            || !(await this.kernel.doesNotebookExist(activeNotebook.notebook))) {
            return;
        }
            logDebug("doUpdateVisibleCells: updating", activeNotebook.visibleRanges);

        for (let range of activeNotebook.visibleRanges) {
            if (range.isEmpty) {
                continue;
            }

            for (let i = range.start; i < range.end; i ++) {
                let cell = activeNotebook?.notebook.cellAt(i);
                let execution = this.kernel.getExecutionByParagraphId(cell.metadata.id);
                if (cell === undefined
                    || execution !== undefined
                    || i < activeNotebook.visibleRanges[0].start
                    || i >= activeNotebook.visibleRanges[0].end)
                {
                    continue;
                }
                try {
                    await this.kernel.getParagraphInfo(cell);
                }
                catch (err) {
                    let status = err instanceof AxiosError
                        ? err.response?.status
                        : undefined;
                    if (status === cell.metadata.status) {
                        // ignore the same error
                        continue;
                    }
                    logDebug("error in doUpdateVisibleCells:" + err);
                    // trigger cell status bar update

                    await this.kernel.editWithoutParagraphUpdate(async () => {
                        await this.kernel.updateCellMetadata(
                            cell, {"status": status}
                        );
                    });
                }
            }
        }
        // Apply all polled edits after processing all visible ranges
        await this.kernel.applyPolledNotebookEdits();
    }

    public isTrackingScheduled() {
        return this._timerUpdateCellStatus !== undefined;
    }

    public scheduleTracking() {
        if (this.isTrackingScheduled()) {
            logDebug("cellStatusBar omits duplicated scheduling");
            return;
        }

        const trackInterval = vscode.workspace.getConfiguration('zeppelin')
            .get('interpreter.trackInterval', 5);
        this._timerUpdateCellStatus = setInterval(
            this.doUpdateAllInterpreterStatus.bind(this),
            trackInterval * 1000
        );
    }

    public unscheduleTracking() {
        if (this.isTrackingScheduled()) {
            clearInterval(this._timerUpdateCellStatus);
            this._timerUpdateCellStatus = undefined;
        }
    }

    public dispose() {
        this.unscheduleTracking();
    }
}