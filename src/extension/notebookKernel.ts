// import { DEBUG_MODE, NAME, MIME_TYPE } from '../common/common';
import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { NotebookService } from '../common/api';
import { EXTENSION_NAME,
    SUPPORTEDLANGUAGE,
    mapZeppelinLanguage,
    logDebug,
    getProxy,
    getVersion } from '../common/common';
import { CellStatusProvider } from '../component/cellStatusBar';
import { NoteData,
    ParagraphData, ParagraphResult } from '../common/types';
import { showQuickPickURL,
    doLogin } from '../common/interaction';
import { parseParagraphToCellData,
    parseParagraphResultToCellOutput } from '../common/parser';
import { Mutex } from '../component/mutex';
import { ExecutionManager } from '../component/execution';
import {
    initWsIntegration,
    disposeWsIntegration,
    isWsEnabled,
    isNotebookWsActive,
    activateNotebookWs,
    deactivateNotebookWs,
    getNotebookWsClient,
    touchNotebook,
    getWsConfigFromSettings,
    getWsManager,
    syncNoteViaWs,
    commitParagraphViaWs,
    // NOTE: One-time operations (run, cancel, delete) use REST API for reliability
    // WebSocket is only for continuous background sync
} from '../component/wsIntegration';
import { ZeppelinWsClient } from '../common/wsClient';
// import ForProgress from '../component/ForProgress/ForProgress';
import _ = require('lodash');


export class ZeppelinKernel
{
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

    // REMOVED: _timerUpdateCell - no more REST polling, using WebSocket instead
    private _timerHealthCheck?: NodeJS.Timer;
    private _executionManager?: ExecutionManager;
    private _mapSyncNote = new Map<
        vscode.NotebookDocument, number
    >();
    /** Note IDs for which we initiated a WebSocket refresh; cleared when the note event is applied. */
    private _pendingWsSyncNoteIds = new Set<string>();
    /** Global refresh rate limit: max 5 syncs per 30 min across all notebooks and all triggers. */
    private static readonly _REFRESH_GLOBAL_WINDOW_MS = 30 * 1000;
    private static readonly _REFRESH_GLOBAL_MAX = 5;
    private _refreshGlobalTimestamps: number[] = [];
    private _mapNotebookEdits = new Map<vscode.NotebookCell, vscode.NotebookEdit[]>();
    // REMOVED: _mapUpdateParagraph - no longer using REST polling for paragraph updates
    private _flagRegisterParagraphUpdate = true;
    private _isConnectionHealthy = true;
    private _lastConnectionCheck = 0;

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

            // Polling for running cells only (5 second interval)
            // WebSocket for background notebook sync
            
            // Start health check timer (lightweight - every 60s)
            if (this._timerHealthCheck === undefined)
            {
                this._timerHealthCheck = setInterval(async () =>
                {
                    await this._checkConnectionHealth.bind(this)();
                },
                60 * 1000);
            }

            // Schedule polling for running cells (only polls when cells are running)
            this._executionManager?.scheduleTracking();

            this._isConnectionHealthy = true;

