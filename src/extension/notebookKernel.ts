// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { NotebookService } from '../common/api';
import { EXTENSION_NAME,
    SUPPORTED_LANGUAGE,
    mapZeppelinLanguage,
    logDebug,
    getProxy,
    getVersion } from '../common/common';
import { CellStatusProvider } from '../component/cellStatusBar';
import { NoteData,
    ParagraphData, ParagraphResult } from '../common/types';
import { showQuickPickURL,
    doLogin,
    promptCreateParagraph } from '../common/interaction';
import { parseParagraphToCellData,
    parseParagraphResultToCellOutput } from '../common/parser';
import { Mutex } from '../component/mutex';
import { ExecutionManager } from '../component/execution';
// import ForProgress from '../component/ForProgress/ForProgress';
const _ = require('lodash');


export class ZeppelinKernel
{
    readonly id: string = 'zeppelin-notebook-kernel';
    readonly notebookType: string = 'zeppelin-notebook';
    readonly label: string = 'Zeppelin Notebook';
    readonly supportedLanguages = SUPPORTED_LANGUAGE;

    private _context: vscode.ExtensionContext;
    private _service?: NotebookService;
    private readonly _controller: vscode.NotebookController;
    private _isActive = false;
    private _updateMutex = new Mutex("_updateMutex");
    private _editMutex = new Mutex("_editMutex");

    // private _timerSyncNote?: ReturnType<typeof setInterval>;
    private _timerUpdateCell?: ReturnType<typeof setInterval>;
    private _executionManager?: ExecutionManager;
    private _mapSyncNote = new Map<
        vscode.NotebookDocument, number
    >();
    private _mapNotebookEdits = new Map<vscode.NotebookCell, vscode.NotebookEdit[]>();
    private _mapUpdateParagraph = new Map<vscode.NotebookCell, number>();
    private _flagRegisterParagraphUpdate = true;
    private _mapParagraphCache = new Map<string, { data: ParagraphData | null, timestamp: number }>();
    private _timerRefreshParagraphCache?: ReturnType<typeof setInterval>;
    private _sessionExpiredPromptActive = false;

    public cellStatusBar: CellStatusProvider | undefined = undefined;

	constructor(context: vscode.ExtensionContext, service?: NotebookService)
    {
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
        this._executionManager = new ExecutionManager(this);

        this.activate();
	}

	dispose(): void
    {
        this.deactivate();
		this._controller.dispose();
	}

