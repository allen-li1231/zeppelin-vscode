// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { NotebookService } from '../common/api';
import { EXTENSION_NAME,
    SUPPORTEDLANGUAGE,
    mapZeppelinLanguage,
    logDebug,
    getProxy,
    getVersion
} from '../common/common';
import { CellStatusProvider } from '../component/cellStatusBar';
import { NoteData, ParagraphData, ParagraphResult } from '../common/types';
import { showQuickPickURL,
    doLogin,
    promptZeppelinServerURL,
    promptCreateParagraph
} from '../common/interaction';
import { parseParagraphToCellData, parseParagraphResultToCellOutput
} from '../common/parser';
import { Mutex } from '../component/mutex';
import { Progress } from '../component/superProgress/super-progress';
// import ForProgress from '../component/ForProgress/ForProgress';
import _ = require('lodash');


export class ZeppelinKernel {
    readonly id: string = 'zeppelin-notebook-kernel';
    readonly notebookType: string = 'zeppelin-notebook';
    readonly label: string = 'Zeppelin Notebook';
    readonly supportedLanguages = SUPPORTEDLANGUAGE;

    private _context: vscode.ExtensionContext;
    private _service?: NotebookService;
    private readonly _controller: vscode.NotebookController;
    private _isActive = false;
    private _updateMutex = new Mutex("_updateMutex");
    private _editMutex = new Mutex("_editMutex");
    private _executeMutex = new Mutex("_executeMutex");

    // private _timerSyncNote?: NodeJS.Timer;
    private _timerUpdateCell?: NodeJS.Timer;
    private _recurseTrackExecution?: Function;
    private _mapSyncNote = new Map<
        vscode.NotebookDocument, number
    >();
    private _mapTrackExecution = new Map<
        string, [vscode.NotebookCellExecution, number, Progress]
    >();
    private _mapNotebookEdits = new Map<vscode.NotebookCell, vscode.NotebookEdit[]>();
    private _mapUpdateParagraph = new Map<vscode.NotebookCell, number>();
    private _flagRegisterParagraphUpdate = true;

    public cellStatusBar: CellStatusProvider | undefined = undefined;

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
		this._controller.supportsExecutionOrder = false;
		this._controller.description = 'Zeppelin notebook kernel';
		this._controller.executeHandler = this._executeAll.bind(this);
		// this._controller.interruptHandler = this._interruptAll.bind(this);

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

            let config = vscode.workspace.getConfiguration('zeppelin');
            if (this._timerUpdateCell === undefined) {
                let poolingInterval = config.get('autosave.poolingInterval', 5);
    
                this._timerUpdateCell = setInterval(async () => {
                    // sync server and local
                    await this._doUpdatePollingParagraphs.bind(this)();
                    await this.cellStatusBar?.doUpdateVisibleCells();
                },
                poolingInterval * 1000);
            }

            // if (this._timerSyncNote === undefined) {
            //     let note = vscode.window.activeNotebookEditor?.notebook;

            //     if (note !== undefined && config.get('autosave.toggleSync', true)) {
            //         let syncInterval = config.get('autosave.syncInterval', 5);
            //         this._timerSyncNote = setInterval(
            //             () => this.syncNote.bind(this)(note), syncInterval * 1000
            //         );
            //     }
            // }

