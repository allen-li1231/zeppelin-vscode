// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RequestParser } from '../common/request';
import { ResponseParser, ResponseRendererElements } from '../common/response';
const axios = require('axios').default;


export class ZeppelinKernel {
    readonly id: string = 'zeppelin';
    readonly notebookType: string = 'zeppelin-notebook';
    readonly label: string = 'Zeppelin Notebook';
    readonly supportedLanguages = ['python', 'scala', 'markdown', 'r', 'sql'];

    private readonly _controller: vscode.NotebookController;
	private _executionOrder = 0;

	constructor(isInteractive?: boolean) {
        if (isInteractive) {
            this.id = 'zeppelin-notebook-interactive-kernel';
            this.notebookType = 'interactive';
        }
        this._controller = vscode.notebooks.createNotebookController(this.id, 
                                                                    this.notebookType, 
                                                                    this.label);

		this._controller.supportedLanguages = ['python', 'scala', 'markdown', 'r', 'sql'];
		this._controller.supportsExecutionOrder = true;
		this._controller.description = 'Zeppelin notebook inspired by Zeppelin REST API.';
		this._controller.executeHandler = this._executeAll.bind(this);
	}

	dispose(): void {
		this._controller.dispose();
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
        const execution = this._controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
		execution.start(Date.now());

        const logger = (d: any, r: any, requestParser: RequestParser) => {
            try {
                const response = new ResponseParser(d, r, requestParser);

                execution.replaceOutput([new vscode.NotebookCellOutput([
                    // vscode.NotebookCellOutputItem.json(response.renderer(), MIME_TYPE),
                    vscode.NotebookCellOutputItem.json(response.json(), 'text/x-json'),
                    vscode.NotebookCellOutputItem.text(response.html(), 'text/html')
                ])]);

                execution.end(true, Date.now());
            } catch (e) {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error({ 
                            name: e instanceof Error && e.name || 'error', 
                            message: e instanceof Error && e.message || JSON.stringify(e, undefined, 4)})
                    ])
                ]);
                execution.end(false, Date.now());
            }
        };

        let req;
        let parser;
        
        try {
            parser = new RequestParser(cell.document.getText(), cell.document.eol);
            req = parser.getRequest();

            if(req === undefined) { 
                execution.end(true, Date.now()); 
                return; 
            }
            
        } catch (err) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({ 
                            name: err instanceof Error && err.name || 'error', 
                            message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)})
                ])
            ]);
            execution.end(false, Date.now());
            return;
        }

        try {
            const cancelTokenAxios = axios.CancelToken.source();

            let options = {...req};
            options['cancelToken'] = cancelTokenAxios.token;

            execution.token.onCancellationRequested(_ => cancelTokenAxios.cancel());

            let response = await axios(options);

            logger(response, req, parser);
        } catch (exception) {
            logger(exception, req, parser);
        }
        
    }

    private async _saveDataToFile(data: ResponseRendererElements) {
        const workSpaceDir = path.dirname(vscode.window.activeTextEditor?.document.uri.fsPath ?? '');
        if (!workSpaceDir) { return; }
    
        let name;
        const url = data.request?.responseUrl;
        if(url) {
            name = url;
            name = name.replace(/^[A-Za-z0-9]+\./g, '');
            name = name.replace(/\.[A-Za-z0-9]+$/g, '');
            name = name.replace(/\.\:\//g, '-');
        } else {
            name = 'unknown-url';
        }

        let date = new Date().toDateString().replace(/\s/g, '-');
        
        const defaultPath = vscode.Uri.file(path.join(workSpaceDir, `response-${name}-${date}.json`));
        const location = await vscode.window.showSaveDialog({ defaultUri: defaultPath });
        if(!location) { return; }
    
        fs.writeFile(location?.fsPath, JSON.stringify(data, null, 4), { flag: 'w' }, (e) => {
            vscode.window.showInformationMessage(e?.message || `Saved response to ${location}`);
        });
    };
}
