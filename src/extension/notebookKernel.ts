// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { AxiosError, AxiosProxyConfig } from 'axios';
import { NotebookService } from '../common/api';
import { EXTENSION_NAME, getVersion, logDebug } from '../common/common';
import { ParagraphResult} from '../common/dataStructure';
import { showQuickPickURL, doLogin } from '../common/interaction';
import { parseParagraphResultToCellOutput } from '../common/parser';


export class ZeppelinKernel {
    readonly id: string = 'zeppelin-notebook-kernel';
    readonly notebookType: string = 'zeppelin-notebook';
    readonly label: string = 'Zeppelin Notebook';
    readonly supportedLanguages = ['python', 'scala', 'markdown', 'r', 'sql'];

    private _context: vscode.ExtensionContext;
    private _service?: NotebookService;
    private readonly _controller: vscode.NotebookController;
    private _pollNotebookEdits = new Map<vscode.NotebookCell, vscode.NotebookEdit[]>();
	private _executionOrder = 0;
    private _isActive = false;

    private _intervalUpdateCell?: NodeJS.Timer;
    private _pollUpdateParagraphs = new Map<vscode.NotebookCell, number>();

	constructor(context: vscode.ExtensionContext, service?: NotebookService) {
        // if (isInteractive) {
        //     this.id = 'zeppelin-notebook-interactive-kernel';
        //     this.notebookType = 'interactive';
        // }
        this._context = context;
        this._service = service;
        this._controller = vscode.notebooks.createNotebookController(this.id, 
                                                                    this.notebookType, 
                                                                    this.label);

		this._controller.supportedLanguages = ['python', 'scala', 'markdown', 'r', 'sql'];
		this._controller.supportsExecutionOrder = true;
		this._controller.description = 'Zeppelin notebook kernel';
		this._controller.executeHandler = this._executeAll.bind(this);

        this.activate();
	}

	dispose(): void {
		this._controller.dispose();
	}

    activate() {
        this._isActive = !!this._service && !!this._service.baseURL;

        if (this._isActive && this._intervalUpdateCell === undefined) {
            let config = vscode.workspace.getConfiguration('Zeppelin');
            let poolingInterval = config.get('zeppelin.autosave.poolingInterval', 1);

            this._intervalUpdateCell = setInterval(
                this._doUpdatePollingCells.bind(this), poolingInterval * 1000
            );
        }
        return this.isActive();
    }

    deactivate() {
        if (!this.isActive()) {
            return false;
        }

        if (this._intervalUpdateCell !== undefined) {
            // run registered update paragraph task immediately
            // and unregister it after completed
            clearInterval(this._intervalUpdateCell);
            this.instantUpdatePollingCells();
            this._intervalUpdateCell = undefined;
        }
        this._isActive = false;
        return this.isActive();
    }

    isActive() {
        return this._isActive;
    }

    setService(service: NotebookService) {
        this._service = service;
    }

    getServiceProxy() {
        let proxy: AxiosProxyConfig | undefined = undefined;

        let config = vscode.workspace.getConfiguration('vscode-zeppelin');
        if (!!config.get('zeppelin.proxy.host') && !!config.get('zeppelin.proxy.port')) {
            proxy = {
                host: config.get('zeppelin.proxy.host', ''),
                port: config.get('zeppelin.proxy.port', 0),
            };
            if (!!config.get('zeppelin.proxy.username')) {
                proxy["auth"] = {
                    username: config.get('zeppelin.proxy.username', ''),
                    password: config.get('zeppelin.proxy.password', '')
                };
            }
        }
        return proxy;
    }

    public async checkService(): Promise<boolean> {
        if (this.isActive()) {
            return true;
        }

        let baseURL: string | undefined = 
            this._context.workspaceState.get('currentZeppelinServerURL');
        if (baseURL === undefined) {
            showQuickPickURL(this._context);
            // baseURL is supposed not to be null or undefined by now
            baseURL = this._context.workspaceState.get('currentZeppelinServerURL');
            if (!baseURL) {
                return false;
            }
        }
        else if (baseURL === '') {
            return false;
        }
    
        let userAgent = `${EXTENSION_NAME}/${getVersion(this._context)} vscode-extension/${vscode.version}`;

        let proxy = this.getServiceProxy();
        let service = new NotebookService(baseURL, userAgent, proxy);

        let isSuccess = await doLogin(this._context, service);
        if (isSuccess) {
            this.setService(service);
            return this.activate();
        }
        else {
            return this.deactivate();
        }
    }

    public registerParagraphUpdate(cell: vscode.NotebookCell) {
        if (!this._pollUpdateParagraphs.has(cell)) {
            this._pollUpdateParagraphs.set(cell, Date.now());
        }
    }

    public instantUpdatePollingCells() {
        for (let cell of this._pollUpdateParagraphs.keys()) {
            this.updateParagraph(cell);
        }
    }

