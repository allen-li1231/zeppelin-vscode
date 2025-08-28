import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { reInterpreter, logDebug } from '../common/common';
import { Mutex } from './mutex';
import { parseParagraphToCellData } from '../common/parser';


export class CellStatusProvider implements vscode.NotebookCellStatusBarItemProvider {
    private _mapInterpreterStatus = new Map<string, [number, string]>();
    private _setCell = new Set<vscode.NotebookCell>();
    public kernel: ZeppelinKernel;
    private readonly _cellStatusUpdateMutex = new Mutex("_cellStatusUpdate");
    private _timerUpdateCellStatus: NodeJS.Timer;

    constructor(kernel: ZeppelinKernel) {
        this.kernel = kernel;

        const trackInterval = vscode.workspace.getConfiguration('zeppelin')
            .get('interpreter.trackInterval', 5);
        this._timerUpdateCellStatus = setInterval(
            this.doUpdateAllInterpreterStatus.bind(this),
            trackInterval * 1000
        );
    }

    onDidChangeCellStatusBarItems?: vscode.Event<void> | undefined;

    provideCellStatusBarItems(cell: vscode.NotebookCell):
        vscode.ProviderResult<vscode.NotebookCellStatusBarItem | vscode.NotebookCellStatusBarItem[]> {

        if (!this.kernel.isActive() || cell.kind === vscode.NotebookCellKind.Markup) {
            return [];
        }
        logDebug("before update CellStatusBar");
        this._setCell.add(cell);
        const items: vscode.NotebookCellStatusBarItem[] = [];

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

        let interpreterId = this._parseCellInterpreter(cell);
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

    private _parseCellInterpreter(cell: vscode.NotebookCell) {
        let interpreterIds = cell.document.getText().match(reInterpreter);
        if (interpreterIds === null || interpreterIds.length === 0) {
            return undefined;
        }

        let interpreterId = interpreterIds[1];
        let rootIdx = interpreterId.indexOf('.');
        interpreterId = rootIdx > 0 ? interpreterId.slice(0, rootIdx) : interpreterId;
        return interpreterId;
    }

    private async _updateInterpreterStatus(interpreterId: string) {
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
        this._mapInterpreterStatus.set(interpreterId, [Date.now(), status]);
        return status;
    }

    public async doUpdateAllInterpreterStatus() {
        return this._cellStatusUpdateMutex.runExclusive(async () => {
            // It is safe to add elements or remove elements to a set while iterating it.
            // Supported in JavaScript 2015 (ES6)
            this._mapInterpreterStatus.clear();
            for (let cell of this._setCell) {
                if (cell.document.isClosed || cell.notebook.isClosed) {
                    this._setCell.delete(cell);
                    continue;
                }

                let interpreterId = this._parseCellInterpreter(cell);
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

    public async doUpdateVisibleCells() {
        const activeNotebook = vscode.window.activeNotebookEditor;
        if (activeNotebook === undefined
            || activeNotebook.notebook.cellCount === 0
            || !await this.kernel.doesNotebookExist(activeNotebook.notebook)) {
            return;
        }
        return this.kernel.editWithoutParagraphUpdate(async () => {
            logDebug("_doUpdateVisibleCells: updating", activeNotebook.visibleRanges);

            for (let range of activeNotebook.visibleRanges) {
                if (range.isEmpty) {
                    continue;
                }

                for (let i = range.start; i < range.end; i ++) {
                    let cell = activeNotebook?.notebook.cellAt(i);
                    let execution = this.kernel.getExecutionByParagraphId(cell.metadata.id);
                    if (cell === undefined 
                        || execution !== undefined
                        || i >= activeNotebook.selection?.start
                        && i < activeNotebook.selection?.end) {
                        continue;
                    }
                    try {
                        let paragraph = await this.kernel.getParagraphInfo(cell);
                        let parsedCell = parseParagraphToCellData(paragraph);
                        if (parsedCell.metadata !== undefined) {
                            // trigger cell status bar update
                            await this.kernel.updateCellMetadata(cell, parsedCell.metadata);
                            logDebug("_doUpdateVisibleCells: after update paragraphs");
                        }
                    }
                    catch (err) {
                        let status = err instanceof AxiosError ? err.response?.status : undefined;
                        if (status === cell.metadata.status) {
                            // ignore the same error
                            continue;
                        }
                        logDebug("error in _doUpdateVisibleCells:" + err);
                        // trigger cell status bar update
                        await this.kernel.updateCellMetadata(cell, {"status": status});
                    }
                }
            }
        });
    }

    public dispose() {
        clearInterval(this._timerUpdateCellStatus);
    }
}