            if (this._recurseTrackExecution === undefined) {
                let trackExecutionInterval = config.get('execution.trackInterval', 1);
                let recurseTracker = () => {
                    if (!this.isActive()) {
                        return;
                    }
                    setTimeout(async () => {
                        await this._doTrackAllExecution.bind(this)();
                        recurseTracker();
                    }, trackExecutionInterval * 1000);
                };
                this._recurseTrackExecution = recurseTracker;
                this._recurseTrackExecution();
            }
        }
        logDebug("activate", this.isActive());
        return this.isActive();
    }

    deactivate() {
        if (!this.isActive()) {
            return false;
        }

        this.setDisplay(this.label, EXTENSION_NAME);

        if (this._timerUpdateCell !== undefined) {
            // run registered update paragraph task immediately
            // and unregister it after completed
            clearInterval(this._timerUpdateCell);
            this.instantUpdatePollingParagraphs();
            this._timerUpdateCell = undefined;
        }

        // if (this._timerSyncNote !== undefined) {
        //     clearInterval(this._timerSyncNote);
        //     this._timerSyncNote = undefined;
        // }

        this._recurseTrackExecution = undefined;

        this._isActive = false;
        logDebug("activate", this.isActive());
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

        let config = vscode.workspace.getConfiguration('zeppelin');
        let caPath: string | undefined = config.get('https.CA-Certification');
        let keyPath: string | undefined = config.get('https.KeyPath');
        let passphase: string | undefined = config.get('https.passphase');
        let rejectUnauthorized = config.get('https.rejectUnauthorized', false);
        service.setHttpsAgent(caPath, keyPath, passphase, rejectUnauthorized);

        this._service = service;
        return service;
    }

    getService() {
        return this._service;
    }

    private async _activateService(baseURL: string | undefined) {
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

                let isActive = await this._activateService(baseURL);
                if (isActive && onDidServiceActivate !== undefined) {
                    onDidServiceActivate();
                }

            }).bind(this));
        }
        else {
            let isActive = await this._activateService(baseURL);
            if (isActive && onDidServiceActivate !== undefined) {
                onDidServiceActivate();
            }
        }
    }

    public async listNotes() {
        let res = await this._service?.listNotes();
        return res?.data ? res?.data.body : [];
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

        if (res instanceof AxiosError) {
            logDebug("error in createNote", res);
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

        logDebug("error in importNote", res);
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

    public async getNoteInfo(
        note: vscode.NotebookDocument
    ) {
        let noteId = note.metadata.id;
        let res = await this.getService()?.getInfo(noteId);
    
        if (res instanceof AxiosError) {
            vscode.window.showWarningMessage(
                `Unable to get info for note ${noteId}, ` +
                res.response ? res.response?.data : `${res.code}: ${res.message}`
            );
            return;
        }
        else if (res?.status === 500 || res?.status === 404) {
            logDebug("error in getNoteInfo", res);
            vscode.window.showErrorMessage(
                `Unable to get note info: '${noteId}' doesn't exist on the server`);
            return;
        }

        let serverNote: NoteData = res?.data.body;
        return serverNote;
    }

    public async getParagraphInfo(
        cell: vscode.NotebookCell
    ) {
        let res = await this.getService()?.getParagraphInfo(
            cell.notebook.metadata.id, cell.metadata.id);
        if (res instanceof AxiosError) {
            logDebug(
                `Unable to get paragraph info ${cell.metadata.id} in note '${cell.notebook.metadata.name}'`
            );
            throw res;
        }

        let paragraph: ParagraphData = res?.data.body ?? res?.data;
        this.pollUpdateCellMetadata(cell, paragraph);
        return paragraph;
    }

    public async stopParagraph(cell: vscode.NotebookCell) {
        let res = await this.getService()?.stopParagraph(
            cell.notebook.metadata.id, cell.metadata.id
        );
        return res?.status === 200;
    }

    public registerParagraphUpdate(cell: vscode.NotebookCell) {
        if (!this._flagRegisterParagraphUpdate) {
            logDebug("registerParagraphUpdate: cell not to be updated", cell);
            return;
        }

        logDebug("registerParagraphUpdate", cell);
        return this._updateMutex.runExclusive(async () => {
            if (!this._mapUpdateParagraph.has(cell)) {
                this._mapUpdateParagraph.set(cell, Date.now());
            }
        });
    }

    public unregisterParagraphUpdate(cell: vscode.NotebookCell) {
        return this._updateMutex.runExclusive(async () => {
            if (!this._mapUpdateParagraph.has(cell)) {
                return this._mapUpdateParagraph.delete(cell);
            }
            return false;
        });
    }

    public async instantUpdatePollingParagraphs() {
        logDebug("instantUpdatePollingParagraphs", this._mapUpdateParagraph);
        // let notebookCells = Array.from(this._mapUpdateParagraph.keys());
        return this._updateMutex.runExclusive(async () => {
            // Promise.all(notebookCells.map(this.updateParagraph.bind(this)))
            for (let cell of this._mapUpdateParagraph.keys()) {
                await this.updateParagraph(cell);
            }
            logDebug("instantUpdatePollingParagraphs ends");
        });
    }

    public async editWithoutParagraphUpdate(func: () => Promise<void>) {
        return this._editMutex.runExclusive(async () => {
            this._flagRegisterParagraphUpdate = false;
            let res = await func();
            this._flagRegisterParagraphUpdate = true;
            return res;
        });
    }

    private async _doUpdatePollingParagraphs() {
        let config = vscode.workspace.getConfiguration('zeppelin');
        let throttleTime: number = config.get('autosave.throttleTime', 3);

        logDebug("_doUpdatePollingParagraphs", this._mapUpdateParagraph);
        return this._updateMutex.runExclusive(async () => {
            for (let [cell, requestTime] of this._mapUpdateParagraph) {
                if (!this.isNoteSyncing(cell.notebook)   // disregard syncing cells
                    && throttleTime * 1000 < Date.now() - requestTime) {
                    if (cell.index < 0) {
                        logDebug("_doUpdatePollingParagraphs: deleted cell", cell);
                    }
                    this.updateParagraph(cell);
                }
            }
        });
    }

    public async trackExecution(execution: vscode.NotebookCellExecution, progressbar: Progress) {
        if (execution.cell.index < 0) {
            logDebug(`trackExecution: unregister as cell deleted`, execution);
            this.unregisterTrackExecution(execution);
            return;
        }
        let paragraph: ParagraphData;
        try {
            paragraph = await this.getParagraphInfo(execution.cell);
        } catch (err) {
            logDebug("error in trackExecution:", err);
            this.unregisterTrackExecution(execution);
            let cellOutput = new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.error({
                    name: err instanceof Error && err.name || 'error', 
                    message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)
                })
            ]);
            execution.replaceOutput(cellOutput);
            execution.end(false, Date.now());
            return;
        }

        const progress = paragraph.status === "RUNNING" ? paragraph.progress : 100;
        const pbText = await progressbar.renderProgress(progress ?? 0);
        // execution.setProgress(progress);
        if (paragraph.results) {
            const cellOutput = parseParagraphResultToCellOutput(paragraph.results, pbText);
            execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
        }
        else if (paragraph.status === "PENDING") {
            execution.clearOutput();
        }
        else {
            const pbOutput = vscode.NotebookCellOutputItem.stdout(pbText);
            execution.replaceOutput(new vscode.NotebookCellOutput([pbOutput]));
        }

        if ((paragraph.status !== "RUNNING") && (paragraph.status !== "PENDING")) {
            logDebug(`trackExecution: unregister as not running`, execution);
            this.unregisterTrackExecution(execution);
            execution.end(
                paragraph.status !== "ERROR", Date.now()
                // paragraph.dateFinished
                //     ? Date.parse(paragraph.dateFinished)
                //     : Date.now()
            );
        }
    }

    private async _doTrackAllExecution() {
        let config = vscode.workspace.getConfiguration('zeppelin');
        let interval: number = config.get('trackExecutionInterval', 5);
        let aryExecution = [];

        for (let [_, [execution, requestTime, progressbar]] of this._mapTrackExecution) {
            logDebug("_doTrackAllExecution: tracking", execution, Date.now() - requestTime);
            if (interval * 1000 < Date.now() - requestTime) {
                aryExecution.push(this.trackExecution(execution, progressbar));
            }
        }

        return Promise.all(aryExecution);
    }

    public registerTrackExecution(execution: vscode.NotebookCellExecution) {
        this._mapTrackExecution.set(
            execution.cell.metadata.id, [execution, Date.now(), Progress.create(57)]
        );
    }

    public unregisterTrackExecution(execution: vscode.NotebookCellExecution) {
        return this._mapTrackExecution.delete(execution.cell.metadata.id);
    }

    public getExecutionByParagraphId(paragraphId: string) {
        return this._mapTrackExecution.get(paragraphId)?.[0];
    }

    public async replaceNoteCells(
        note: vscode.NotebookDocument,
        range: vscode.NotebookRange,
        cells: vscode.NotebookCellData[]
    ) {
        const editor = new vscode.WorkspaceEdit();
        let edit = vscode.NotebookEdit.replaceCells(
            // update based on new metadata provided
            range, cells
        );
        editor.set(note.uri, [edit]);
        
        return vscode.workspace.applyEdit(editor);
    }

    public async insertNoteCells(
        note: vscode.NotebookDocument,
        index: number,
        cells: vscode.NotebookCellData[]
    ) {
        const editor = new vscode.WorkspaceEdit();
        let edit = vscode.NotebookEdit.insertCells(
            index, cells
        );
        editor.set(note.uri, [edit]);

        return vscode.workspace.applyEdit(editor);
    }

    public async deleteNoteCells(
        note: vscode.NotebookDocument,
        range: vscode.NotebookRange
    ) {
        const editor = new vscode.WorkspaceEdit();
        let edit = vscode.NotebookEdit.deleteCells(range);
        editor.set(note.uri, [edit]);

        return vscode.workspace.applyEdit(editor);
    }

    public async updateNoteMetadata(
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

    public async updateByReplaceCell(
        cell: vscode.NotebookCell
    ) {
        return this._editMutex.runExclusive(async () => {
            let paragraph = await this.getParagraphInfo(cell);
            let parsedCell = parseParagraphToCellData(paragraph);
            let replaceRange = new vscode.NotebookRange(cell.index, cell.index + 1);

            this._flagRegisterParagraphUpdate = false;
            let res = await this.replaceNoteCells(
                cell.notebook, replaceRange, [parsedCell]
            );
            this._flagRegisterParagraphUpdate = false;
            return res;
        });
    }

    public async updateCellMetadata(
        cell: vscode.NotebookCell,
        metadata: { [key: string]: any }
    ) {
        if (cell.index < 0) {
            console.log(cell);
        }
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
            // update based on new metadata provided
            Object.assign({}, cell.metadata, metadata)
        );
        if (this._mapNotebookEdits.has(cell)) {
            this._mapNotebookEdits.get(cell)?.push(edit);
        }
        else {
            this._mapNotebookEdits.set(cell, [edit]);
        }
    }

    public async editNote(
        note: vscode.NotebookDocument,
        replaceRange?: vscode.NotebookRange,
        replaceCells?: vscode.NotebookCellData[],
        insertIndex?: number,
        insertCells?: vscode.NotebookCellData[],
        deleteRange?: vscode.NotebookRange,
        metadata?: { [key: string]: any }
    ) {
        let aryEdits = [];
        const editor = new vscode.WorkspaceEdit();

        if (replaceRange !== undefined && replaceCells !== undefined) {
            aryEdits.push(vscode.NotebookEdit.replaceCells(replaceRange, replaceCells));
        }
        if (insertIndex !== undefined && insertCells !== undefined) {
            aryEdits.push(vscode.NotebookEdit.insertCells(insertIndex, insertCells));
        }
        if (deleteRange !== undefined) {
            aryEdits.push(vscode.NotebookEdit.deleteCells(deleteRange));
        }
        if (metadata !== undefined) {
            aryEdits.push(vscode.NotebookEdit.updateNotebookMetadata(metadata));
        }

        editor.set(note.uri, aryEdits);
        return vscode.workspace.applyEdit(editor);
    }

    private _registerSyncNote(note: vscode.NotebookDocument) {
        this._mapSyncNote.set(note, Date.now());
    }

    private _unregisterSyncNote(note: vscode.NotebookDocument) {
        if (this._mapSyncNote.has(note)) {
            this._mapSyncNote.delete(note);
        }
    }

    public isNoteSyncing(note: vscode.NotebookDocument | undefined) {
        if (note === undefined) {
            return false;
        }
        return this._mapSyncNote.has(note);
    }

    public async syncNote(note: vscode.NotebookDocument | undefined) {
        if (note === undefined) {
            return;
        }
        if (!!!note.metadata || !!!note.metadata.id) {
            vscode.window.showWarningMessage("Unable to sync note as note id is not found");
            return;
        }

        this._registerSyncNote(note);
        logDebug("syncNote start");
        let serverNote = await this.getNoteInfo(note);
        if (serverNote === undefined) {
            logDebug("syncNote failed");
            this._unregisterSyncNote(note);
            return;
        }

        let serverCells = serverNote.paragraphs
            ? serverNote.paragraphs.map(parseParagraphToCellData)
            : [];

        // need to unregister updates of cells to be deleted from syncing
        for (let cell of note.getCells()) {
            await this.unregisterParagraphUpdate(cell);
        }

        let replaceRange = new vscode.NotebookRange(0, note.cellCount);
        await this.editWithoutParagraphUpdate(async () => {
            await this.editNote(
                note, replaceRange, serverCells,
                undefined, undefined, undefined,
                serverNote
            );

            for (let [cell, parsedCell] of _.zip(note.getCells(), serverCells)) {
                if (cell === undefined) {
                    break;
                }

                let execution = this.getExecutionByParagraphId(cell.metadata.id);
                if (execution !== undefined) {
                    this.unregisterTrackExecution(execution);
                    try{
                        execution.end(undefined);
                    }
                    catch (err) {}
                }

                let newExecution = this._controller.createNotebookCellExecution(cell);
                newExecution.token.onCancellationRequested(_ => {
                    newExecution.clearOutput();
                    newExecution.end(false, Date.now());
                });
                newExecution.start(Date.parse(cell.metadata.dateStarted) || Date.now());

                if ((cell.metadata.status !== "RUNNING") && (cell.metadata.status !== "PENDING")
                    && parsedCell?.outputs !== undefined) {
                    newExecution.replaceOutput(parsedCell?.outputs);
                    newExecution.end(
                        cell.metadata.status !== "ERROR",
                        Date.parse(cell.metadata.dateFinished) || Date.now()
                    );
                }
                else {
                    this.registerTrackExecution(newExecution);
                }
            }
            logDebug("syncNote end");
        });

        this._unregisterSyncNote(note);
    }

    // public async syncNote(note: vscode.NotebookDocument | undefined) {
    //     return this._updateMutex.runExclusive(async () => this._syncNote(note));
    // }

    public async applyPolledNotebookEdits() {
        for (let [cell, edits] of this._mapNotebookEdits) {
            let editor = new vscode.WorkspaceEdit();
            editor.set(cell.document.uri, edits);
            await vscode.workspace.applyEdit(editor);
        }
        this._mapNotebookEdits.clear();
    }

    public async createParagraph(cell: vscode.NotebookCell) {
        let text = cell.document.getText();
        let lineNumbers = vscode.workspace.getConfiguration("editor")
            .get("lineNumbers", vscode.TextEditorLineNumbersStyle.Off);

		let lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "plain_text";
        let config = {
            "lineNumbers": lineNumbers !== vscode.TextEditorLineNumbersStyle.Off,
            "editorMode": `ace/mode/${lang}`,
            "editorSetting": {
                "language": lang,
                "editOnDblClick": false,
                "completionKey": "TAB",
                "completionSupport": cell.kind !== 1
            }
        };

        let res = await this._service?.createParagraph(
            cell.notebook.metadata.id, text, cell.index, '', config);
        if (res instanceof AxiosError) {
            vscode.window.showWarningMessage(`Create paragraph failed with message: ${res.message}`);
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

    public async updateParagraphText(cell: vscode.NotebookCell) {
        let text = cell.document.getText();
        let res = await this._service?.updateParagraphText(
            cell.notebook.metadata.id, cell.metadata.id, text
        );
        if (res instanceof AxiosError) {
            logDebug("error in updateParagraphText", res);
            await this.updateCellMetadata(cell, {"status": res.response?.status});
            throw res;
        }

        await this.pollUpdateCellMetadata(cell, res?.data.body);
    }

    public async updateParagraphConfig(cell: vscode.NotebookCell) {
        var lineNumbers = vscode.workspace.getConfiguration("editor")
            .get("lineNumbers", vscode.TextEditorLineNumbersStyle.Off)
            !== vscode.TextEditorLineNumbersStyle.Off;

        let lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "plain_text";
        let config = {
            "lineNumbers": cell.metadata?.config.lineNumbers ?? lineNumbers,
            "editorMode": `ace/mode/${lang}`,
            "editorSetting": {
                "language": lang,
                "editOnDblClick": false,
                "completionKey": "TAB",
                "completionSupport": cell.kind !== 1
            } };
    
        let res = await this._service?.updateParagraphConfig(
            cell.notebook.metadata.id, cell.metadata.id, config
        );
        if (res instanceof AxiosError) {
            logDebug("error in updateParagraphConfig", res);
            await this.updateCellMetadata(cell, {"status": res.response?.status});
            throw res;
        }

        logDebug(`UpdateParagraphConfig: pollUpdateCellMetadata`);
        await this.pollUpdateCellMetadata(cell, res?.data.body);
    }

    public async updateParagraph(cell: vscode.NotebookCell) {
        try {
            // index = -1: cell has been deleted from notebook
            if (cell.index === -1)
            {
                logDebug(`updateParagraph: cell to be deleted`, cell);
                this.cellStatusBar?.untrackCell(cell);
                this._service?.deleteParagraph(
                    cell.notebook.metadata.id, cell.metadata.id
                );
                if (!this._mapUpdateParagraph.has(cell)) {
                    this._mapUpdateParagraph.delete(cell);
                }
                logDebug(`updateParagraph: sync cell metadata`, cell);
                await this.updateNoteMetadata(
                    cell.notebook,
                    await this.getNoteInfo(cell.notebook) ?? {}
                );
                return;
            }

            // create corresponding paragraph when a cell is newly created
            if (cell.metadata.id === undefined)
            {
                logDebug(`updateParagraph: cell to be created`, cell);
                await this.createParagraph(cell);
                logDebug(`updateParagraph: sync cell metadata`, cell);
                await this.updateNoteMetadata(
                    cell.notebook,
                    await this.getNoteInfo(cell.notebook) ?? {}
                );
            }
            // check if cell index has changed
            else if (cell.index !== 
                cell.notebook.metadata.paragraphs.findIndex(
                    (paragraph: ParagraphData) => paragraph.id === cell.metadata.id
                ))
            {
                logDebug(`updateParagraph: cell position to be changed`, cell);
                // cell index has changed, update to server
                await this.getService()?.moveParagraphToIndex(
                    cell.notebook.metadata.id, cell.metadata.id, cell.index
                );
                logDebug(`updateParagraph: sync cell metadata`, cell);
                await this.updateNoteMetadata(
                    cell.notebook,
                    await this.getNoteInfo(cell.notebook) ?? {}
                );
            }
            else
            {
                logDebug("updateParagraph: updateParagraphConfig");
                let res = await this.updateParagraphConfig(cell);
                logDebug("updateParagraph: updateParagraphText");
                res = await this.updateParagraphText(cell);
            }

            if (cell.kind <= 1)
            {
                // need to call remote execution for markup paragraph languages
                // so remote notebook paragraph result could be generated
                // as markup languages are rendered locally
                this._runParagraph(cell, false);
            }
        } catch (err)
        {
            logDebug("error in updateParagraph", err);
        }

        // unregister cell from poll, as the update is either finished or failed now
        await this.unregisterParagraphUpdate(cell);
    }

    private async _runParagraph(cell: vscode.NotebookCell, sync: boolean) {
        let res = await this._service?.runParagraph(
            cell.notebook.metadata.id, cell.metadata.id, sync
        );
        if (!sync) {
            return res?.data ?? [];
        }

        if (!res?.data.body) {
            return [];
        }

        let paragraphResult = <ParagraphResult> res?.data.body;

        let cellOutput = parseParagraphResultToCellOutput(paragraphResult);
        await this.pollUpdateCellMetadata(cell, {results: paragraphResult});

        return cellOutput;
    }

    private async _executeAll(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
        ) {
        if (!this.isActive()) {
            promptZeppelinServerURL(this);
            return;
        }

        let config = vscode.workspace.getConfiguration('zeppelin');
        let concurrency = config.get('execution.concurrency', 'sequential');
        for (let cell of cells) {
            logDebug(`execute in ${concurrency}`, cell);
            if (concurrency === 'parallel') {
                this._doExecutionAsync(cell);
            }
            else {
                let isSuccess = await this._executeMutex.runExclusive(async () => {
                    return await this._doExecutionSync(cell);
                });
                if (!isSuccess) {
                    return;
                }
            }
		}
	}

    private async _interruptAll(note: vscode.NotebookDocument) {
        if (!this.isActive()) {
            return;
        }

        await this.instantUpdatePollingParagraphs();

        let res = await this.getService()?.stopAll(note.metadata.id);
        return res?.data;
	}

    private async _doExecutionSync(cell: vscode.NotebookCell) {
        if (!this.isActive() || cell.index < 0) {
            return false;
        }

        await this.instantUpdatePollingParagraphs();

        if (cell.metadata.status === 404) {
            promptCreateParagraph(this, cell);
            return;
        }

        const execution = this._controller.createNotebookCellExecution(cell);
        execution.token.onCancellationRequested(async _ => {
            this.getService()?.cancelConnect();
            this.stopParagraph(execution.cell);
            execution.clearOutput();
        });

        execution.start(Date.now());

        try {
            let cellOutput = await this._runParagraph(cell, true);
            if (cellOutput && cellOutput.length > 0) {
                execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
            }
            else {
                execution.clearOutput();
            }
            execution.end(true, Date.now());
            return true;

        } catch (err) {
            let cellOutput: vscode.NotebookCellOutput;

            if (err instanceof AxiosError && err.code === "ERR_CANCELED") {
                execution.end(false, Date.now());
            }
            else {
                cellOutput = new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({ 
                        name: err instanceof Error && err.name || 'error', 
                        message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)
                    })
                ]);
                execution.replaceOutput(cellOutput);
                execution.end(false, Date.now());
            }
            return false;
        }
    }

    private async _doExecutionAsync(cell: vscode.NotebookCell): Promise<void> {
        if (!this.isActive() || this.getExecutionByParagraphId(cell.metadata.id)) {
            return;
        }

        await this.instantUpdatePollingParagraphs();

        if (cell.metadata.status === 404) {
            promptCreateParagraph(this, cell);
            return;
        }

        const execution = this._controller.createNotebookCellExecution(cell);
        execution.token.onCancellationRequested(async _ => {
            await this.stopParagraph(execution.cell);
        });
        try {
            let paragraph = await this.getParagraphInfo(cell);

            if ((paragraph.status !== "RUNNING") && (cell.metadata.status !== "PENDING")) {
                this._runParagraph(cell, false);
            }
            else {
                logDebug("_doExecutionAsync register running paragraph", paragraph);
            }
        } catch (err) {
            execution.start(Date.now());
            let cellOutput: vscode.NotebookCellOutput;

            if (err instanceof AxiosError && err.code === "ERR_CANCELED") {
                execution.end(false, Date.now());
            }
            else {
                cellOutput = new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({ 
                        name: err instanceof Error && err.name || 'error', 
                        message: err instanceof Error && err.message || JSON.stringify(err, undefined, 4)
                    })
                ]);
                execution.replaceOutput(cellOutput);
                execution.end(false, Date.now());
            }
            return;
        }

        execution.start(Date.now());
        // execution.setProgress(10);
        this.registerTrackExecution(execution);
    }
}