            // Initialize WebSocket integration for background sync only
            this._initWebSocket();
        }
        logDebug("activate", this.isActive());
        return this.isActive();
    }

    /**
     * Initialize WebSocket integration for real-time sync
     */
    private async _initWebSocket(): Promise<void> {
        try {
            const baseUrl = this._service?.baseURL;
            if (!baseUrl) {
                return;
            }

            // Get auth info for WebSocket
            const principal = await this._context.secrets.get('zeppelinUsername') || 'anonymous';
            // Note: Zeppelin uses ticket from session, we'll use a placeholder
            // The actual auth is handled via cookies in the WebSocket connection
            const ticket = 'anonymous';

            const wsConfig = getWsConfigFromSettings(baseUrl, principal, ticket);
            
            if (wsConfig.enabled) {
                initWsIntegration(this, wsConfig);
                logDebug('WebSocket integration initialized');
            }
        } catch (error) {
            logDebug('Failed to initialize WebSocket integration', error);
        }
    }

    /**
     * Check if a notebook should use WebSocket (is in active set)
     */
    public isNotebookUsingWebSocket(noteId: string): boolean {
        return isWsEnabled() && isNotebookWsActive(noteId);
    }

    /**
     * Activate WebSocket for a notebook
     */
    public async activateNotebookWebSocket(noteId: string): Promise<ZeppelinWsClient | undefined> {
        if (!isWsEnabled()) {
            return undefined;
        }
        return activateNotebookWs(noteId);
    }

    /**
     * Deactivate WebSocket for a notebook
     */
    public async deactivateNotebookWebSocket(noteId: string): Promise<void> {
        await deactivateNotebookWs(noteId);
    }

    /**
     * Get the WebSocket client for a notebook
     */
    public getNotebookWsClient(noteId: string): ZeppelinWsClient | undefined {
        return getNotebookWsClient(noteId);
    }

    /**
     * Touch a notebook to update its LRU activity time
     */
    public touchNotebook(noteId: string): void {
        touchNotebook(noteId);
    }

    /**
     * Check connection health and trigger resync if connection was lost and is now restored
     */
    private async _checkConnectionHealth()
    {
        if (!this._service || !this.isActive())
        {
            return;
        }

        try {
            // Quick health check - list notes with short timeout
            const result = await this._service.listNotes();
            
            if (result instanceof AxiosError) {
                // Connection failed
                if (this._isConnectionHealthy) {
                    logDebug("Connection health check failed, marking as unhealthy");
                    this._isConnectionHealthy = false;
                    this.setDisplay(
                        this._context.workspaceState.get('currentZeppelinServerName', this.label),
                        EXTENSION_NAME + ' (Disconnected)',
                        this._context.workspaceState.get('currentZeppelinServerURL', undefined)
                    );
                }
            } else {
                // Connection succeeded
                if (!this._isConnectionHealthy) {
                    logDebug("Connection restored");
                    this._isConnectionHealthy = true;
                    this.setDisplay(
                        this._context.workspaceState.get('currentZeppelinServerName', this.label),
                        EXTENSION_NAME,
                        this._context.workspaceState.get('currentZeppelinServerURL', undefined)
                    );
                }
            }
            
            this._lastConnectionCheck = Date.now();
        } catch (err) {
            logDebug("Connection health check error", err);
            if (this._isConnectionHealthy) {
                this._isConnectionHealthy = false;
            }
        }
    }

    /**
     * Check if connection is currently healthy
     */
    public isConnectionHealthy(): boolean
    {
        return this._isConnectionHealthy;
    }

    /**
     * Force a connection health check and resync if needed
     */
    public async forceConnectionCheck(): Promise<boolean>
    {
        await this._checkConnectionHealth();
        return this._isConnectionHealthy;
    }

    deactivate()
    {
        if (!this.isActive())
        {
            return false;
        }

        this.setDisplay(this.label, EXTENSION_NAME);

        // Clear health check timer
        if (this._timerHealthCheck !== undefined)
        {
            clearInterval(this._timerHealthCheck);
            this._timerHealthCheck = undefined;
        }

        this._executionManager?.dispose();

        // Dispose WebSocket integration
        disposeWsIntegration();

        this._isActive = false;
        this._isConnectionHealthy = true;
        logDebug("deactivate", this.isActive());
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

        this._service = service;
        return service;
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
        baseURL: string | undefined,
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

    /**
     * Find a notebook on the server by its path/name.
     * Accepts workspace-relative path or full server path; internally uses base {user_email}/ for lookup.
     * Returns the note info if found, undefined otherwise.
     */
    public async findNoteByPath(notePath: string): Promise<{id: string, path: string, name: string} | undefined>
    {
        if (!notePath)
        {
            return undefined;
        }

        // Normalize to server path: ensure base {user_email}/ prefix for lookup
        const serverPath = await this.getServerNotePathFromRelativePath(notePath);
        const normalizedPath = serverPath.startsWith('/') ? serverPath : '/' + serverPath;
        
        for (let note of await this.listNotes())
        {
            // before Zeppelin 10.0, path of note
            // is stored in 'name' key instead of 'path'
            let path = note.path ?? note.name;
            
            // Skip trashed notes
            if (path.startsWith('/~Trash'))
            {
                continue;
            }

            // Compare paths (case-sensitive, exact match)
            if (path === normalizedPath)
            {
                return {
                    id: note.id,
                    path: path,
                    name: note.name ?? path
                };
            }
        }
        return undefined;
    }

    /**
     * Get user email from secrets (same source as login).
     * Used to prefix notebook paths for create/fetch/sync so notes are under user base path.
     */
    public async getUserEmail(): Promise<string | undefined> {
        return this._context.secrets.get('email');
    }

    /**
     * Get server note path: base {user_email}/ + workspace-relative path.
     * Use this for create, find, and any server path operations.
     */
    public async getServerNotePath(noteUri: vscode.Uri): Promise<string> {
        const email = await this.getUserEmail();
        const rel = this.getWorkspaceRelativePath(noteUri);
        const relTrim = rel.replace(/^\//, '');
        if (email && relTrim) {
            return `/${email}/${relTrim}`;
        }
        if (email && !relTrim) {
            return `/${email}`;
        }
        return rel;
    }

    /**
     * Prefix a relative or local path with {user_email}/ for server operations.
     * Use when you have a path string (e.g. from user input) and need the server path.
     * Idempotent: if path already starts with {email}/, returns as-is (normalized).
     */
    public async getServerNotePathFromRelativePath(relativePath: string): Promise<string> {
        if (!relativePath || !relativePath.trim()) {
            return relativePath;
        }
        const email = await this.getUserEmail();
        const trim = relativePath.trim().replace(/^\//, '');
        const withLeadingSlash = relativePath.trim().startsWith('/') ? relativePath.trim() : '/' + relativePath.trim();
        if (!email) {
            return withLeadingSlash;
        }
        // Already prefixed with this user's email
        if (trim.startsWith(email + '/') || trim === email) {
            return withLeadingSlash;
        }
        return `/${email}/${trim}`;
    }

    /**
     * Get workspace-relative path for a notebook.
     * This matches Zeppelin web UI behavior where paths are relative to the workspace.
     */
    public getWorkspaceRelativePath(noteUri: vscode.Uri): string
    {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0)
        {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const notePath = noteUri.fsPath;
            
            // If notebook is inside workspace, get relative path
            if (notePath.startsWith(workspaceRoot))
            {
                let relativePath = notePath.substring(workspaceRoot.length);
                // Remove leading slash if present
                if (relativePath.startsWith('/') || relativePath.startsWith('\\'))
                {
                    relativePath = relativePath.substring(1);
                }
                // Remove file extension
                relativePath = relativePath.replace(/\.[^.]+$/, '');
                return '/' + relativePath;
            }
        }
        
        // Fallback: just use the filename without extension
        const fileName = noteUri.path.split('/').pop() || '';
        return '/' + fileName.replace(/\.[^.]+$/, '');
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

    /** Delete a note on the server by id. Returns true on success. */
    public async deleteNote(noteId: string): Promise<boolean> {
        const res = await this._service?.deleteNote(noteId);
        if (res instanceof AxiosError) {
            logDebug("error in deleteNote", res);
            if (res.response?.data) {
                vscode.window.showErrorMessage(`Failed to delete note: ${res.response.data}`);
            } else {
                vscode.window.showErrorMessage(`Failed to delete note: ${res.code ?? res.message}`);
            }
            return false;
        }
        return res?.status === 200;
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
        let res = await this.getService()?.getParagraphInfo(
            cell.notebook.metadata.id, cell.metadata.id);
        let paragraph: ParagraphData;

        if (res instanceof AxiosError)
        {
            // if (res.response?.status === 404)
            // {
            //     await promptCreateParagraph(this, cell);
            //     paragraph = res.data.body ?? cell.metadata;
            //     return paragraph;
            // }
            // else
            // {
                logDebug(
                    `Unable to get paragraph info ${cell.metadata.id} 
                    in note '${cell.notebook.metadata.name}'`
                );
                throw res;
            // }
        }
        else
        {
            paragraph = res?.data.body ?? res?.data;
        }

        this.pollUpdateCellMetadata(cell, paragraph);
        return paragraph;
    }

    /**
     * Run a paragraph - waits for results synchronously
     */
    public async runParagraph(cell: vscode.NotebookCell, sync: boolean)
    {
        const noteId = cell.notebook.metadata.id;
        const paragraphId = cell.metadata.id;

        vscode.window.setStatusBarMessage(`$(sync~spin) Running...`, 3000);

        // Wait for results synchronously
        let res = await this.getService()?.runParagraph(noteId, paragraphId, sync);
        
        if (!sync) {
            return res?.data ?? [];
        }

        if (!res?.data.body) {
            return [];
        }

        let paragraphResult = <ParagraphResult> res?.data.body;
        let cellOutput = parseParagraphResultToCellOutput(paragraphResult);
        
        await this.pollUpdateCellMetadata(cell, {results: paragraphResult});
        
        vscode.window.setStatusBarMessage(`$(check) Done`, 2000);
        return cellOutput;
    }

    public async stopParagraph(cell: vscode.NotebookCell)
    {
        const noteId = cell.notebook.metadata.id;
        const paragraphId = cell.metadata.id;

        vscode.window.setStatusBarMessage(`$(sync~spin) Cancelling paragraph...`, 3000);

        // ALWAYS USE REST API for stop - more reliable than WebSocket
        // WebSocket cancel doesn't always get proper confirmation
        let res = await this.getService()?.stopParagraph(noteId, paragraphId);
        
        if (res?.status === 200) {
            vscode.window.setStatusBarMessage(`$(check) Paragraph cancelled`, 2000);
            
            // Force end the execution if it's still running
            const execution = this._executionManager?.getExecutionByParagraphId(paragraphId);
            if (execution) {
                execution.end(false, Date.now());
            }
            return true;
        }
        
        vscode.window.setStatusBarMessage(`$(warning) Failed to cancel paragraph`, 3000);
        return false;
    }

    /**
     * Stop all running paragraphs in a notebook
     */
    public async stopAllParagraphs(note: vscode.NotebookDocument)
    {
        const noteId = note.metadata?.id;
        if (!noteId) {
            return false;
        }

        vscode.window.setStatusBarMessage(`$(sync~spin) Stopping all paragraphs...`, 3000);

        // ALWAYS USE REST API for stop all - more reliable
        let res = await this.getService()?.stopAll(noteId);
        
        if (res?.status === 200) {
            vscode.window.setStatusBarMessage(`$(check) All paragraphs stopped`, 2000);
            
            // Force end all running executions
            for (const cell of note.getCells()) {
                if (cell.metadata?.status === 'RUNNING' || cell.metadata?.status === 'PENDING') {
                    const execution = this._executionManager?.getExecutionByParagraphId(cell.metadata?.id);
                    if (execution) {
                        execution.end(false, Date.now());
                    }
                }
            }
            return true;
        }
        
        vscode.window.setStatusBarMessage(`$(warning) Failed to stop paragraphs`, 3000);
        return false;
    }

    public getExecutionByParagraphId(paragraphId: string)
    {
        return this._executionManager?.getExecutionByParagraphId(paragraphId);
    }

    /**
     * Register a cell for update - immediately sends via WebSocket if connected
     * For non-WebSocket notebooks, no automatic sync (user can manually refresh)
     */
    public registerParagraphUpdate(cell: vscode.NotebookCell)
    {
        if (!this._flagRegisterParagraphUpdate)
        {
            logDebug("registerParagraphUpdate: cell not to be updated", cell);
            return;
        }

        const noteId = cell.notebook?.metadata?.id;
        logDebug("registerParagraphUpdate", cell);

        // ONLY sync via WebSocket - no REST polling
        if (noteId && this.isNotebookUsingWebSocket(noteId)) {
            // Immediately send via WebSocket
            this._updateParagraphViaWebSocket(cell);
        }
        // For non-WebSocket notebooks, no automatic sync
        // User can manually refresh when needed
    }

    public unregisterParagraphUpdate(cell: vscode.NotebookCell)
    {
        logDebug("unregisterParagraphUpdate", cell);
        // No-op since we're not using polling anymore
    }

    /**
     * DEPRECATED: No longer using polling - kept for backward compatibility
     * All sync now happens via WebSocket events
     */
    public async instantUpdatePollingParagraphs() {
        logDebug("instantUpdatePollingParagraphs: no-op (using WebSocket)");
        // No-op - polling removed, using WebSocket for sync
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

    /**
     * Update paragraph via WebSocket instead of REST
     */
    /**
     * Update paragraph via WebSocket instead of REST
     * Used for real-time sync of cell changes
     */
    private async _updateParagraphViaWebSocket(cell: vscode.NotebookCell): Promise<void>
    {
        const noteId = cell.notebook?.metadata?.id;
        const paragraphId = cell.metadata?.id;

        // If no paragraph ID, this is a new cell - needs REST to create
        if (!noteId || !paragraphId) {
            this.updateParagraph(cell);
            return;
        }

        const text = cell.document.getText();
        const title = cell.metadata?.title;
        const config = cell.metadata?.config || {};

        // Try WebSocket first
        const sent = commitParagraphViaWs(noteId, paragraphId, text, title, config);
        if (sent) {
            logDebug(`_updateParagraphViaWebSocket: sent commit for ${paragraphId}`);
            return;
        }

        // Fallback to REST if WebSocket not available
        logDebug('_updateParagraphViaWebSocket: WS not available, falling back to REST');
        this.updateParagraph(cell);
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
            this._flagRegisterParagraphUpdate = false;
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

    /** Called when a sync started (e.g. via WebSocket) has finished applying note content. */
    public unregisterSyncNote(note: vscode.NotebookDocument | undefined) {
        if (note !== undefined) {
            this._unregisterSyncNote(note);
        }
    }

    /**
     * Build merged cell list for sync: one cell per paragraph id (dedupe server and local).
     * For each server id, use local content/outputs when present; else use server cell.
     * Then append local-only cells (ids not on server) at most once per id.
     */
    private _buildMergedCellsForSync(
        note: vscode.NotebookDocument,
        serverCells: vscode.NotebookCellData[]
    ): vscode.NotebookCellData[] {
        const localById = new Map<string, vscode.NotebookCell>();
        for (const cell of note.getCells()) {
            const id = cell.metadata?.id as string | undefined;
            if (id) localById.set(id, cell);
        }

        const merged: vscode.NotebookCellData[] = [];
        const addedIds = new Set<string>();

        for (const serverCell of serverCells) {
            const id = (serverCell.metadata as ParagraphData)?.id as string | undefined;
            if (id && addedIds.has(id)) continue;
            const localCell = id ? localById.get(id) : undefined;
            if (localCell) {
                merged.push(this._cellToCellDataWithServerMetadata(localCell, serverCell));
                if (id) addedIds.add(id);
            } else {
                merged.push(serverCell);
                if (id) addedIds.add(id);
            }
        }
        for (const cell of note.getCells()) {
            const id = cell.metadata?.id as string | undefined;
            if (id && !addedIds.has(id)) {
                merged.push(this._cellToCellData(cell));
                addedIds.add(id);
            }
        }
        return merged;
    }

    /** Like _cellToCellData but with metadata from server cell so paragraph id/config stay in sync. */
    private _cellToCellDataWithServerMetadata(
        cell: vscode.NotebookCell,
        serverCell: vscode.NotebookCellData
    ): vscode.NotebookCellData {
        const data = new vscode.NotebookCellData(
            cell.kind,
            cell.document.getText(),
            cell.document.languageId
        );
        data.metadata = { ...(serverCell.metadata as object) };
        data.outputs = cell.outputs.map(o => new vscode.NotebookCellOutput(o.items.slice(), o.metadata));
        return data;
    }

    /** Convert a live notebook cell to NotebookCellData (for local-only cells in merge sync). */
    private _cellToCellData(cell: vscode.NotebookCell): vscode.NotebookCellData {
        const data = new vscode.NotebookCellData(
            cell.kind,
            cell.document.getText(),
            cell.document.languageId
        );
        data.metadata = { ...cell.metadata };
        data.outputs = cell.outputs.map(o => new vscode.NotebookCellOutput(o.items.slice(), o.metadata));
        return data;
    }

    public isNoteSyncing(note: vscode.NotebookDocument | undefined) {
        if (note === undefined)
        {
            return false;
        }
        return this._mapSyncNote.has(note);
    }

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

        // Global rate limit: max 5 refreshes per 30 min across all notebooks (tab change, button, startup, etc.)
        const now = Date.now();
        const windowStart = now - ZeppelinKernel._REFRESH_GLOBAL_WINDOW_MS;
        while (this._refreshGlobalTimestamps.length && this._refreshGlobalTimestamps[0] < windowStart) {
            this._refreshGlobalTimestamps.shift();
        }
        if (this._refreshGlobalTimestamps.length >= ZeppelinKernel._REFRESH_GLOBAL_MAX) {
            logDebug("syncNote: global refresh limit reached (5 per 30 min), skipping");
            vscode.window.showWarningMessage(
                "Refresh limit reached (max 5 per 30 min). Please wait before refreshing again."
            );
            return;
        }
        this._refreshGlobalTimestamps.push(now);

        // SAFETY CHECK: Don't sync if connection is unhealthy
        if (!this._isConnectionHealthy)
        {
            logDebug("syncNote: skipping - connection unhealthy");
            this._refreshGlobalTimestamps.pop(); // don't count failed attempt
            vscode.window.showWarningMessage(
                "Cannot sync: Connection to server is unhealthy. Try again when connection is restored."
            );
            return;
        }

        const noteId = note.metadata.id;

        this._registerSyncNote(note);

        // TRY WEBSOCKET FIRST: If notebook has active WebSocket, sync via WS
        if (this.isNotebookUsingWebSocket(noteId)) {
            logDebug("syncNote: using WebSocket for sync");
            const synced = await syncNoteViaWs(noteId);
            if (synced) {
                this._pendingWsSyncNoteIds.add(noteId);
                logDebug("syncNote: initiated via WebSocket, content will arrive via WS events");
                return; // WebSocket handler will apply and call unregisterSyncNote
            }
            // Fallback to REST if WS sync failed
            logDebug("syncNote: WebSocket sync failed, falling back to REST");
        }

        // FALLBACK TO REST API
        return await this._updateMutex.runExclusive(async () => {

        logDebug("syncNote start (REST)");
        const serverNote = await this.getNoteInfo(note);
        if (serverNote === undefined)
        {
            logDebug("syncNote failed");
            this._unregisterSyncNote(note);
            return;
        }

        const serverCells = serverNote.paragraphs
            ? serverNote.paragraphs.map(parseParagraphToCellData)
            : [];

        const localCellCount = note.cellCount;
        const serverCellCount = serverCells.length;
        const serverNoteName = serverNote.name;

        // Merge sync: server cells in order + local-only cells at end. No full replace, no pushing local over server.
        const mergedCells = this._buildMergedCellsForSync(note, serverCells);
        logDebug("syncNote: merge sync", {
            localCellCount,
            serverCellCount,
            mergedCount: mergedCells.length
        });

        await this.editWithoutParagraphUpdate(async () => {
            for (const cell of note.getCells()) {
                await this.unregisterParagraphUpdate(cell);
            }
            const replaceRange = new vscode.NotebookRange(0, note.cellCount);
            await this.replaceNoteCells(note, replaceRange, mergedCells);
            // Update notebook metadata from server
            if (serverNoteName !== undefined) {
                await this.updateNoteMetadata(note, { name: serverNoteName });
            }
        });

        // Resume execution status for cells that came from server (first serverCellCount cells in merged order)
        const cellsAfterEdit = note.getCells();
        for (let i = 0; i < serverCells.length && i < cellsAfterEdit.length; i++) {
            this._executionManager?.resumeExecutionStatus(cellsAfterEdit[i], serverCells[i]);
        }

        this._unregisterSyncNote(note);
        logDebug("syncNote end");
    });
    }

    // public async syncNote(note: vscode.NotebookDocument | undefined) {
    //     return this._updateMutex.runExclusive(async () => this._syncNote(note));
    // }

    /**
     * Merge-sync notebook with pre-fetched server cells (e.g. from WebSocket). Same behavior as refresh:
     * server cells in order + local-only cells at end; no full replace, no pushing local over server.
     */
    public async syncNoteWithServerCells(
        note: vscode.NotebookDocument,
        serverCells: vscode.NotebookCellData[],
        options?: { name?: string }
    ): Promise<void> {
        if (!note?.metadata?.id) return;
        await this._updateMutex.runExclusive(async () => {
            this._registerSyncNote(note);
            const mergedCells = this._buildMergedCellsForSync(note, serverCells);
            await this.editWithoutParagraphUpdate(async () => {
                for (const cell of note.getCells()) {
                    await this.unregisterParagraphUpdate(cell);
                }
                const replaceRange = new vscode.NotebookRange(0, note.cellCount);
                await this.replaceNoteCells(note, replaceRange, mergedCells);
                if (options?.name !== undefined) {
                    await this.updateNoteMetadata(note, { name: options.name });
                }
            });
            const cellsAfterEdit = note.getCells();
            for (let i = 0; i < serverCells.length && i < cellsAfterEdit.length; i++) {
                this._executionManager?.resumeExecutionStatus(cellsAfterEdit[i], serverCells[i]);
            }
            this._unregisterSyncNote(note);
        });
    }

    /**
     * Sync local cells to server - creates paragraphs on server for each local cell.
     * Exposed as public so WebSocket integration can reuse the same logic.
     */
    public async syncLocalToServer(note: vscode.NotebookDocument): Promise<boolean>
    {
        if (!note || !note.metadata?.id)
        {
            vscode.window.showWarningMessage("Cannot sync to server: notebook has no ID");
            return false;
        }

        const noteId = note.metadata.id;
        const cells = note.getCells();
        
        // SAFETY: Never push empty notebook to server
        if (cells.length === 0)
        {
            logDebug("_syncLocalToServer: BLOCKED - local notebook is empty");
            vscode.window.setStatusBarMessage(`$(warning) Cannot sync: notebook is empty.`, 4000);
            return false;
        }

        try {
            vscode.window.showInformationMessage(`Syncing ${cells.length} cells to server...`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (const cell of cells)
            {
                const text = cell.document.getText();
                const lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "sql";
                const lineNumbers = vscode.workspace.getConfiguration("editor")
                    .get("lineNumbers", vscode.TextEditorLineNumbersStyle.Off)
                    !== vscode.TextEditorLineNumbersStyle.Off;
                
                const config = {
                    "lineNumbers": lineNumbers,
                    "editorMode": `ace/mode/${lang}`,
                    "editorSetting": {
                        "language": lang,
                        "editOnDblClick": false,
                        "completionKey": "TAB",
                        "completionSupport": cell.kind !== 1
                    }
                };

                try {
                    // Create paragraph on server
                    const res = await this._service?.createParagraph(
                        noteId, text, cell.index, '', config
                    );
                    
                    if (res instanceof AxiosError)
                    {
                        logDebug(`Failed to create paragraph ${cell.index}:`, res);
                        failCount++;
                    }
                    else if (res?.data?.body)
                    {
                        // Update local cell with server paragraph ID
                        await this.updateCellMetadata(cell, {
                            id: res.data.body,
                            config
                        });
                        successCount++;
                    }
                }
                catch (err)
                {
                    logDebug(`Error creating paragraph ${cell.index}:`, err);
                    failCount++;
                }
            }

            // Update notebook metadata with latest from server
            const serverNote = await this.getNoteInfo(note);
            if (serverNote)
            {
                await this.updateNoteMetadata(note, serverNote);
            }

            if (failCount === 0)
            {
                vscode.window.showInformationMessage(
                    `Successfully synced ${successCount} cells to server`
                );
                return true;
            }
            else
            {
                vscode.window.showWarningMessage(
                    `Synced ${successCount} cells, failed ${failCount} cells`
                );
                return successCount > 0;
            }
        }
        catch (err)
        {
            logDebug("Error in _syncLocalToServer:", err);
            vscode.window.showErrorMessage(`Failed to sync to server: ${err}`);
            return false;
        }
    }

    public async applyPolledNotebookEdits() {
        for (let [cell, edits] of this._mapNotebookEdits)
        {
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

		let lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "sql";
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

        await this.updateCellMetadata(
            cell,
            {
                id: res?.data.body,
                config
            }
        );
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
            await this.updateCellMetadata(cell, {"status": res.response?.status});
            throw res;
        }

        await this.pollUpdateCellMetadata(cell, res?.data.body);
    }

    public async updateParagraphConfig(cell: vscode.NotebookCell) {
        var lineNumbers = vscode.workspace.getConfiguration("editor")
            .get("lineNumbers", vscode.TextEditorLineNumbersStyle.Off)
            !== vscode.TextEditorLineNumbersStyle.Off;

        let lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "sql";
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
        // SAFETY CHECK: Don't perform updates if connection is unhealthy
        if (!this._isConnectionHealthy)
        {
            logDebug(`updateParagraph: skipping - connection unhealthy`, cell);
            return;
        }

        try {
            // index = -1: cell has been deleted from notebook
            if (cell.index === -1)
            {
                logDebug(`updateParagraph: cell to be deleted`, cell);
                
                // SAFETY CHECK: Verify paragraph exists on server before deleting
                // This prevents accidental deletion when local state is corrupted
                if (!cell.metadata.id)
                {
                    logDebug(`updateParagraph: skip delete - no paragraph ID`, cell);
                    return;
                }

                // SAFETY CHECK: Don't delete if notebook appears empty locally
                // This could indicate a corrupted local state
                const localCellCount = cell.notebook.cellCount;
                if (localCellCount === 0)
                {
                    logDebug(`updateParagraph: BLOCKED delete - local notebook is empty, possible corruption`, cell);
                    vscode.window.setStatusBarMessage(
                        `$(warning) Blocked deletion: Local notebook empty. Use "Refresh Notebook".`,
                        5000
                    );
                    return;
                }

                const noteId = cell.notebook.metadata.id;
                const paragraphId = cell.metadata.id;

                // SAFETY: Verify server has cells before deleting
                // This prevents accidental deletion when server/local state mismatch
                try {
                    const serverNote = await this.getNoteInfo(cell.notebook);
                    const serverCellCount = serverNote?.paragraphs?.length ?? 0;
                    
                    if (serverCellCount === 0) {
                        logDebug(`updateParagraph: BLOCKED delete - server notebook is empty`, cell);
                        vscode.window.setStatusBarMessage(
                            `$(warning) Blocked deletion: Server notebook empty. Use "Refresh Notebook".`,
                            5000
                        );
                        return;
                    }
                    
                    // Check if paragraph exists on server
                    const paragraphExists = serverNote?.paragraphs?.some(
                        (p: any) => p.id === paragraphId
                    );
                    if (!paragraphExists) {
                        logDebug(`updateParagraph: paragraph ${paragraphId} not found on server, skipping delete`);
                        return;
                    }
                } catch (error) {
                    logDebug(`updateParagraph: failed to verify server state, blocking delete`, error);
                    vscode.window.setStatusBarMessage(
                        `$(warning) Blocked deletion: Cannot verify server state.`,
                        5000
                    );
                    return;
                }

                this.cellStatusBar?.untrackCell(cell);

                // ONLY USE REST API FOR DELETE - safer with proper verification
                logDebug(`updateParagraph: deleting paragraph ${paragraphId} via REST API`);
                await this._service?.deleteParagraph(noteId, paragraphId);

                logDebug(`updateParagraph: sync cell metadata after delete`);
                await this.updateNoteMetadata(
                    cell.notebook,
                    await this.getNoteInfo(cell.notebook) ?? {}
                );
                vscode.window.setStatusBarMessage(`$(check) Paragraph deleted`, 2000);
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
        await this.unregisterParagraphUpdate(cell);
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
     * Ensure the cell exists on the server and is synced before run.
     * If the cell has no paragraph id, create it; otherwise sync current content to server.
     * Returns true if ready to run, false if notebook not connected or operation failed.
     */
    public async ensureCellExistsAndSynced(cell: vscode.NotebookCell): Promise<boolean> {
        if (!cell?.notebook?.metadata?.id || !this._isConnectionHealthy) {
            return false;
        }
        try {
            if (!cell.metadata?.id) {
                await this.createParagraph(cell);
                logDebug("ensureCellExistsAndSynced: created paragraph", cell.metadata?.id);
                return true;
            }
            await this.updateParagraphText(cell);
            await this.updateParagraphConfig(cell);
            logDebug("ensureCellExistsAndSynced: synced paragraph", cell.metadata?.id);
            return true;
        } catch (err) {
            logDebug("ensureCellExistsAndSynced failed", err);
            return false;
        }
    }

    /**
     * Extracts the interpreter prefix (e.g., %spark_rajeswara-kaipa) from cell text
     */
    public getInterpreterFromCell(cell: vscode.NotebookCell): string | undefined {
        const text = cell.document.getText();
        // Match interpreter prefix like %spark_rajeswara-kaipa at the start
        const match = text.match(/^[\s\n]*(%[\w\d\._-]+)/);
        if (match && match[1]) {
            return match[1];
        }
        return undefined;
    }

    /**
     * Updates the text content of a cell
     */
    public async updateCellText(cell: vscode.NotebookCell, newText: string): Promise<boolean> {
        const editor = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            cell.document.positionAt(0),
            cell.document.positionAt(cell.document.getText().length)
        );
        editor.replace(cell.document.uri, fullRange, newText);
        return vscode.workspace.applyEdit(editor);
    }

    /**
     * Handles newly added cell: inherits interpreter from above cell
     */
    public async handleNewCellAdded(cell: vscode.NotebookCell): Promise<void> {
        const notebook = cell.notebook;
        const cellIndex = cell.index;
        const cellText = cell.document.getText().trim();

        // Only process if the cell is empty (new cell)
        if (cellText.length === 0 && cellIndex > 0) {
            // Get the previous cell
            const previousCell = notebook.cellAt(cellIndex - 1);
            if (previousCell) {
                const interpreterPrefix = this.getInterpreterFromCell(previousCell);
                if (interpreterPrefix) {
                    // Update the new cell with the interpreter prefix
                    await this.updateCellText(cell, interpreterPrefix + '\n');
                    logDebug(`Inherited interpreter from previous cell: ${interpreterPrefix}`);
                }
            }
        }
    }
}
