import * as vscode from 'vscode';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { logDebug, getRestartInterpreterId } from '../common/common';
import { Mutex } from './mutex';
import { parseCellInterpreter } from '../common/parser';
import { AIModeManager } from './aiMode';


export class CellStatusProvider implements vscode.NotebookCellStatusBarItemProvider {
    private _mapInterpreterStatus = new Map<string, [number, string]>();
    private _setCell = new Set<vscode.NotebookCell>();
    public kernel: ZeppelinKernel;
    private readonly _cellStatusUpdateMutex = new Mutex("_cellStatusUpdate");
    private readonly _onDidChange = new vscode.EventEmitter<void>();

    constructor(kernel: ZeppelinKernel) {
        this.kernel = kernel;
    }

    onDidChangeCellStatusBarItems: vscode.Event<void> = this._onDidChange.event;

    /** Call to refresh cell status bar (e.g. after AI Mode selection change). */
    refresh(): void {
        this._onDidChange.fire();
    }

    provideCellStatusBarItems(cell: vscode.NotebookCell):
        vscode.ProviderResult<vscode.NotebookCellStatusBarItem | vscode.NotebookCellStatusBarItem[]> {

        if (cell.kind === vscode.NotebookCellKind.Markup) {
            return [];
        }
        logDebug("before update CellStatusBar");
        this._setCell.add(cell);
        const items: vscode.NotebookCellStatusBarItem[] = [];

        const isSelected = AIModeManager.getSelectedCells().some(c => c === cell);
        const selectItem = new vscode.NotebookCellStatusBarItem(
            isSelected ? '🟢 Selected for AI Mode' : '○ Select for AI Mode',
            vscode.NotebookCellStatusBarAlignment.Left,
        );
        selectItem.command = {
            title: isSelected ? 'Deselect' : 'Select for AI Mode',
            command: 'zeppelin-vscode.selectCellForAIMode',
            arguments: [cell],
        };
        selectItem.tooltip = isSelected
            ? 'Selected for AI Mode (click to deselect)'
            : 'Click to select this cell for AI Mode';
        items.push(selectItem);

        // Only show other status items if kernel is active
        if (!this.kernel.isActive()) {
            return items;
        }

        // Add copy cell content button
        const copyItem = new vscode.NotebookCellStatusBarItem(
            '$(copy)',
            vscode.NotebookCellStatusBarAlignment.Right,
        );
        copyItem.command = <vscode.Command> {
            title: '$(copy)',
            command: 'zeppelin-vscode.copyCellContent',
            arguments: [cell],
        };
        copyItem.tooltip = 'Copy cell content to clipboard';
        items.push(copyItem);

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
                    item.tooltip = `Pending to sync`;
                }
                else{
                    item.tooltip = `Pending to sync (${cell.metadata.status})`;
                }
                return [item];
            }

        }

        let interpreterId = parseCellInterpreter(cell);
        if (interpreterId === undefined) {
            return items;
        }

        let res = this._mapInterpreterStatus.get(interpreterId);
        if (res === undefined) {
            return items;
        }
        let [lastUpdateDate, status] = res;
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

    private async _updateInterpreterStatus(interpreterId: string) {
        // Zeppelin uses group name for interpreter API (e.g. spark for pyspark)
        const apiId = getRestartInterpreterId(interpreterId);
        try{
            var res = await this.kernel.getService()?.getInterpreterSetting(apiId);
        }
        catch (error) {
            logDebug(`error in _updateInterpreterStatus for '${interpreterId}'`);
            return undefined;
        }

        if (res === undefined || res.data === undefined || res.data.status !== 'OK') {
            return undefined;
        }

        const status: string = res.data.body.status;
        this._mapInterpreterStatus.set(interpreterId, [Date.now(), status]);
        return status;
    }

    public async doUpdateAllInterpreterStatus() {
        if (this._cellStatusUpdateMutex.isLocked()){
            return;
        }

        return this._cellStatusUpdateMutex.runExclusive(async () => {
            // It is safe to add elements or remove elements to a set while iterating it.
            // Supported in JavaScript 2015 (ES6)
            this._mapInterpreterStatus.clear();
            for (let cell of this._setCell) {
                if (cell.document.isClosed || cell.notebook.isClosed) {
                    this._setCell.delete(cell);
                    continue;
                }

                let interpreterId = parseCellInterpreter(cell);
                if (interpreterId === undefined) {
                    continue;
                }

                if (!this._mapInterpreterStatus.has(interpreterId)) {
                    await this._updateInterpreterStatus(interpreterId);
                }
            }
        });
    }

    public async untrackCell(cell: vscode.NotebookCell) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            return false;
        }
        return this._setCell.delete(cell);
    }

    /**
     * DISABLED: REST polling for visible cells
     * Now using WebSocket for real-time sync
     * For non-WebSocket notebooks, user can manually refresh
     */
    public async doUpdateVisibleCells() {
        // NO-OP: We no longer poll for cell updates
        // WebSocket notebooks get real-time updates via events
        // Non-WebSocket notebooks don't get automatic updates (use manual refresh)
        logDebug("doUpdateVisibleCells: disabled - using WebSocket events instead");
    }

    public dispose() {
        // No timers to clean up - using WebSocket for sync
    }
}