    activate()
    {
        this._isActive = !!this._service && !!this._service.baseURL;

        if (this._isActive)
        {
            let label = this._context.workspaceState.get('currentZeppelinServerName', this.label);
            let desc = this._context.workspaceState.get('currentZeppelinServerURL', undefined);
            this.setDisplay(label, EXTENSION_NAME, desc);

            let config = vscode.workspace.getConfiguration('zeppelin');
            if (this._timerUpdateCell === undefined)
            {
                let poolingInterval = config.get('autosave.poolingInterval', 5);
    
                this._timerUpdateCell = setInterval(async () =>
                {
                    // sync server and local
                    await this._doUpdatePollingParagraphs.bind(this)();
                    await this.cellStatusBar?.doUpdateVisibleCells();
                },
                poolingInterval * 1000);
            }

            if (this._timerRefreshParagraphCache === undefined)
            {
                let cacheInterval: number = config.get('paragraphCache.refreshInterval', 5);

                this._timerRefreshParagraphCache = setInterval(
                    this._doRefreshParagraphCache.bind(this),
                    cacheInterval * 1000
                );
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

            this._executionManager?.scheduleTracking();
            this.cellStatusBar?.scheduleTracking();
        }
        logDebug("activate", this.isActive());
        return this.isActive();
    }

    deactivate()
    {
        if (!this.isActive())
        {
            return false;
        }

        this.setDisplay(this.label, EXTENSION_NAME);

        if (this._timerUpdateCell !== undefined)
        {
            // run registered update paragraph task immediately
            // and unregister it after completed
            clearInterval(this._timerUpdateCell);
            this.instantUpdatePollingParagraphs();
            this._timerUpdateCell = undefined;
        }

        if (this._timerRefreshParagraphCache !== undefined)
        {
            clearInterval(this._timerRefreshParagraphCache);
            this._timerRefreshParagraphCache = undefined;
            this._mapParagraphCache.clear();
        }

        // if (this._timerSyncNote !== undefined) {
        //     clearInterval(this._timerSyncNote);
        //     this._timerSyncNote = undefined;
        // }

        this._executionManager?.dispose();
        this.cellStatusBar?.dispose();

        this._isActive = false;
        logDebug("activate", this.isActive());
        return this.isActive();
    }

    isActive()
    {
        return this._isActive;
    }

    setDisplay(label: string, description?: string, detail?: string)
    {
        this._controller.label = label;
        this._controller.description = description;
        this._controller.detail = detail;
    }

    getContext()
    {
        return this._context;
    }

    getController()
    {
        return this._controller;
    }

    setService(baseURL: string)
    {
        let userAgent = `${EXTENSION_NAME}/${getVersion(this._context)} vscode-extension/${vscode.version}`;

        let config = vscode.workspace.getConfiguration('zeppelin');
        let timeout: number = config.get('https.timeout', 10);
        let caPath: string | undefined = config.get('https.CA-Certification');
        let keyPath: string | undefined = config.get('https.KeyPath');
        let passphase: string | undefined = config.get('https.passphase');
        let rejectUnauthorized = config.get('https.rejectUnauthorized', false);

        let service = new NotebookService(baseURL, userAgent, getProxy(), timeout);
        service.setHttpsAgent(caPath, keyPath, passphase, rejectUnauthorized);

        service.onSessionExpired = this._onSessionExpired.bind(this);
        this._service = service;
        return service;
    }

    private async _onSessionExpired()
    {
        // debounce: only show one prompt at a time
        if (this._sessionExpiredPromptActive)
        {
            return;
        }
        this._sessionExpiredPromptActive = true;

        // cancel all running executions
        this._executionManager?.cancelAllExecutions();
        this.deactivate();

        const selection = await vscode.window.showWarningMessage(
            'Your Zeppelin session has expired. Please log in again.',
            'Login', 'Change Server'
        );

        this._sessionExpiredPromptActive = false;

        if (selection === 'Login')
        {
            this.checkInService(this._service?.baseURL);
        }
        else if (selection === 'Change Server')
        {
            this.checkInService(undefined);
        }
    }

    getService()
    {
        return this._service;
    }

    private async _activateService(baseURL: string | undefined)
    {
        if (!baseURL)
        {
            return this.deactivate();
        }

        let service = this.setService(baseURL);
        let isSuccess = await doLogin(this._context, service);
        if (isSuccess)
        {
            return this.activate();
        }
        else
        {
            return this.deactivate();
        }
    }

    public async checkInService(
        baseURL?: string,
        onDidServiceActivate?: Function
    ) {
        if (baseURL === this._service?.baseURL && this.isActive())
        {
            if (onDidServiceActivate !== undefined)
            {
                onDidServiceActivate();
            }
            return;
        }

        if (!baseURL) {
            showQuickPickURL(this._context, (async () =>
            {
                // baseURL is supposed not to be null or undefined by now
                baseURL = this._context.workspaceState.get('currentZeppelinServerURL');

                let isActive = await this._activateService(baseURL);
                if (isActive && onDidServiceActivate !== undefined)
                {
                    onDidServiceActivate();
                }

            }).bind(this));
        }
        else {
            let isActive = await this._activateService(baseURL);
            if (isActive && onDidServiceActivate !== undefined)
            {
                onDidServiceActivate();
            }
        }
    }

    public async listNotes()
    {
        let res = await this._service?.listNotes();
        return res?.data ? res?.data.body : [];
    }

    public async hasNote(noteId: string | undefined)
    {
        if (noteId === undefined)
        {
            return false;
        }

        for (let note of await this.listNotes())
        {
            // before Zeppelin 10.0, path of note
            // is stored in 'name' key instead of 'path'
            let path = note.path ?? note.name;
            if (!path.startsWith('/~Trash') && note.id === noteId)
            {
                return true;
            }
        }
        return false;
    }

    public async createNote(name: string, paragraphs?: ParagraphData[])
    {
        let res = await this._service?.createNote(name, paragraphs);

        if (res instanceof AxiosError)
        {
            logDebug("error in createNote", res);
            if (res.response?.status === 500)
            {
                vscode.window.showErrorMessage(
                    `Cannot create note. Please check if note name
                     is duplicated on the server.`);
            }
            else
            {
                vscode.window.showErrorMessage(`${res.code}: ${res.message}`);
            }
        }

        return res?.data.body;
    }

    public async importNote(note: any) {
        let res = await this._service?.importNote(note);

        logDebug("error in importNote", res);
        if (res instanceof AxiosError)
        {
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
    
        if (res instanceof AxiosError)
        {
            vscode.window.showWarningMessage(
                `Unable to get info for note ${noteId}, ` +
                res.response ? res.response?.data : `${res.code}: ${res.message}`
            );
            return;
        }
        else if (res?.status === 500 || res?.status === 404)
        {
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
        let config = vscode.workspace.getConfiguration('zeppelin');
        let cacheInterval: number = config.get('paragraphCache.refreshInterval', 5);
        let paragraphId = cell.metadata.id;

        // Check cache for fresh data
        if (paragraphId !== undefined)
        {
            let cached = this._mapParagraphCache.get(paragraphId);
            if (cached !== undefined
                && (Date.now() - cached.timestamp) < cacheInterval * 1000)
            {
                if (cached.data === null)
                {
                    // 404 sentinel: paragraph doesn't exist on server
                    await this.editWithoutParagraphUpdate(async () => {
                        await this.updateCellMetadata(cell, {"status": 404});
                    });
                    return <ParagraphData> cell.metadata;
                }

                this.pollUpdateCellMetadata(cell, cached.data);
                return cached.data;
            }
        }

        // Cache miss or stale: fetch from network
        let res = await this.getService()?.getParagraphInfo(
            cell.notebook.metadata.id, cell.metadata.id);
        let paragraph: ParagraphData;

        if (res instanceof AxiosError)
        {
            if (res.response?.status === 404)
            {
                // Cache the 404 sentinel
                if (paragraphId !== undefined)
                {
                    this._mapParagraphCache.set(paragraphId, { data: null, timestamp: Date.now() });
                }
                const res = await promptCreateParagraph(this, cell);
                paragraph = res?.data.body ?? cell.metadata;
                return paragraph;
            }
            else
            {
                logDebug(
                    `Unable to get paragraph info ${cell.metadata.id} 
                    in note '${cell.notebook.metadata.name}'`, res
                );
                throw res;
            }
        }
        else
        {
            paragraph = res?.data.body ?? res?.data;
        }

        // Cache the successful result
        if (paragraphId !== undefined)
        {
            this._mapParagraphCache.set(paragraphId, { data: paragraph, timestamp: Date.now() });
        }

        this.pollUpdateCellMetadata(cell, paragraph);
        return paragraph;
    }

    private async _doRefreshParagraphCache()
    {
        const activeNotebook = vscode.window.activeNotebookEditor;
        if (activeNotebook === undefined || activeNotebook.notebook.cellCount === 0)
        {
            return;
        }

        const noteId = activeNotebook.notebook.metadata.id;
        if (noteId === undefined) { return; }

        // Collect fresh data from network first, then apply to cache atomically
        const freshEntries: { paragraphId: string, data: ParagraphData | null }[] = [];

        for (let range of activeNotebook.visibleRanges)
        {
            if (range.isEmpty) { continue; }

            for (let i = range.start; i < range.end; i++)
            {
                let cell = activeNotebook.notebook.cellAt(i);
                let paragraphId = cell.metadata.id;
                if (paragraphId === undefined) { continue; }

                try
                {
                    let res = await this.getService()?.getParagraphInfo(noteId, paragraphId);
                    if (res instanceof AxiosError)
                    {
                        if (res.response?.status === 404)
                        {
                            freshEntries.push({ paragraphId, data: null });
                        }
                        else
                        {
                            logDebug(`_doRefreshParagraphCache: error for ${paragraphId}`, res);
                        }
                    }
                    else
                    {
                        let paragraph: ParagraphData = res?.data.body ?? res?.data;
                        freshEntries.push({ paragraphId, data: paragraph });
                    }
                }
                catch (err)
                {
                    logDebug(`_doRefreshParagraphCache: error for ${paragraphId}`, err);
                }
            }
        }

        // Apply fresh entries only if they are newer than what's in the cache
        for (let { paragraphId, data } of freshEntries)
        {
            let cached = this._mapParagraphCache.get(paragraphId);
            // Only overwrite if no cached entry exists or the cached entry
            // was written before we started fetching (prevents overwriting
            // a fresher entry that getParagraphInfo wrote concurrently)
            if (cached === undefined || cached.timestamp <= Date.now())
            {
                this._mapParagraphCache.set(paragraphId, { data, timestamp: Date.now() });
            }
        }
    }

    public async runParagraph(cell: vscode.NotebookCell, sync: boolean)
    {
        let res = await this.getService()?.runParagraph(
            cell.notebook.metadata.id, cell.metadata.id, sync
        );
        if (!sync)
        {
            return res?.data ?? [];
        }

        if (!res?.data.body)
        {
            return [];
        }

        let paragraphResult = <ParagraphResult> res?.data.body;

        let cellOutput = parseParagraphResultToCellOutput(paragraphResult);
        await this.pollUpdateCellMetadata(
            cell, {results: paragraphResult}
        );

        return cellOutput;
    }

    public async stopParagraph(cell: vscode.NotebookCell)
    {
        let res = await this.getService()?.stopParagraph(
            cell.notebook.metadata.id, cell.metadata.id
        );
        return res?.status === 200;
    }

    public getExecutionByParagraphId(paragraphId: string)
    {
        return this._executionManager?.getExecutionByParagraphId(paragraphId);
    }

    public registerParagraphUpdate(cell: vscode.NotebookCell)
    {
        if (!this._flagRegisterParagraphUpdate)
        {
            logDebug("registerParagraphUpdate: cell not to be updated", cell);
            return;
        }

        if (cell.metadata.resolvingDiff)
        {
            logDebug("registerParagraphUpdate: cell is resolving diff, skipped", cell);
            return;
        }

        logDebug("registerParagraphUpdate", cell);
        return this._updateMutex.runExclusive(async () =>
        {
            if (!this._mapUpdateParagraph.has(cell))
            {
                this._mapUpdateParagraph.set(cell, Date.now());
            }
        });
    }

    /**
     * Unregister a cell from paragraph update polling.
     * Acquires _updateMutex — do NOT call from within _updateMutex.runExclusive.
     * For internal use (already holding the mutex), call _unregisterParagraphUpdateDirect.
     */
    public async unregisterParagraphUpdate(cell: vscode.NotebookCell)
    {
        logDebug("unregisterParagraphUpdate", cell);
        return this._updateMutex.runExclusive(async () =>
        {
            return this._mapUpdateParagraph.delete(cell);
        });
    }

    /**
     * Internal version: removes cell from update map without acquiring _updateMutex.
     * Caller MUST already hold _updateMutex.
     */
    private _unregisterParagraphUpdateDirect(cell: vscode.NotebookCell)
    {
        logDebug("_unregisterParagraphUpdateDirect", cell);
        return this._mapUpdateParagraph.delete(cell);
    }

    public async instantUpdatePollingParagraphs() {
        logDebug("instantUpdatePollingParagraphs", this._mapUpdateParagraph);
        // let notebookCells = Array.from(this._mapUpdateParagraph.keys());
        return this._updateMutex.runExclusive(async () => {
            // Promise.all(notebookCells.map(this.updateParagraph.bind(this)))
            for (let cell of this._mapUpdateParagraph.keys())
            {
                await this._updateParagraph(cell);
            }
            logDebug("instantUpdatePollingParagraphs ends");
        });
    }

    public async editWithoutParagraphUpdate(func: () => Promise<void>)
    {
        return this._editMutex.runExclusive(async () =>
        {
            this._flagRegisterParagraphUpdate = false;
            let res = await func();
            this._flagRegisterParagraphUpdate = true;
            return res;
        });
    }

    private async _doUpdatePollingParagraphs()
    {
        let config = vscode.workspace.getConfiguration('zeppelin');
        let throttleTime: number = config.get('autosave.throttleTime', 3);

        logDebug("_doUpdatePollingParagraphs", this._mapUpdateParagraph);
        for (let [cell, requestTime] of this._mapUpdateParagraph)
        {
            if (cell.metadata.resolvingDiff)
            {
                logDebug("_doUpdatePollingParagraphs: cell is resolving diff, skipped", cell);
                continue;
            }
            if (!this.isNoteSyncing(cell.notebook)   // disregard syncing cells
                && throttleTime * 1000 < Date.now() - requestTime) {
                if (cell.index < 0)
                {
                    logDebug("_doUpdatePollingParagraphs: deleted cell", cell);
                }
                await this.updateParagraph(cell);
            }
        }
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
        return this._editMutex.runExclusive(async () =>
        {
            let paragraph = await this.getParagraphInfo(cell);
            let parsedCell = parseParagraphToCellData(paragraph);
            let replaceRange = new vscode.NotebookRange(cell.index, cell.index + 1);

            this._flagRegisterParagraphUpdate = false;
            let res = await this.replaceNoteCells(
                cell.notebook, replaceRange, [parsedCell]
            );
            this._flagRegisterParagraphUpdate = true;
            return res;
        });
    }

    public async updateCellMetadata(
        cell: vscode.NotebookCell,
        metadata: { [key: string]: any }
    ) {
        if (cell.index < 0)
        {
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
        return this.editWithoutParagraphUpdate(async () => {
            if (cell.index === -1)
            {
                this._mapNotebookEdits.delete(cell);
                return;
            }

            let edit = vscode.NotebookEdit.updateCellMetadata(
                cell.index,
                // update based on new metadata provided
                Object.assign({}, cell.metadata, metadata)
            );
            if (this._mapNotebookEdits.has(cell))
            {
                this._mapNotebookEdits.get(cell)?.push(edit);
            }
            else {
                this._mapNotebookEdits.set(cell, [edit]);
            }
        })
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

        if (replaceRange !== undefined && replaceCells !== undefined)
        {
            aryEdits.push(vscode.NotebookEdit.replaceCells(replaceRange, replaceCells));
        }
        if (insertIndex !== undefined && insertCells !== undefined)
        {
            aryEdits.push(vscode.NotebookEdit.insertCells(insertIndex, insertCells));
        }
        if (deleteRange !== undefined)
        {
            aryEdits.push(vscode.NotebookEdit.deleteCells(deleteRange));
        }
        if (metadata !== undefined)
        {
            aryEdits.push(vscode.NotebookEdit.updateNotebookMetadata(metadata));
        }

        editor.set(note.uri, aryEdits);
        return vscode.workspace.applyEdit(editor);
    }

    private _registerSyncNote(note: vscode.NotebookDocument) {
        this._mapSyncNote.set(note, Date.now());
    }

    private _unregisterSyncNote(note: vscode.NotebookDocument) {
        if (this._mapSyncNote.has(note))
        {
            this._mapSyncNote.delete(note);
        }
    }

    public isNoteSyncing(note: vscode.NotebookDocument | undefined) {
        if (note === undefined)
        {
            return false;
        }
        return this._mapSyncNote.has(note);
    }

    /**
     * Convert a live NotebookCell to NotebookCellData so it can survive
     * a full-cell replace operation. Preserves kind, text, language,
     * metadata and outputs.
     */
    private _cellToCellData(cell: vscode.NotebookCell): vscode.NotebookCellData
    {
        let cellData = new vscode.NotebookCellData(
            cell.kind,
            cell.document.getText(),
            cell.document.languageId
        );
        cellData.metadata = { ...cell.metadata };
        cellData.outputs = cell.outputs.map(output =>
            new vscode.NotebookCellOutput(
                output.items.map(item =>
                    new vscode.NotebookCellOutputItem(item.data, item.mime)
                ),
                output.metadata
            )
        );
        return cellData;
    }

    /**
     * Detect whether a local cell differs from its server paragraph.
     * Compares text, cell kind, language, and execution results.
     */
    private _hasSyncConflict(
        cell: vscode.NotebookCell,
        serverParagraph: ParagraphData,
        serverCellData: vscode.NotebookCellData
    ): boolean
    {
        let localText = cell.document.getText();
        let serverText = serverParagraph.text ?? '';
        if (localText !== serverText) { return true; }

        if (cell.kind !== serverCellData.kind) { return true; }

        if (cell.document.languageId !== serverCellData.languageId) { return true; }

        // Compare execution results stored in metadata
        let localResults = cell.metadata.results;
        let serverResults = serverParagraph.results;
        if (JSON.stringify(localResults) !== JSON.stringify(serverResults))
        {
            return true;
        }

        return false;
    }

    /**
     * Sync local notebook with the server using a non-destructive merge.
     *
     * Keeps local cells whose id matches a server paragraph, flagging
     *  them with `metadata.syncConflict` when content differs.
     * Inserts server-only paragraphs (not present locally) at the
     *  correct position.
     * Preserves local-only cells (no id or id not on server) in their
     *   relative positions, anchored after the nearest preceding matched cell.
     */
    public async syncNote(note: vscode.NotebookDocument | undefined) {
        if (note === undefined)
        {
            return;
        }
        if (!!!note.metadata || !!!note.metadata.id)
        {
            vscode.window.showWarningMessage("Unable to sync note as note id is not found");
            return;
        }

        return await this._updateMutex.runExclusive(async () => {

        this._registerSyncNote(note);
        logDebug("syncNote start");
        let serverNote = await this.getNoteInfo(note);
        if (serverNote === undefined)
        {
            logDebug("syncNote failed");
            this._unregisterSyncNote(note);
            return;
        }

        let serverParagraphs = serverNote.paragraphs ?? [];

        // Build lookup structures
        let serverIdSet = new Set(serverParagraphs.map(p => p.id));

        let localCellMap = new Map<string, vscode.NotebookCell>();
        for (let cell of note.getCells())
        {
            if (cell.metadata.id !== undefined)
            {
                localCellMap.set(cell.metadata.id, cell);
            }
        }

        // Anchor local-only cells to the nearest preceding matched cell.
        // Key = id of the anchor cell (null = before any matched cell).
        let localOnlyAnchored = new Map<string | null, vscode.NotebookCell[]>();
        let lastMatchedId: string | null = null;

        for (let cell of note.getCells())
        {
            let cellId = cell.metadata.id;
            if (cellId === undefined || !serverIdSet.has(cellId))
            {
                // Local-only cell
                if (!localOnlyAnchored.has(lastMatchedId))
                {
                    localOnlyAnchored.set(lastMatchedId, []);
                }
                localOnlyAnchored.get(lastMatchedId)!.push(cell);
            }
            else
            {
                lastMatchedId = cellId;
            }
        }

        // Build merged cell list walking server paragraphs in order
        let mergedCells: vscode.NotebookCellData[] = [];
        // Track which indices in mergedCells originate from the server
        // (matched or server-only) so we can resume execution status.
        let serverCellIndices: number[] = [];

        // Emit local-only cells anchored before the first matched cell
        for (let cell of localOnlyAnchored.get(null) ?? [])
        {
            mergedCells.push(this._cellToCellData(cell));
        }

        for (let serverParagraph of serverParagraphs)
        {
            let localCell = localCellMap.get(serverParagraph.id);
            let serverCellData = parseParagraphToCellData(serverParagraph);

            if (localCell !== undefined)
            {
                // Matched cell — keep local version, detect conflict
                let localCellData = this._cellToCellData(localCell);

                if (localCell.metadata.resolvingDiff)
                {
                    // Cell is in diff-resolution mode — preserve existing
                    // conflict and resolvingDiff flags untouched so the
                    // user can finish resolving without the markers vanishing.
                    localCellData.metadata = {
                        ...localCellData.metadata,
                        syncConflict: localCell.metadata.syncConflict,
                        resolvingDiff: true
                    };
                }
                else if (this._hasSyncConflict(localCell, serverParagraph, serverCellData))
                {
                    localCellData.metadata = {
                        ...localCellData.metadata,
                        syncConflict: serverParagraph
                    };
                }
                else
                {
                    // Clear any previous conflict marker
                    let meta = { ...localCellData.metadata };
                    delete meta.syncConflict;
                    delete meta.resolvingDiff;
                    localCellData.metadata = meta;
                }

                serverCellIndices.push(mergedCells.length);
                mergedCells.push(localCellData);
            }
            else
            {
                // Server-only cell — insert new
                serverCellIndices.push(mergedCells.length);
                mergedCells.push(serverCellData);
            }

            // Emit local-only cells anchored after this server paragraph
            for (let cell of localOnlyAnchored.get(serverParagraph.id) ?? [])
            {
                mergedCells.push(this._cellToCellData(cell));
            }
        }

        let replaceRange = new vscode.NotebookRange(0, note.cellCount);

        await this.editWithoutParagraphUpdate(async () =>
        {
            // Unregister updates for all current cells
            // Note: already inside _updateMutex, use direct version
            for (let cell of note.getCells())
            {
                this._unregisterParagraphUpdateDirect(cell);
            }

            await this.editNote(
                note, replaceRange, mergedCells,
                undefined, undefined, undefined,
                serverNote
            );

            // Resume execution status only for server-sourced cells
            for (let idx of serverCellIndices)
            {
                if (idx < note.cellCount)
                {
                    let cell = note.cellAt(idx);
                    let serverCellData = mergedCells[idx];
                    this._executionManager?.resumeExecutionStatus(cell, serverCellData);
                }
            }
        });

        this._unregisterSyncNote(note);
        logDebug("syncNote end");
    });
    }

    // public async syncNote(note: vscode.NotebookDocument | undefined) {
    //     return this._updateMutex.runExclusive(async () => this._syncNote(note));
    // }

    /**
     * Accept the remote (server) version of a cell, replacing local content
     * and clearing the syncConflict and resolvingDiff markers.
     */
    public async acceptRemoteCell(cell: vscode.NotebookCell)
    {
        let conflict: ParagraphData | undefined = cell.metadata.syncConflict;
        if (conflict === undefined)
        {
            return;
        }

        let serverCellData = parseParagraphToCellData(conflict);
        // Clear the conflict and resolving markers on the replacement cell
        let meta = { ...serverCellData.metadata };
        delete meta.syncConflict;
        delete meta.resolvingDiff;
        serverCellData.metadata = meta;

        let replaceRange = new vscode.NotebookRange(cell.index, cell.index + 1);

        await this.editWithoutParagraphUpdate(async () =>
        {
            await this.replaceNoteCells(cell.notebook, replaceRange, [serverCellData]);
        });
    }

    /**
     * Accept the local version of a cell, pushing local text to the server
     * and clearing the syncConflict and resolvingDiff markers.
     */
    public async acceptLocalCell(cell: vscode.NotebookCell)
    {
        if (cell.metadata.syncConflict === undefined)
        {
            return;
        }

        // Clear conflict markers first
        await this.editWithoutParagraphUpdate(async () =>
        {
            let meta = { ...cell.metadata };
            delete meta.syncConflict;
            delete meta.resolvingDiff;
            await this.updateCellMetadata(cell, meta);
        });

        // Push local text to server
        try
        {
            await this.updateParagraphText(cell);
        }
        catch (err)
        {
            logDebug("acceptLocalCell: error pushing local text to server", err);
            vscode.window.showWarningMessage(
                `Failed to push local changes to server: ${err instanceof Error ? err.message : err}`
            );
        }
    }

    public async applyPolledNotebookEdits() {
        return this.editWithoutParagraphUpdate(async () => {
            for (let [cell, edits] of this._mapNotebookEdits)
            {
                let editor = new vscode.WorkspaceEdit();
                editor.set(cell.document.uri, edits);
                await vscode.workspace.applyEdit(editor);
            }
            this._mapNotebookEdits.clear();
        })
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
        if (res instanceof AxiosError)
        {
            vscode.window.showWarningMessage(`Create paragraph failed with message: ${res.message}`);
            throw res;
        }

        await this.editWithoutParagraphUpdate(async () => {
            await this.updateCellMetadata(
                cell,
                {
                    id: res?.data.body,
                    config
                }
            );
        });
        return cell.metadata;
    }

    public async updateParagraphText(cell: vscode.NotebookCell) {
        let text = cell.document.getText();
        let res = await this._service?.updateParagraphText(
            cell.notebook.metadata.id, cell.metadata.id, text
        );
        if (res instanceof AxiosError)
        {
            logDebug("error in updateParagraphText", res);
            await this.editWithoutParagraphUpdate(async () => {
                await this.updateCellMetadata(cell, {"status": res.response?.status});
            })
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
        if (res instanceof AxiosError)
        {
            logDebug("error in updateParagraphConfig", res);
            await this.updateCellMetadata(cell, {"status": res.response?.status});
            throw res;
        }

        logDebug(`UpdateParagraphConfig: pollUpdateCellMetadata`);
        await this.pollUpdateCellMetadata(cell, res?.data.body);
    }

    private async _updateParagraph(cell: vscode.NotebookCell) {
        try {
            // index = -1: cell has been deleted from notebook
            if (cell.index === -1)
            {
                logDebug(`updateParagraph: cell to be deleted`, cell);
                this.cellStatusBar?.untrackCell(cell);
                this._service?.deleteParagraph(
                    cell.notebook.metadata.id, cell.metadata.id
                );

                this._mapUpdateParagraph.delete(cell);

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
                    (paragraph: ParagraphData) => paragraph.id === cell.metadata.id))
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
                this.runParagraph(cell, false);
            }
        } catch (err)
        {
            logDebug("error in updateParagraph", err);
            if (cell.metadata.id === undefined)
            {
                // retry creating cell
                return;
            }
        }

        // unregister cell from poll, as the update is either finished or failed now
        // Note: _updateParagraph is always called from within _updateMutex, use direct version
        this._unregisterParagraphUpdateDirect(cell);
    }

    public async updateParagraph(cell: vscode.NotebookCell)
    {
        return this._updateMutex.runExclusive(
            async () => 
            {
                return await this._updateParagraph(cell);
            }
        );
    }
}
