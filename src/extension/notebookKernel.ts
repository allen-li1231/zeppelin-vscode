// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { NotebookService } from '../common/api';
import { NAME, getVersion } from '../common/common';
import { showQuickPickURL, doLogin } from '../common/interaction';
import { ParagraphResult, ParagraphResultMsg} from '../common/dataStructure';
import { AxiosError } from 'axios';


export class ZeppelinKernel {
    readonly id: string = 'zeppelin-notebook-kernel';
    readonly notebookType: string = 'zeppelin-notebook';
    readonly label: string = 'Zeppelin Notebook';
    readonly supportedLanguages = ['python', 'scala', 'markdown', 'r', 'sql'];

    private _context: vscode.ExtensionContext;
    private _service?: NotebookService;
    private readonly _controller: vscode.NotebookController;
	private _executionOrder = 0;
    private _isActive = false;

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
        return this._isActive;
    }

    deactivate() {
        this._isActive = false;
        return this._isActive;
    }

    setService(service: NotebookService) {
        this._service = service;
    }

    async checkService(): Promise<boolean> {
        if (this._isActive) {
            return true;
        }

        let baseURL: string | undefined = this._context.workspaceState.get('currentZeppelinServerURL');
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
    
        let userAgent = `${NAME}/${getVersion(this._context)} vscode-extension/${vscode.version}`;
        let service = new NotebookService(baseURL, userAgent);
        let isSuccess = await doLogin(this._context, service);
        if (isSuccess) {
            this.setService(service);
            return this.activate();
        }
        else {
            return this.deactivate();
        }
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

    public async syncParagraph(cell: vscode.NotebookCell) {
        let text = cell.document.getText();
        let config = {
            "editorSetting": {
                "language": cell.document.languageId,
                "editOnDblClick": false,
                "completionKey": "TAB",
                "completionSupport": cell.kind !== 1
            } };

        let res = await this._service?.updateParagraphText(cell.metadata.noteId, cell.metadata.id, text);
        if (res instanceof AxiosError) {
            return false;
        }

        this._service?.updateParagraphConfig(cell.metadata.noteId, cell.metadata.id, config);

        return true;
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

                this.syncParagraph(cell);
                let res = await this._service?.runParagraph(cell.metadata.noteId, cell.metadata.id, true);
                let paragraphResult = <ParagraphResult> res?.data.body;

                let cellOutput = paragraphResult?.msg.map(this._parseMsgToOutput) ?? [];
        
                execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
                cell.document.save();

            } catch (err) {
                execution.replaceOutput(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error({ 
                            name: err instanceof Error && err.name || 'error', 
                            message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)})
                    ])
                );
            }
        }

        execution.end(true, Date.now());
    }
    
    private _parseMsgToOutput(msg: ParagraphResultMsg) {
        let outputItem: vscode.NotebookCellOutputItem;

        switch (msg.type) {
            case 'HTML':
                outputItem = vscode.NotebookCellOutputItem.text(msg.data, 'text/html');
            default:
                outputItem = vscode.NotebookCellOutputItem.text(msg.data, 'text/plain');
        }
        return outputItem;
    }
}