    private _doUpdatePollingCells() {
        let config = vscode.workspace.getConfiguration();
        let throttleTime: number = config.get('zeppelin.autosave.throttleTime', 5);

        for (let [cell, requestTime] of this._pollUpdateParagraphs) {
            if (throttleTime * 1000 < Date.now() - requestTime) {
                this.updateParagraph(cell);
            }
        }
    }

    public async updateCellMetadata(
        cell: vscode.NotebookCell,
        metadata: { [key: string]: any }
    ) {
        const editor = new vscode.WorkspaceEdit();
        let edit = vscode.NotebookEdit.updateCellMetadata(
            cell.index,
            Object.assign({}, cell.metadata, metadata)
        );
        editor.set(cell.document.uri, [edit]);
        
        return vscode.workspace.applyEdit(editor);
    }

    public async pollUpdateCellMetadata(
        cell: vscode.NotebookCell,
        metadata: { [key: string]: any }
    ) {
        let edit = vscode.NotebookEdit.updateCellMetadata(
            cell.index,
            metadata
        );
        if (this._pollNotebookEdits.has(cell)) {
            this._pollNotebookEdits.get(cell)?.push(edit);
        }
        else {
            this._pollNotebookEdits.set(cell, [edit]);
        }
    }

    public applyPolledNotebookEdits() {
        for (let [cell, edits] of this._pollNotebookEdits) {
            const editor = new vscode.WorkspaceEdit();
            editor.set(cell.document.uri, edits);
            vscode.workspace.applyEdit(editor);
        }
        this._pollNotebookEdits.clear();
    }

    public async updateParagraphText(cell: vscode.NotebookCell) {
        let text = cell.document.getText();
        let res = await this._service?.updateParagraphText(
            cell.notebook.metadata.id, cell.metadata.id, text
        );
        if (res instanceof AxiosError) {
            throw res;
        }

        await this.updateCellMetadata(cell, res?.data.body);
    }

    public async updateParagraphConfig(cell: vscode.NotebookCell) {
        let config = {
            "editorSetting": {
                "language": cell.document.languageId,
                "editOnDblClick": false,
                "completionKey": "TAB",
                "completionSupport": cell.kind !== 1
            } };
    
        let res = await this._service?.updateParagraphConfig(
            cell.notebook.metadata.id, cell.metadata.id, config
        );
        if (res instanceof AxiosError) {
            throw res;
        }

        await this.updateCellMetadata(cell, res?.data.body);
    }

    public async updateParagraph(cell: vscode.NotebookCell) {
        try {
            // index = -1: cell has been deleted from notebook
            if (cell.index === -1) {
                this._service?.deleteParagraph(
                    cell.notebook.metadata.id, cell.metadata.id
                );
                this._pollUpdateParagraphs.delete(cell);
                return;
            }

            let text = cell.document.getText();
            let config = {
                "editorSetting": {
                    "language": cell.document.languageId,
                    "editOnDblClick": false,
                    "completionKey": "TAB",
                    "completionSupport": cell.kind !== 1
                } };

            // create paragraph when cell is newly created
            if (cell.metadata.id === undefined) {
                let res = await this._service?.createParagraph(
                    cell.notebook.metadata.id, text, cell.index, '', config);
                if (res instanceof AxiosError) {
                    throw res;
                }

                await this.updateCellMetadata(
                    cell,
                    {
                        id: res?.data.body,
                        config
                    }
                );
            }
            else {
                await this.updateParagraphConfig(cell);
                await this.updateParagraphText(cell);
            }
        } catch (err) {
            logDebug("error in updateParagraph", err);
        }

        // unregister cell from poll, as the update is either finished or failed now
        this._pollUpdateParagraphs.delete(cell);

        if (cell.kind <= 1) {
            // need to call remote execution for markup paragraph languages
            // so remote notebook paragraph result could be generated
            // as markup languages are rendered locally
            this._executeCell(cell);
        }
    }

    private async _executeCell(cell: vscode.NotebookCell) {
        let res = await this._service?.runParagraph(
            cell.notebook.metadata.id, cell.metadata.id, true
        );
        let paragraphResult = <ParagraphResult> res?.data.body;

        let cellOutput = parseParagraphResultToCellOutput(paragraphResult);
        await this.updateCellMetadata(cell, {results: paragraphResult});

        return cellOutput;
    }

    private _executeAll(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
        ): void {
        for (let cell of cells) {
			this._doExecution(cell);
		}
	}

    private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
        await this.checkService();

        const execution = this._controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
		execution.start(Date.now());

        if (this._isActive) {
            try {
                let cancelTokenSource = this._service?.cancelTokenSource;
                execution.token.onCancellationRequested(_ => cancelTokenSource?.cancel());

                await this.updateParagraph(cell);

                let cellOutput = await this._executeCell(cell);
                execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
                execution.end(true, Date.now());

            } catch (err) {
                execution.replaceOutput(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error({ 
                            name: err instanceof Error && err.name || 'error', 
                            message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)})
                    ])
                );
                execution.end(false, Date.now());
            }
        }
    }
}
