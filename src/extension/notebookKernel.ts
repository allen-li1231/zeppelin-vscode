// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { NotebookService } from '../common/api';
import { EXTENSION_NAME,
    SUPPORTEDLANGUAGE,
    getVersion,
    logDebug,
    getProxy
} from '../common/common';
import { ParagraphData, ParagraphResult } from '../common/dataStructure';
import { showQuickPickURL, doLogin } from '../common/interaction';
import { parseParagraphResultToCellOutput } from '../common/parser';


export class ZeppelinKernel {
    readonly id: string = 'zeppelin-notebook-kernel';
    readonly notebookType: string = 'zeppelin-notebook';
    readonly label: string = 'Zeppelin Notebook';
    readonly supportedLanguages = SUPPORTEDLANGUAGE;

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
        this._controller = vscode.notebooks.createNotebookController(
            this.id, this.notebookType, this.label
        );
		this._controller.supportedLanguages = this.supportedLanguages;
		this._controller.supportsExecutionOrder = true;
		this._controller.description = 'Zeppelin notebook kernel';
		this._controller.executeHandler = this._executeAll.bind(this);

        this.activate();
	}

	dispose(): void {
        this.deactivate();
		this._controller.dispose();
	}

    activate() {
        this._isActive = !!this._service && !!this._service.baseURL;

        if (this._isActive) {
            let label = this._context.workspaceState.get('currentZeppelinServerName', this.label);
            let desc = this._context.workspaceState.get('currentZeppelinServerURL', undefined);
            this.setDisplay(label, EXTENSION_NAME, desc);

            if (this._intervalUpdateCell === undefined) {
                let config = vscode.workspace.getConfiguration('zeppelin');
                
                let poolingInterval = config.get('autosave.poolingInterval', 1);
    
                this._intervalUpdateCell = setInterval(
                    this._doUpdatePollingParagraphs.bind(this), poolingInterval * 1000
                );
            }
        }


        return this.isActive();
    }

    deactivate() {
        if (!this.isActive()) {
            return false;
        }

        this.setDisplay(this.label, EXTENSION_NAME);

        if (this._intervalUpdateCell !== undefined) {
            // run registered update paragraph task immediately
            // and unregister it after completed
            clearInterval(this._intervalUpdateCell);
            this.instantUpdatePollingParagraphs();
            this._intervalUpdateCell = undefined;
        }
        this._isActive = false;
        return this.isActive();
    }

    isActive() {
        return this._isActive;
    }

    setDisplay(label: string, description?: string, detail?: string) {
        this._controller.label = label;
        this._controller.description = description;
        this._controller.detail = detail;
    }

    getContext() {
        return this._context;
    }

    setService(baseURL: string) {
        let userAgent = `${EXTENSION_NAME}/${getVersion(this._context)} vscode-extension/${vscode.version}`;

        let service = new NotebookService(baseURL, userAgent, getProxy());

        this._service = service;
        return service;
    }

    getService() {
        return this._service;
    }

    private async _toggleActivation(baseURL: string | undefined) {
        if (!baseURL) {
            return this.deactivate();
        }

        let service = this.setService(baseURL);
        let isSuccess = await doLogin(this._context, service);
        if (isSuccess) {
            return this.activate();
        }
        else {
            return this.deactivate();
        }
    }

    public async checkInService(
        baseURL: string | undefined,
        onDidServiceActivate?: Function
    ) {
        if (baseURL === this._service?.baseURL && this.isActive()) {
            if (onDidServiceActivate !== undefined) {
                onDidServiceActivate();
            }
            return;
        }

        if (!baseURL) {
            showQuickPickURL(this._context, (async () => {
                // baseURL is supposed not to be null or undefined by now
                baseURL = this._context.workspaceState.get('currentZeppelinServerURL');

                let isActive = await this._toggleActivation(baseURL);
                if (isActive && onDidServiceActivate !== undefined) {
                    onDidServiceActivate();
                }

            }).bind(this));
        }
        else {
            let isActive = await this._toggleActivation(baseURL);
            if (isActive && onDidServiceActivate !== undefined) {
                onDidServiceActivate();
            }
        }
    }

    public async listNotes() {
        let res = await this._service?.listNotes();
        return res?.data.body;
    }

    public async hasNote(noteId: string | undefined) {
        if (noteId === undefined) {
            return false;
        }

        for (let note of await this.listNotes()) {
            // before Zeppelin 10.0, path of note
            // is stored in 'name' key instead of 'path'
            let path = note.path ?? note.name;
            if (!path.startsWith('/~Trash') && note.id === noteId) {
                return true;
            }
        }
        return false;
    }

    public async createNote(name: string, paragraphs?: ParagraphData[]) {
        let res = await this._service?.createNote(name, paragraphs);

        logDebug(res);
        if (res instanceof AxiosError) {
            if (res.response?.status === 500) {
                vscode.window.showErrorMessage(
                    `Cannot create note. Please check if note name
                     is duplicated on the server.`);
            }
            else{
                vscode.window.showErrorMessage(`${res.code}: ${res.message}`);
            }
        }

        return res?.data.body;
    }

    public async importNote(note: any) {
        let res = await this._service?.importNote(note);

        logDebug(res);
        if (res instanceof AxiosError) {
            return undefined;
        }

        return res?.data.body;
    }

    public async doesNotebookExist(
        note: vscode.NotebookData | vscode.NotebookDocument
    ) {
        return this.isActive() && await this.hasNote(note?.metadata?.id);
    }

    public registerParagraphUpdate(cell: vscode.NotebookCell) {
        if (!this._pollUpdateParagraphs.has(cell)) {
            this._pollUpdateParagraphs.set(cell, Date.now());
        }
    }

    public instantUpdatePollingParagraphs() {
        for (let cell of this._pollUpdateParagraphs.keys()) {
            this.updateParagraph(cell);
        }
    }

    private _doUpdatePollingParagraphs() {
        let config = vscode.workspace.getConfiguration('zeppelin');
        let throttleTime: number = config.get('autosave.throttleTime', 5);

        for (let [cell, requestTime] of this._pollUpdateParagraphs) {
            if (throttleTime * 1000 < Date.now() - requestTime) {
                this.updateParagraph(cell);
            }
        }
    }

    public updateNoteMetadata(
        note: vscode.NotebookDocument,
        metadata: { [key: string]: any }
    ) {
        const editor = new vscode.WorkspaceEdit();
        let edit = vscode.NotebookEdit.updateNotebookMetadata(
            // update based on new metadata provided
            Object.assign({}, note.metadata, metadata)
        );
        editor.set(note.uri, [edit]);
        
        return vscode.workspace.applyEdit(editor);
    }

    public updateCellMetadata(
        cell: vscode.NotebookCell,
        metadata: { [key: string]: any }
    ) {
        const editor = new vscode.WorkspaceEdit();
        let edit = vscode.NotebookEdit.updateCellMetadata(
            cell.index,
            // update based on new metadata provided
            Object.assign({}, cell.metadata, metadata)
        );
        editor.set(cell.document.uri, [edit]);
        
        return vscode.workspace.applyEdit(editor);
    }

    public pollUpdateCellMetadata(
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
            if (res.response?.status === 404) {
                vscode.window.showErrorMessage(`${res.code}: ${res.message}`);
            }
            logDebug(res);
            throw res;
        }

        await this.updateCellMetadata(cell, res?.data.body);
    }

    public async updateParagraphConfig(cell: vscode.NotebookCell) {
        var lineNumbers = vscode.workspace.getConfiguration("editor").get("lineNumbers")
            !== vscode.TextEditorLineNumbersStyle.Off;
        let config = {
            "lineNumbers": cell.metadata?.config.lineNumbers ?? lineNumbers,
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
            if (res.response?.status === 404) {
                vscode.window.showErrorMessage(`${res.code}: ${res.message}`);
            }
            logDebug(res);
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

            // create corresponding paragraph when a cell is newly created
            if (cell.metadata.id === undefined) {
                let text = cell.document.getText();
                let lineNumbers = vscode.workspace.getConfiguration("editor").get("lineNumbers");
                let config = {
                    "lineNumbers": lineNumbers !== vscode.TextEditorLineNumbersStyle.Off,
                    "editorSetting": {
                        "language": cell.document.languageId,
                        "editOnDblClick": false,
                        "completionKey": "TAB",
                        "completionSupport": cell.kind !== 1
                    }
                };

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
                let res = await this.updateParagraphConfig(cell);
                res = await this.updateParagraphText(cell);
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
            this._runParagraph(cell);
        }
    }

    private async _runParagraph(cell: vscode.NotebookCell) {
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
        if (!this.isActive()) {
            return;
        }

        const execution = this._controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
		execution.start(Date.now());

        try {
            let cancelTokenSource = this._service?.cancelTokenSource;
            execution.token.onCancellationRequested(_ => cancelTokenSource?.cancel());

            await this.updateParagraph(cell);

            let cellOutput = await this._runParagraph(cell);
            execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
            execution.end(true, Date.now());

        } catch (err) {
            execution.replaceOutput(
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({ 
                        name: err instanceof Error && err.name || 'error', 
                        message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)
                    })
                ])
            );
            execution.end(false, Date.now());
        }
    }
}
