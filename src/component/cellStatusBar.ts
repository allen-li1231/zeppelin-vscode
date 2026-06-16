import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { logDebug, isLocalNotebookCell } from '../common/common';
import { Mutex } from './mutex';
import { parseCellInterpreter } from '../common/parser';


export class CellStatusProvider implements vscode.NotebookCellStatusBarItemProvider {
    private _mapInterpreterStatus = new Map<string, string>();
    private _setCell = new Set<vscode.NotebookCell>();
    public kernel: ZeppelinKernel;
    private readonly _cellStatusUpdateMutex = new Mutex("_cellStatusUpdate");
    private _timerUpdateCellStatus?: ReturnType<typeof setTimeout>;

    constructor(kernel: ZeppelinKernel) {
        this.kernel = kernel;
        // caller should use scheduleTracking() when the kernel is active
    }

    onDidChangeCellStatusBarItems?: vscode.Event<void> | undefined;

    provideCellStatusBarItems(cell: vscode.NotebookCell):
        vscode.ProviderResult<vscode.NotebookCellStatusBarItem | vscode.NotebookCellStatusBarItem[]> {
        logDebug(`provideCellStatusBarItems check pending paragraph update`,
            this.kernel.hasPendingParagraphUpdate(cell), cell)
        if (!this.kernel.isActive()
            || !isLocalNotebookCell(cell.document.uri)
            // || cell.kind === vscode.NotebookCellKind.Markup
            || this.kernel.isNoteSyncing(cell.notebook)
            || this.kernel.hasPendingParagraphUpdate(cell)) {
            return [];
        }

        this._setCell.add(cell);
        const items: vscode.NotebookCellStatusBarItem[] = [];

        // Show sync conflict indicator if present
        if (cell.metadata.syncConflict !== undefined
            && !this.kernel.editMutex.isLocked()
        ) {
            const conflictItem = new vscode.NotebookCellStatusBarItem(
                cell.metadata.resolvingDiff
                    ? '$(loading~spin) Resolving Diff'
                    : '$(diff) Remote Changed',
                vscode.NotebookCellStatusBarAlignment.Right,
            );
            conflictItem.command = <vscode.Command> {
                title: '$(diff) Remote Changed',
                command: 'zeppelin-vscode.showCellDiff',
                arguments: [cell],
            };
            conflictItem.tooltip = cell.metadata.resolvingDiff
                ? `Resolving sync conflict (click to view diff again)`
                : `Cell differs from server (click to view diff)`;
            items.push(conflictItem);

            const acceptRemoteItem = new vscode.NotebookCellStatusBarItem(
                '$(cloud-download) Accept Remote',
                vscode.NotebookCellStatusBarAlignment.Right,
            );
            acceptRemoteItem.command = <vscode.Command> {
                title: '$(cloud-download) Accept Remote',
                command: 'zeppelin-vscode.acceptRemoteCell',
                arguments: [cell],
            };
            acceptRemoteItem.tooltip = `Accept remote (server) version of this cell`;
            items.push(acceptRemoteItem);

            const acceptLocalItem = new vscode.NotebookCellStatusBarItem(
                '$(cloud-upload) Keep Local',
                vscode.NotebookCellStatusBarAlignment.Right,
            );
            acceptLocalItem.command = <vscode.Command> {
                title: '$(cloud-upload) Keep Local',
                command: 'zeppelin-vscode.acceptLocalCell',
                arguments: [cell],
            };
            acceptLocalItem.tooltip = `Keep local version and push to server`;
            items.push(acceptLocalItem);
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

        let interpreterId = parseCellInterpreter(cell, false);
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
        return this._cellStatusUpdateMutex.runExclusive(async () => {
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

                    let interpreterId = parseCellInterpreter(cell, false);
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
        if (activeNotebook === undefined
            || activeNotebook.notebook.cellCount === 0
            || !(await this.kernel.doesNotebookExist(activeNotebook.notebook))
            || this.kernel.isNoteSyncing(activeNotebook.notebook)) {
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
                    // || cell.kind === vscode.NotebookCellKind.Markup
                    || execution !== undefined
                    || i < activeNotebook.visibleRanges[0].start
                    || i >= activeNotebook.visibleRanges[0].end)
                {
                    continue;
                }
                if (this.kernel.hasPendingParagraphUpdate(cell)) {
                    // Apply all polled edits before processing
                    await this.kernel.updatePollingParagraphsDirect();
                }
                try {
                    let paragraph = await this.kernel.getParagraphInfo(cell);

                    // Detect server-only changes: if the server text differs
                    // from local document text and no conflict is already
                    // flagged, mark a sync conflict so the user sees a
                    // "Remote Changed" indicator without needing to switch
                    // notebooks.
                    // Also clear stale syncConflict markers when the server
                    // and local texts now match (e.g. after "Keep Local").
                    // Skip conflict detection when the cell has a pending
                    // local edit that hasn't been pushed to the server yet,
                    // to avoid false "Remote Changed" indicators after
                    // quick tab switches.
                    if (paragraph !== undefined)
                    {
                        let serverText = paragraph.text ?? '';
                        let localText = cell.document.getText();
                        if (serverText !== localText
                            && cell.metadata.syncConflict?.text !== serverText)
                        {
                            await this.kernel.editWithoutParagraphUpdate(async () => {
                                await this.kernel.updateCellMetadata(cell, {
                                    syncConflict: paragraph
                                });
                            });
                        }
                        else if (serverText === localText
                            && cell.metadata.syncConflict !== undefined)
                        {
                            // Server and local now match — clear the conflict marker
                            // let meta = { ...cell.metadata };
                            // delete meta.syncConflict;
                            // delete meta.resolvingDiff;
                            await this.kernel.editWithoutParagraphUpdate(async () => {
                                await this.kernel.removeCellMetadata(
                                    cell, ["syncConflict", "resolvingDiff"]
                                );
                            });
                        }
                    }
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
        this._scheduleUpdateCellStatus(trackInterval * 1000);
    }

    private _scheduleUpdateCellStatus(intervalMs: number) {
        this._timerUpdateCellStatus = setTimeout(async () => {
            await this.doUpdateAllInterpreterStatus();
            // Only reschedule if not cancelled
            if (this._timerUpdateCellStatus !== undefined) {
                this._scheduleUpdateCellStatus(intervalMs);
            }
        }, intervalMs);
    }

    public unscheduleTracking() {
        if (this.isTrackingScheduled()) {
            clearTimeout(this._timerUpdateCellStatus);
            this._timerUpdateCellStatus = undefined;
        }
    }

    public dispose() {
        this.unscheduleTracking();
    }
}