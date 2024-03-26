import * as vscode from 'vscode';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { reInterpreter } from '../common/common';

export class CellStatusProvider implements vscode.NotebookCellStatusBarItemProvider {
    private _mapInterpreterStatus = new Map<string, [number, string]>();
    private readonly _kernel: ZeppelinKernel;

    constructor(kernel: ZeppelinKernel) {
        this._kernel = kernel;
    }

    onDidChangeCellStatusBarItems?: vscode.Event<void> | undefined;

    provideCellStatusBarItems(cell: vscode.NotebookCell):
        vscode.ProviderResult<vscode.NotebookCellStatusBarItem | vscode.NotebookCellStatusBarItem[]> {

        const items: vscode.NotebookCellStatusBarItem[] = [];

        if (!this._kernel.isActive() || cell.kind === vscode.NotebookCellKind.Markup) {
            return items;
        }

        let interpreterIds = cell.document.getText().match(reInterpreter);
        if (interpreterIds === null || interpreterIds.length === 0) {
            return items;
        }
        this.getInterpreterStatus(cell);

        let interpreterId = interpreterIds[1];
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
        item.tooltip = `interpreter status (click to restart)`;
        items.push(item);

        return items;
    }

    private async _updateInterpreterStatus(interpreterId: string) {
        const res = await this._kernel.getService()?.getInterpreterSetting(interpreterId);
        if (res === undefined || res.data === undefined || res.data.status !== 'OK') {
            return undefined;
        }

        const status: string = res.data.body.status;
        this._mapInterpreterStatus.set(interpreterId, [Date.now(), status]);
        return status;
    }

    public async getInterpreterStatus(cell: vscode.NotebookCell) {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            return undefined;
        }

        let interpreterIds = cell.document.getText().match(reInterpreter);
        if (interpreterIds === null || interpreterIds.length === 0) {
            return undefined;
        }

        let interpreterId = interpreterIds[1];
        let res = this._mapInterpreterStatus.get(interpreterId);
        if (res === undefined) {
            return await this._updateInterpreterStatus(interpreterId);
        }

        let [lastUpdateDate, status] = res;
        const trackInterval = vscode.workspace.getConfiguration('zeppelin')
            .get('interpreter.trackInterval', 5);
        if (Date.now() - lastUpdateDate > trackInterval * 1000) {
            return await this._updateInterpreterStatus(interpreterId);
        }
        return status;
    }
}