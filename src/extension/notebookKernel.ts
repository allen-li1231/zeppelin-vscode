// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { NotebookService } from '../common/api';
import { EXTENSION_NAME,
    SUPPORTED_LANGUAGE,
    mapLanguage,
    mapLanguageKind,
    mapZeppelinLanguage,
    mapVSCodeLanguage,
    getProxy,
    getVersion } from '../common/common';
import { logger } from '../common/logger';
import { CellStatusProvider } from '../component/cellStatusBar';
import { NoteData,
    ParagraphData, ParagraphResult } from '../common/types';
import { showQuickPickURL,
    doLogin,
    promptCreateParagraph } from '../common/interaction';
import { parseCellInterpreter,
    parseParagraphToCellData,
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
    private _updateMutex = new Mutex("updateMutex");
    private _editMutex = new Mutex("editMutex");

    /** Whether the edit mutex is currently held. */
    public isEditLocked(): boolean { return this._editMutex.isLocked(); }
    /** Whether the update mutex is currently held. */
    public isUpdateLocked(): boolean { return this._updateMutex.isLocked(); }

    // private _timerSyncNote?: ReturnType<typeof setInterval>;
    private _timerUpdateCell?: ReturnType<typeof setTimeout>;
    private _executionManager?: ExecutionManager;
    private _mapSyncNote = new Map<
        vscode.NotebookDocument, number
    >();
    private _mapNotebookEdits = new Map<vscode.NotebookCell, vscode.NotebookEdit[]>();
    private _mapUpdateParagraph = new Map<vscode.NotebookCell, { requestTime: number, baseText: string }>();
    private _editWithoutParagraphUpdateDepth = 0;
    private _mapInterpreterCache: Map<string, string> | undefined;
    private _sessionExpiredPromptActive = false;
    private _activationPromise?: Promise<void>;

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
                this._scheduleUpdateCell(poolingInterval * 1000);
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

            // Populate interpreter cache on activation, tracking the promise
            // so dispose() can guard against late writes.
            this._activationPromise = this.listInterpreters().then(map =>
            {
                if (this._isActive)
                {
                    this._mapInterpreterCache = map;
                    logger.info("interpreter cache populated", map);
                }
            }).catch(err =>
            {
                logger.warn("failed to populate interpreter cache", err);
            }).finally(() =>
            {
                this._activationPromise = undefined;
            });
        }
        logger.info("activate", this.isActive());
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
            clearTimeout(this._timerUpdateCell);
            this.updatePollingParagraphsDirect();
            this._timerUpdateCell = undefined;
        }

        // if (this._timerSyncNote !== undefined) {
        //     clearInterval(this._timerSyncNote);
        //     this._timerSyncNote = undefined;
        // }

        this._executionManager?.dispose();
        this.cellStatusBar?.dispose();

        this._mapInterpreterCache = undefined;
        this._activationPromise = undefined;

        this._isActive = false;
        logger.info("activate", this.isActive());
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
        logger.info(`setService: connecting to ${baseURL}`);
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
        logger.warn("session expired — prompting user to re-authenticate");
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
        logger.info(`_activateService: baseURL=${baseURL ?? '(none)'}`);
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
            logger.error("error in createNote", res);
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

        logger.debug("importNote response", res);
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
                `Unable to get info for note ${noteId}, `
                + (res.response ? res.response?.data : `${res.code}: ${res.message}`)
            );
            return;
        }
        else if (res?.status === 500 || res?.status === 404)
        {
            logger.error("error in getNoteInfo", res);
            vscode.window.showErrorMessage(
                `Unable to get note info: '${noteId}' doesn't exist on the server`);
            return;
        }

        let serverNote: NoteData = res?.data.body;
        return serverNote;
    }

    public async listInterpreters()
    {
		let res = await this.getService()?.listInterpreters();
        if (res instanceof AxiosError)
        {
            vscode.window.showWarningMessage(
                `Unable to fetch interpreter information, `
                + `please manually select a language model.`);
            return;
        }

        const interpreters = res?.data?.body as any[];

        const mapInterpreter = new Map<string, string>([]);
        for (let [_, interpreter] of Object.entries(interpreters))
        {
            if (mapVSCodeLanguage.has(interpreter.id))
            {
                mapInterpreter.set(
                    interpreter.id,
                    mapVSCodeLanguage.get(interpreter.id) ?? ''
                );
            }

            for (let subname of interpreter.interpreterGroup)
            {
                let lang = subname.editor?.language ?? subname.name;
                lang = mapVSCodeLanguage.get(lang);
                if (lang === undefined)
                {
                    continue;
                }

                if (subname.defaultInterpreter)
                {
                    mapInterpreter.set(interpreter.id, lang);
                }
                mapInterpreter.set(
                    `${interpreter.id}.${subname.name}`, lang
                );
            }
        }

        return mapInterpreter;
    }

    public async getParagraphInfo(
        cell: vscode.NotebookCell
    ) {
        let res = await this.getService()?.getParagraphInfo(
            cell.notebook.metadata.id, cell.metadata.id);
        let paragraph: ParagraphData;

        if (res instanceof AxiosError)
        {
            if (res.response?.status === 404)
            {
                const paragraph = await promptCreateParagraph(this, cell);

                if (paragraph !== undefined)
                {
                    return paragraph;
                }

                await this.editWithoutParagraphUpdate(async () => {
                    await this.updateCellMetadata(
                        cell, {"status": res.response?.status}
                    );
                });
                throw res;
            }
            else
            {
                logger.debug(
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

        logger.debug(`getParagraphInfo: got paragraph ${cell.metadata.id}, status=${paragraph.status}`);
        this.pollUpdateCellMetadata(cell, paragraph);
        return paragraph;
    }

    private _scheduleUpdateCell(intervalMs: number)
    {
        this._timerUpdateCell = setTimeout(async () =>
        {
            await this._doUpdatePollingParagraphs();
            await this.cellStatusBar?.doUpdateVisibleCells();
            // Flush deferred metadata updates (e.g. status from
            // getParagraphInfo) so cell status bar picks them up.
            await this.applyPolledNotebookEdits();
            // Only reschedule if not cancelled
            if (this._timerUpdateCell !== undefined)
            {
                this._scheduleUpdateCell(intervalMs);
            }
        }, intervalMs);
    }

    /**
     * Run a paragraph on the Zeppelin server.
     *
     * @param sync  When `true`, waits for completion and returns parsed
     *              `NotebookCellOutputItem[]`.  When `false`, fires and
     *              returns the raw response data (caller should poll for
     *              results via execution tracking).
     */
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

    public async registerParagraphUpdate(cell: vscode.NotebookCell)
    {
        if (this._editWithoutParagraphUpdateDepth > 0)
        {
            logger.debug("registerParagraphUpdate: cell not to be updated", cell);
            return;
        }

        if (cell.metadata.resolvingDiff)
        {
            logger.warn("registerParagraphUpdate: cell is resolving diff, skipped", cell);
            return;
        }

        logger.debug("registerParagraphUpdate", cell);

        return this._updateMutex.runExclusive(async () =>
        {
            // Flush any deferred metadata updates inside the mutex so
            // cell.metadata.text is current and the snapshot is atomic
            // with respect to other _updateMutex holders.
            await this.applyPolledNotebookEdits();

            if (!this._mapUpdateParagraph.has(cell))
            {
                // Snapshot the server text at registration time so we can
                // detect independent server-side changes before pushing.
                this._mapUpdateParagraph.set(cell, {
                    requestTime: Date.now(),
                    baseText: cell.metadata.text ?? ''
                });
            }
        });
    }

    /**
     * Check whether a cell has a pending (unsynced) paragraph update.
     * Used by CellStatusProvider to avoid false sync-conflict detection
     * when a local edit has not yet been pushed to the server.
     */
    public hasPendingParagraphUpdate(cell: vscode.NotebookCell): boolean
    {
        return this._mapUpdateParagraph.has(cell);
    }

    /**
     * Unregister a cell from paragraph update polling.
     * Acquires _updateMutex — do NOT call from within _updateMutex.runExclusive.
     * For internal use (already holding the mutex), call _unregisterParagraphUpdateDirect.
     */
    public async unregisterParagraphUpdate(cell: vscode.NotebookCell)
    {
        logger.debug("unregisterParagraphUpdate", cell);
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
        logger.debug("_unregisterParagraphUpdateDirect", cell);
        return this._mapUpdateParagraph.delete(cell);
    }

    public async updatePollingParagraphsDirect() {
        logger.debug("updatePollingParagraphsDirect", this._mapUpdateParagraph);
        // let notebookCells = Array.from(this._mapUpdateParagraph.keys());
        return this._updateMutex.runExclusive(async () => {
            // Promise.all(notebookCells.map(this.updateParagraph.bind(this)))
            for (let cell of this._mapUpdateParagraph.keys())
            {
                await this._updateParagraph(cell);
            }
            logger.debug("updatePollingParagraphsDirect ends");
        });
    }

    public async editWithoutParagraphUpdate(func: () => Promise<void>)
    {
        return this._editMutex.runExclusive(async () =>
        {
            this._editWithoutParagraphUpdateDepth++;
            try
            {
                return await func();
            }
            finally
            {
                this._editWithoutParagraphUpdateDepth--;
            }
        });
    }

    private async _doUpdatePollingParagraphs()
    {
        let config = vscode.workspace.getConfiguration('zeppelin');
        let throttleTime: number = config.get('autosave.throttleTime', 3);

        logger.debug("_doUpdatePollingParagraphs", this._mapUpdateParagraph);
        for (let [cell, entry] of this._mapUpdateParagraph)
        {
            if (cell.metadata.resolvingDiff || cell.metadata.syncConflict !== undefined)
            {
                logger.warn("_doUpdatePollingParagraphs: cell has conflict or resolving diff, skipped", cell);
                continue;
            }
            let requestTime = entry.requestTime;
            if (!this.isNoteSyncing(cell.notebook)   // disregard syncing cells
                && throttleTime * 1000 < Date.now() - requestTime) {
                if (cell.index < 0)
                {
                    logger.debug("_doUpdatePollingParagraphs: deleted cell", cell);
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

    public async updateCellMetadata(
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

    public async removeCellMetadata(
        cell: vscode.NotebookCell,
        keys: string[]
    ) {
        const editor = new vscode.WorkspaceEdit();
        let meta = {...cell.metadata};
        for (let k of keys)
        {
            delete meta[k]; 
        }
        let edit = vscode.NotebookEdit.updateCellMetadata(
            cell.index,
            // update based on revised metadata
            meta
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
        // serverCellData: vscode.NotebookCellData
    ): boolean
    {
        let localText = cell.document.getText();
        let serverText = serverParagraph.text ?? '';
        if (localText !== serverText) { return true; }

        // For now, disregard differences except for text itself.
        // if (cell.kind !== serverCellData.kind) { return true; }

        // if (cell.document.languageId !== serverCellData.languageId) { return true; }

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
     * Sync local notebook with the server using non-destructive in-place
     * metadata updates — existing cells are never replaced or reordered.
     *
     * For each local cell whose id matches a server paragraph:
     *  - Flags `metadata.syncConflict` when content differs.
     *  - Clears stale conflict markers when content matches.
     *  - Updates cell metadata (status, results, dates) from the server.
     *  - Resumes execution status for running/pending paragraphs.
     *
     * Server-only paragraphs (not present locally) are inserted at the
     *  correct position relative to matched cells.
     * Local-only cells (no id or id not on server) are left untouched.
     */
    public async syncNote(note: vscode.NotebookDocument) {
        if (!!!note.metadata || !!!note.metadata.id)
        {
            vscode.window.showWarningMessage("Unable to sync note as note id is not found");
            return;
        }

        return await this._updateMutex.runExclusive(async () => {

        this._registerSyncNote(note);
        logger.info("syncNote start");

        let serverNote = await this.getNoteInfo(note);
        if (serverNote === undefined)
        {
            logger.warn("syncNote failed");
            this._unregisterSyncNote(note);
            return;
        }

        let serverParagraphs = serverNote.paragraphs ?? [];

        // Build lookup: server paragraph id → ParagraphData
        let serverParagraphMap = new Map<string, ParagraphData>();
        for (let p of serverParagraphs)
        {
            serverParagraphMap.set(p.id, p);
        }

        // Build lookup: local cell id → NotebookCell
        let localCellMap = new Map<string, vscode.NotebookCell>();
        for (let cell of note.getCells())
        {
            if (cell.metadata.id !== undefined)
            {
                localCellMap.set(cell.metadata.id, cell);
            }
        }

        await this.editWithoutParagraphUpdate(async () =>
        {
            // Unregister pending updates for all current cells
            // Note: already inside _updateMutex, use direct version
            for (let cell of note.getCells())
            {
                this._unregisterParagraphUpdateDirect(cell);
            }

            // --- Phase 1: In-place updates for matched cells ---
            for (let cell of note.getCells())
            {
                let serverParagraph = serverParagraphMap.get(cell.metadata.id);
                if (serverParagraph === undefined) { continue; }

                let serverCellData = parseParagraphToCellData(serverParagraph);

                if (cell.metadata.resolvingDiff)
                {
                    // Cell is in diff-resolution mode — leave conflict
                    // and resolvingDiff flags untouched so the user can
                    // finish resolving without the markers vanishing.
                }
                else if (this._hasSyncConflict(
                    cell,
                    serverParagraph,
                    // serverCellData
                ))
                {
                    await this.updateCellMetadata(cell, {
                        syncConflict: serverParagraph
                    });
                }
                else
                {
                    // No conflict — clear any stale conflict markers
                    if (cell.metadata.syncConflict !== undefined
                        || cell.metadata.resolvingDiff)
                    {
                        await this.removeCellMetadata(
                            cell, ["syncConflict", "resolvingDiff"]
                        );
                    }
                    // Update cell metadata from server (status, results, dates, etc.)
                    await this.updateCellMetadata(cell, serverParagraph);
                }

                // Resume execution status for this cell
                this._executionManager?.resumeExecutionStatus(cell, serverCellData);
            }

            // --- Phase 2: Insert server-only paragraphs ---
            // Walk server paragraphs in order, tracking the last matched
            // local cell index so we know where to insert server-only ones.
            let pendingInsertions: {
                index: number,
                cellData: vscode.NotebookCellData
            }[] = [];
            let lastMatchedLocalIndex = -1;

            for (let serverParagraph of serverParagraphs)
            {
                let localCell = localCellMap.get(serverParagraph.id);
                if (localCell !== undefined)
                {
                    lastMatchedLocalIndex = localCell.index;
                }
                else
                {
                    // Server-only paragraph — schedule insertion after
                    // the last matched local cell.
                    let serverCellData = parseParagraphToCellData(serverParagraph);
                    pendingInsertions.push({
                        index: lastMatchedLocalIndex + 1,
                        cellData: serverCellData
                    });
                }
            }

            // Insert from bottom to top so earlier insertions don't
            // shift the indices of later ones.
            for (let i = pendingInsertions.length - 1; i >= 0; i--)
            {
                let { index, cellData } = pendingInsertions[i];
                await this.insertNoteCells(note, index, [cellData]);
            }

            // Resume execution status for newly inserted cells
            for (let ins of pendingInsertions)
            {
                // After all insertions, cell indices may have shifted.
                // Re-locate by paragraph id.
                let paragraphId = ins.cellData.metadata?.id;
                if (paragraphId === undefined) { continue; }
                for (let cell of note.getCells())
                {
                    if (cell.metadata.id === paragraphId)
                    {
                        this._executionManager?.resumeExecutionStatus(
                            cell, ins.cellData
                        );
                        break;
                    }
                }
            }

            // Update note-level metadata with server info
            await this.updateNoteMetadata(note, serverNote);
        });

        this._unregisterSyncNote(note);
        logger.info("syncNote end");
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
        logger.info(`remote cell revision accepted`, cell);

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
        logger.info(`local cell revision accepted`, cell);

        // Clear conflict markers
        await this.editWithoutParagraphUpdate(async () =>
        {
            // let meta = {...cell.metadata}
            // delete meta.syncConflict;
            // delete meta.resolvingDiff;
            await this.removeCellMetadata(cell, ["syncConflict", "resolvingDiff"]);
        });

        // Push local text to server
        try
        {
            await this.updateParagraphText(cell);
        }
        catch (err)
        {
            logger.error("acceptLocalCell: error pushing local text to server", err);
            vscode.window.showErrorMessage(
                `Failed to push local changes to server: ${err instanceof Error ? err.message : err}`
            );
        }
    }

    public async applyPolledNotebookEdits() {
        return this.editWithoutParagraphUpdate(async () => {
            for (let [cell, edits] of this._mapNotebookEdits)
            {
                if (cell.metadata.resolvingDiff
                    || cell.metadata.syncConflict !== undefined)
                {
                    continue
                }

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
                "completionSupport": cell.kind !== vscode.NotebookCellKind.Markup
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
        return <ParagraphData>{...cell.metadata};
    }

    public async updateParagraphText(cell: vscode.NotebookCell) {
        let text = cell.document.getText();
        let res = await this._service?.updateParagraphText(
            cell.notebook.metadata.id, cell.metadata.id, text
        );
        if (res instanceof AxiosError)
        {
            logger.error("error in updateParagraphText", res);
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
                "completionSupport": cell.kind !== vscode.NotebookCellKind.Markup
            } };
    
        let res = await this._service?.updateParagraphConfig(
            cell.notebook.metadata.id, cell.metadata.id, config
        );
        if (res instanceof AxiosError)
        {
            logger.error("error in updateParagraphConfig", res);
            await this.editWithoutParagraphUpdate(async () => {
                await this.updateCellMetadata(cell, {"status": res.response?.status});
            });
            throw res;
        }

        logger.debug(`UpdateParagraphConfig: pollUpdateCellMetadata`);
        await this.pollUpdateCellMetadata(cell, res?.data.body);
    }

    private async _updateParagraph(cell: vscode.NotebookCell) {
        try {
            // Skip cells with an unresolved sync conflict — don't push
            // local changes until the user resolves the conflict.
            if (cell.metadata.syncConflict !== undefined)
            {
                logger.warn("updateParagraph: cell has sync conflict, skipped", cell);
                this._unregisterParagraphUpdateDirect(cell);
                return;
            }

            // index = -1: cell has been deleted from notebook
            if (cell.index === -1)
            {
                logger.debug(`updateParagraph: cell to be deleted`, cell);
                this.cellStatusBar?.untrackCell(cell);
                this._service?.deleteParagraph(
                    cell.notebook.metadata.id, cell.metadata.id
                );

                this._mapUpdateParagraph.delete(cell);

                logger.debug(`updateParagraph: sync cell metadata`, cell);
                await this.updateNoteMetadata(
                    cell.notebook,
                    await this.getNoteInfo(cell.notebook) ?? {}
                );
                return;
            }

            // create corresponding paragraph when a cell is newly created
            if (cell.metadata.id === undefined)
            {
                logger.debug(`updateParagraph: cell to be created`, cell);
                await this.createParagraph(cell);
                logger.debug(`updateParagraph: sync cell metadata`, cell);
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
                logger.debug(`updateParagraph: cell position to be changed`, cell);
                // cell index has changed, update to server
                await this.getService()?.moveParagraphToIndex(
                    cell.notebook.metadata.id, cell.metadata.id, cell.index
                );
                logger.debug(`updateParagraph: sync cell metadata`, cell);
                await this.updateNoteMetadata(
                    cell.notebook,
                    await this.getNoteInfo(cell.notebook) ?? {}
                );
            }
            else
            {
                // Before pushing local changes, check whether the server
                // paragraph has changed independently since the edit was
                // registered.  If so, flag a sync conflict instead of
                // blindly overwriting the server version.
                //
                // NOTE (TOCTOU): There is an inherent time-of-check to
                // time-of-use gap between this fetch and the subsequent
                // updateParagraphConfig/updateParagraphText calls.  The
                // server paragraph could change again in that window.
                // True atomic conflict resolution would require server-
                // side locking or optimistic concurrency (e.g. ETags),
                // which the Zeppelin REST API does not currently support.
                let mapEntry = this._mapUpdateParagraph.get(cell);
                let baseText = mapEntry?.baseText ?? '';

                let freshRes = await this.getService()?.getParagraphInfo(
                    cell.notebook.metadata.id, cell.metadata.id
                );
                if (freshRes !== undefined && !(freshRes instanceof AxiosError))
                {
                    let serverParagraph: ParagraphData = freshRes.data.body ?? freshRes.data;
                    let serverText = serverParagraph.text ?? '';
                    let localText = cell.document.getText();

                    if (serverText !== baseText && localText !== serverText)
                    {
                        // Server changed independently — flag conflict
                        // instead of pushing.
                        logger.warn("updateParagraph: server changed independently, flagging sync conflict");
                        await this.editWithoutParagraphUpdate(async () => {
                            await this.updateCellMetadata(cell, {
                                syncConflict: serverParagraph
                            });
                        });
                        // Unregister without pushing
                        this._unregisterParagraphUpdateDirect(cell);
                        return;
                    }
                }

                logger.debug("updateParagraph: updateParagraphConfig");
                let res = await this.updateParagraphConfig(cell);
                logger.debug("updateParagraph: updateParagraphText");
                res = await this.updateParagraphText(cell);
            }

            if (cell.kind <= vscode.NotebookCellKind.Markup)
            {
                // need to call remote execution for markup paragraph languages
                // so remote notebook paragraph result could be generated
                // as markup languages are rendered locally
                await this.runParagraph(cell, false);
            }
        } catch (err)
        {
            logger.error("error in _updateParagraph", err);
            if (cell.metadata.id === undefined)
            {
                // retry creating cell
                return;
            }
            // Notify the user about the failed update so errors
            // are not silently swallowed for existing paragraphs.
            vscode.window.showWarningMessage(
                `Failed to update paragraph ${cell.metadata.id}: `
                + `${err instanceof Error ? err.message : err}`
            );
        }

        // unregister cell from poll, as the update is either finished or failed now
        // Note: _updateParagraph is always called from within _updateMutex, use direct version
        this._unregisterParagraphUpdateDirect(cell);

        // Flush deferred metadata updates (queued by pollUpdateCellMetadata)
        // while still holding updateMutex. This ensures cell.metadata.text is
        // current before the next registerParagraphUpdate can snapshot baseText,
        // preventing false sync-conflict detection on rapid edit-execute cycles.
        await this.applyPolledNotebookEdits();
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

    /**
     * Auto-detect the cell language from the Magic command (e.g. `%python`, `%spark.sql`)
     * in the cell text. Uses the cached interpreter map to resolve the interpreter ID
     * to a VS Code language ID, then applies it via `vscode.languages.setTextDocumentLanguage`.
     */
    public async autoDetectCellLanguage(cell: vscode.NotebookCell)
    {
        // Extract the full interpreter ID from the Magic command
        let fullInterpreterId = parseCellInterpreter(cell, false);
        if (fullInterpreterId === undefined)
        {
            return;
        }

        // Use cached interpreter map; if not available, skip silently
        let interpreterMap = this._mapInterpreterCache;
        if (interpreterMap === undefined)
        {
            logger.warn("autoDetectCellLanguage: interpreter cache not available, skipping");
            return;
        }

        // Look up by full ID first (e.g. spark.sql), then by root ID (e.g. spark)
        let vscLang = interpreterMap.get(fullInterpreterId);
        if (vscLang === undefined)
        {
            let rootInterpreterId = parseCellInterpreter(cell, true);
            if (rootInterpreterId !== undefined)
            {
                vscLang = interpreterMap.get(rootInterpreterId);
            }
        }

        if (vscLang === undefined)
        {
            logger.warn(`autoDetectCellLanguage: unknown interpreter '${fullInterpreterId}'`);
            return;
        }

        // Skip if language already matches
        if (cell.document.languageId === vscLang)
        {
            return;
        }

        await this._applyCellLanguage(cell, vscLang);
    }

    /**
     * Apply a VS Code language ID to a notebook cell using
     * `vscode.languages.setTextDocumentLanguage`, then sync the metadata
     * config to match.
     */
    private async _applyCellLanguage(cell: vscode.NotebookCell, vscLang: string)
    {
        try
        {
            await this.editWithoutParagraphUpdate(async () =>
            {
                await vscode.languages.setTextDocumentLanguage(cell.document, vscLang);

                // Sync metadata config to match the new language
                let zepLang = mapZeppelinLanguage.get(vscLang) ?? 'plain_text';

                await this.updateCellMetadata(cell, {
                    config: {
                        ...cell.metadata.config,
                        editorMode: `ace/mode/${zepLang}`,
                        editorSetting: {
                            ...cell.metadata.config?.editorSetting,
                            language: zepLang
                        }
                    }
                });
            });

            logger.debug(`autoDetectCellLanguage: set language to '${vscLang}'`);
        }
        catch (err)
        {
            logger.error('_applyCellLanguage error', err);
            vscode.window.showWarningMessage(
                `Unable to auto-detect cell language '${vscLang}'. `
                + `Please select it manually.`
            );
        }
    }
}
