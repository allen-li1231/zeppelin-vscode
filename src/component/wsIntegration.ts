/* eslint-disable @typescript-eslint/naming-convention */
/**
 * WebSocket Integration for ZeppelinKernel
 * Bridges between the kernel and the ActiveNotebookManager
 * Handles WebSocket events and converts them to kernel operations
 */

import * as vscode from 'vscode';
import { logDebug } from '../common/common';
import {
    ActiveNotebookManager,
    createActiveNotebookManager,
    getActiveNotebookManager,
    disposeActiveNotebookManager,
} from '../common/activeNotebookManager';
import { ZeppelinWsClient } from '../common/wsClient';
import { WsEventPayloads, WsParagraphData } from '../common/wsTypes';
import { parseParagraphToCellData, parseParagraphResultToCellOutput } from '../common/parser';
import { ParagraphData } from '../common/types';

/**
 * Configuration for WebSocket integration
 */
export interface WsIntegrationConfig {
    enabled: boolean;
    maxActiveNotebooks: number;
    pingInterval: number;
    reconnectDelay: number;
    maxReconnectAttempts: number;
    baseUrl: string;
    principal: string;
    ticket: string;
}

/**
 * WebSocket integration state
 */
interface WsIntegrationState {
    manager: ActiveNotebookManager | undefined;
    eventHandlers: Map<string, (...args: any[]) => void>;
    kernel: any;  // Will be ZeppelinKernel, avoiding circular import
}

const state: WsIntegrationState = {
    manager: undefined,
    eventHandlers: new Map(),
    kernel: undefined,
};

/**
 * Initialize WebSocket integration
 */
export function initWsIntegration(kernel: any, config: WsIntegrationConfig): ActiveNotebookManager | undefined {
    if (!config.enabled) {
        logDebug('WsIntegration: WebSocket disabled by configuration');
        return undefined;
    }

    state.kernel = kernel;

    // Create manager if not exists or config changed
    const manager = createActiveNotebookManager({
        maxActiveNotebooks: config.maxActiveNotebooks,
        baseUrl: config.baseUrl,
        wsConfig: {
            principal: config.principal,
            ticket: config.ticket,
            pingInterval: config.pingInterval * 1000,
            reconnectDelay: config.reconnectDelay * 1000,
            maxReconnectAttempts: config.maxReconnectAttempts,
        },
    });

    state.manager = manager;

    // Set up event handlers
    _setupEventHandlers(manager);

    logDebug(`WsIntegration: Initialized with max ${config.maxActiveNotebooks} active notebooks`);
    return manager;
}

/**
 * Dispose WebSocket integration
 */
export function disposeWsIntegration(): void {
    if (state.manager) {
        state.manager.removeAllListeners();
    }
    disposeActiveNotebookManager();
    state.manager = undefined;
    state.kernel = undefined;
    state.eventHandlers.clear();
    logDebug('WsIntegration: Disposed');
}

/**
 * Check if WebSocket is enabled and manager exists
 */
export function isWsEnabled(): boolean {
    return !!state.manager?.isEnabled;
}

/**
 * Get the active notebook manager
 */
export function getWsManager(): ActiveNotebookManager | undefined {
    return state.manager;
}

/**
 * Check if a notebook has an active WebSocket connection
 */
export function isNotebookWsActive(noteId: string): boolean {
    return state.manager?.isActive(noteId) ?? false;
}

/**
 * Sync a notebook via WebSocket (GET_NOTE)
 * Returns true if sync was initiated via WS, false if should fallback to REST
 */
export async function syncNoteViaWs(noteId: string): Promise<boolean> {
    if (!state.manager || !isNotebookWsActive(noteId)) {
        return false;
    }

    const client = state.manager.getClient(noteId);
    if (!client || !client.isConnected) {
        return false;
    }

    try {
        logDebug(`WsIntegration: Syncing note ${noteId} via WebSocket`);
        // Send GET_NOTE - the response will come through the 'note' event handler
        await client.getNote();
        return true;
    } catch (error) {
        logDebug(`WsIntegration: Failed to sync note via WS, fallback to REST`, error);
        return false;
    }
}

/**
 * Run a paragraph via WebSocket
 * Returns true if run was initiated via WS, false if should fallback to REST
 */
export function runParagraphViaWs(noteId: string, paragraphId: string, text: string, title?: string): boolean {
    if (!state.manager || !isNotebookWsActive(noteId)) {
        return false;
    }

    const client = state.manager.getClient(noteId);
    if (!client || !client.isConnected) {
        return false;
    }

    try {
        logDebug(`WsIntegration: Running paragraph ${paragraphId} via WebSocket`);
        client.runParagraph(paragraphId, text, title);
        return true;
    } catch (error) {
        logDebug(`WsIntegration: Failed to run paragraph via WS`, error);
        return false;
    }
}

/**
 * Cancel a paragraph via WebSocket
 */
export function cancelParagraphViaWs(noteId: string, paragraphId: string): boolean {
    if (!state.manager || !isNotebookWsActive(noteId)) {
        return false;
    }

    const client = state.manager.getClient(noteId);
    if (!client || !client.isConnected) {
        return false;
    }

    try {
        logDebug(`WsIntegration: Canceling paragraph ${paragraphId} via WebSocket`);
        client.cancelParagraph(paragraphId);
        return true;
    } catch (error) {
        logDebug(`WsIntegration: Failed to cancel paragraph via WS`, error);
        return false;
    }
}

/**
 * Commit paragraph changes via WebSocket (save text/config)
 */
export function commitParagraphViaWs(
    noteId: string,
    paragraphId: string,
    text: string,
    title?: string,
    config?: Record<string, any>
): boolean {
    if (!state.manager || !isNotebookWsActive(noteId)) {
        return false;
    }

    const client = state.manager.getClient(noteId);
    if (!client || !client.isConnected) {
        return false;
    }

    try {
        logDebug(`WsIntegration: Committing paragraph ${paragraphId} via WebSocket`);
        client.commitParagraph(paragraphId, text, title, {}, config);
        return true;
    } catch (error) {
        logDebug(`WsIntegration: Failed to commit paragraph via WS`, error);
        return false;
    }
}

/**
 * Delete a paragraph via WebSocket
 */
export function deleteParagraphViaWs(noteId: string, paragraphId: string): boolean {
    if (!state.manager || !isNotebookWsActive(noteId)) {
        return false;
    }

    const client = state.manager.getClient(noteId);
    if (!client || !client.isConnected) {
        return false;
    }

    try {
        logDebug(`WsIntegration: Deleting paragraph ${paragraphId} via WebSocket`);
        client.removeParagraph(paragraphId);
        return true;
    } catch (error) {
        logDebug(`WsIntegration: Failed to delete paragraph via WS`, error);
        return false;
    }
}

/**
 * Activate WebSocket for a notebook
 */
export async function activateNotebookWs(noteId: string): Promise<ZeppelinWsClient | undefined> {
    if (!state.manager) {
        return undefined;
    }

    try {
        const client = await state.manager.activate(noteId);
        logDebug(`WsIntegration: Activated WebSocket for notebook ${noteId}`);
        return client;
    } catch (error) {
        logDebug(`WsIntegration: Failed to activate WebSocket for ${noteId}`, error);
        return undefined;
    }
}

/**
 * Deactivate WebSocket for a notebook
 */
export async function deactivateNotebookWs(noteId: string): Promise<void> {
    if (!state.manager) {
        return;
    }

    await state.manager.deactivate(noteId);
    logDebug(`WsIntegration: Deactivated WebSocket for notebook ${noteId}`);
}

/**
 * Get the WebSocket client for a notebook
 */
export function getNotebookWsClient(noteId: string): ZeppelinWsClient | undefined {
    return state.manager?.getClient(noteId);
}

/**
 * Update activity time for a notebook (call when user interacts)
 */
export function touchNotebook(noteId: string): void {
    state.manager?.touch(noteId);
}

/**
 * Update WebSocket configuration (e.g., after re-login)
 */
export function updateWsConfig(config: Partial<WsIntegrationConfig>): void {
    if (!state.manager) {
        return;
    }

    const updateConfig: any = {};
    
    if (config.maxActiveNotebooks !== undefined) {
        updateConfig.maxActiveNotebooks = config.maxActiveNotebooks;
    }
    
    if (config.baseUrl || config.principal || config.ticket) {
        updateConfig.wsConfig = {
            baseUrl: config.baseUrl,
            principal: config.principal,
            ticket: config.ticket,
            pingInterval: config.pingInterval ? config.pingInterval * 1000 : undefined,
            reconnectDelay: config.reconnectDelay ? config.reconnectDelay * 1000 : undefined,
            maxReconnectAttempts: config.maxReconnectAttempts,
        };
    }

    state.manager.updateConfig(updateConfig);
}

// =====================
// Private Functions
// =====================

/**
 * Set up event handlers for the manager
 */
function _setupEventHandlers(manager: ActiveNotebookManager): void {
    // Handle note data received
    manager.on('note' as any, (payload: WsEventPayloads['note']) => {
        _handleNoteEvent(payload);
    });

    // Handle paragraph updates
    manager.on('paragraph' as any, (payload: WsEventPayloads['paragraph']) => {
        _handleParagraphEvent(payload);
    });

    // Handle paragraph added
    manager.on('paragraphAdded' as any, (payload: WsEventPayloads['paragraphAdded']) => {
        _handleParagraphAddedEvent(payload);
    });

    // Handle paragraph removed
    manager.on('paragraphRemoved' as any, (payload: WsEventPayloads['paragraphRemoved']) => {
        _handleParagraphRemovedEvent(payload);
    });

    // Handle paragraph moved
    manager.on('paragraphMoved' as any, (payload: WsEventPayloads['paragraphMoved']) => {
        _handleParagraphMovedEvent(payload);
    });

    // Handle execution progress
    manager.on('progress' as any, (payload: WsEventPayloads['progress']) => {
        _handleProgressEvent(payload);
    });

    // Handle output append
    manager.on('outputAppend' as any, (payload: WsEventPayloads['outputAppend']) => {
        _handleOutputAppendEvent(payload);
    });

    // Handle output update
    manager.on('outputUpdate' as any, (payload: WsEventPayloads['outputUpdate']) => {
        _handleOutputUpdateEvent(payload);
    });

    // Handle errors
    manager.on('error' as any, (payload: WsEventPayloads['error']) => {
        logDebug('WsIntegration: Error event', payload);
    });

    // Handle session logout
    manager.on('sessionLogout' as any, (payload: WsEventPayloads['sessionLogout']) => {
        logDebug('WsIntegration: Session logout', payload);
        vscode.window.setStatusBarMessage(`$(warning) Zeppelin session expired: ${payload.info}. Please re-login.`, 10000);
    });

    // Handle notebook activation/deactivation
    manager.on('notebookActivated' as any, (payload: { noteId: string }) => {
        logDebug(`WsIntegration: Notebook ${payload.noteId} activated via WebSocket`);
    });

    manager.on('notebookDeactivated' as any, (payload: { noteId: string; reason?: string }) => {
        logDebug(`WsIntegration: Notebook ${payload.noteId} deactivated`, payload.reason);
    });
}

/**
 * Handle note event from WebSocket - Full notebook sync
 */
async function _handleNoteEvent(payload: WsEventPayloads['note']): Promise<void> {
    const kernel = state.kernel;
    if (!kernel) {
        return;
    }

    const note = payload.note;
    if (!note?.id) {
        return;
    }

    logDebug(`WsIntegration: Received note event for ${note.id} with ${note.paragraphs?.length || 0} paragraphs`);

    // Find the corresponding notebook document
    const notebook = _findNotebookByNoteId(note.id);
    if (!notebook) {
        logDebug(`WsIntegration: No local notebook found for ${note.id}`);
        return;
    }

    // If this is the response to our own refresh (WS), apply and then unregister. Otherwise, if kernel is doing a REST sync, skip.
    const isOurRefresh = kernel.hasPendingWsSync && kernel.hasPendingWsSync(note.id);
    if (!isOurRefresh && kernel.isNoteSyncing(notebook)) {
        logDebug(`WsIntegration: Notebook ${note.id} is being synced by kernel (REST), skipping WS update`);
        return;
    }

    try {
        // Update notebook metadata
        if (note.name || note.path) {
            await kernel.updateNoteMetadata(notebook, {
                name: note.name || note.path,
                path: note.path,
            });
        }

        // SAFETY: Never overwrite local with empty server content
        const serverParagraphCount = note.paragraphs?.length ?? 0;
        const localCellCount = notebook.cellCount;
        if (serverParagraphCount === 0 && localCellCount > 0) {
            logDebug(`WsIntegration: BLOCKED - server note is empty but local has ${localCellCount} cells, skipping sync`);
            vscode.window.setStatusBarMessage(`$(warning) Skipped sync: server notebook is empty. Use "Refresh Notebook" to confirm.`, 4000);
            if (isOurRefresh) {
                kernel.removePendingWsSync(note.id);
                kernel.unregisterSyncNote(notebook);
            }
            return;
        }

        // Sync paragraphs from WebSocket only when server has content (or both are empty)
        if (note.paragraphs && note.paragraphs.length > 0) {
            await _syncParagraphsFromWs(kernel, notebook, note.paragraphs, note.name || note.path);
        }
        if (isOurRefresh) {
            kernel.removePendingWsSync(note.id);
            kernel.unregisterSyncNote(notebook);
        }
    } catch (error) {
        logDebug('WsIntegration: Failed to sync note from WS', error);
        if (isOurRefresh) {
            kernel.removePendingWsSync(note.id);
            kernel.unregisterSyncNote(notebook);
        }
    }
}

/**
 * Sync paragraphs from WebSocket note data to local notebook (merge sync: server order + local-only cells).
 */
async function _syncParagraphsFromWs(
    kernel: any,
    notebook: vscode.NotebookDocument,
    serverParagraphs: WsParagraphData[],
    noteName?: string
): Promise<void> {
    const localCellCount = notebook.cellCount;
    const serverCellCount = serverParagraphs.length;

    logDebug(`WsIntegration: Syncing ${serverCellCount} paragraphs to notebook (local: ${localCellCount})`);

    // SAFETY: Never overwrite local content with empty server state
    if (serverCellCount === 0 && localCellCount > 0) {
        logDebug(`WsIntegration: BLOCKED - would overwrite ${localCellCount} local cells with empty server state`);
        vscode.window.setStatusBarMessage(`$(warning) Skipped: server notebook is empty. Not overwriting local.`, 4000);
        return;
    }

    // Convert server paragraphs to cell data
    const serverCells = serverParagraphs.map(p => _wsParagraphToCellData(p));

    // Merge sync: server cells in order + local-only cells at end (same as Refresh Notebook).
    logDebug(`WsIntegration: merge sync (local: ${localCellCount}, server: ${serverCellCount})`);
    try {
        if (kernel && typeof kernel.syncNoteWithServerCells === 'function') {
            await kernel.syncNoteWithServerCells(notebook, serverCells, {
                name: noteName
            });
        }
    } catch (error) {
        logDebug('WsIntegration: Failed to merge sync', error);
    }
}

/**
 * Handle paragraph event from WebSocket - Real-time paragraph updates
 * This replaces REST polling for paragraph status/results
 */
async function _handleParagraphEvent(payload: WsEventPayloads['paragraph']): Promise<void> {
    const kernel = state.kernel;
    if (!kernel) {
        return;
    }

    const { noteId, paragraph } = payload;
    if (!noteId || !paragraph?.id) {
        return;
    }

    logDebug(`WsIntegration: Paragraph update for ${paragraph.id}, status: ${paragraph.status}`);

    const notebook = _findNotebookByNoteId(noteId);
    if (!notebook) {
        return;
    }

    // Find the cell corresponding to this paragraph
    const cell = _findCellByParagraphId(notebook, paragraph.id);
    if (!cell) {
        logDebug(`WsIntegration: Cell not found for paragraph ${paragraph.id}`);
        return;
    }

    // Always update metadata (status, progress, results) - this is the key sync
    await _updateCellMetadataFromParagraph(kernel, cell, paragraph);

    // Handle execution updates via WebSocket (replaces REST polling)
    const execution = kernel.getExecutionByParagraphId(paragraph.id);
    if (execution) {
        await _updateExecutionFromParagraph(kernel, execution, paragraph);
    }
}

/**
 * Update execution state from WebSocket paragraph event
 * This replaces the REST-based trackExecution polling
 */
async function _updateExecutionFromParagraph(
    _kernel: any, // eslint-disable-line @typescript-eslint/no-unused-vars
    execution: any,
    paragraph: WsParagraphData
): Promise<void> {
    const status = paragraph.status?.toUpperCase();
    logDebug(`WsIntegration: _updateExecutionFromParagraph status=${status}, id=${paragraph.id}`);

    // Update progress
    if (status === 'RUNNING' && paragraph.progress !== undefined) {
        try {
            await execution.setProgress(paragraph.progress);
        } catch (error) {
            logDebug('WsIntegration: Failed to set progress', error);
        }
    }

    // Update output if results are present
    if (paragraph.results) {
        try {
            const cellOutput = parseParagraphResultToCellOutput(paragraph.results as any);
            if (cellOutput.length === 0) {
                execution.clearOutput();
            } else {
                execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
            }
        } catch (error) {
            logDebug('WsIntegration: Failed to update execution output', error);
        }
    }

    // End execution if finished - check multiple possible status values
    const finishedStatuses = ['FINISHED', 'READY', 'ERROR', 'ABORT', 'CANCELLED', 'ABORTED'];
    if (status && finishedStatuses.includes(status)) {
        logDebug(`WsIntegration: Execution finished for ${paragraph.id}, status: ${status}`);
        const success = status === 'FINISHED' || status === 'READY';
        try {
            execution.end(success, Date.now());
            vscode.window.setStatusBarMessage(
                success ? `$(check) Execution completed` : `$(warning) Execution ${status.toLowerCase()}`,
                2000
            );
        } catch (error) {
            logDebug('WsIntegration: Failed to end execution', error);
        }
    }
}

/**
 * Handle paragraph added event
 */
async function _handleParagraphAddedEvent(payload: WsEventPayloads['paragraphAdded']): Promise<void> {
    const kernel = state.kernel;
    if (!kernel) {
        return;
    }

    const { noteId, paragraph, index } = payload;
    if (!noteId || !paragraph) {
        return;
    }

    logDebug(`WsIntegration: Paragraph added at index ${index} in note ${noteId}`);

    const notebook = _findNotebookByNoteId(noteId);
    if (!notebook) {
        return;
    }

    // Check if we already have this paragraph (our own add echoed back)
    const existingCell = _findCellByParagraphId(notebook, paragraph.id);
    if (existingCell) {
        logDebug(`WsIntegration: Paragraph ${paragraph.id} already exists locally, skipping`);
        return;
    }

    // Add the new paragraph as a cell
    try {
        const cellData = _wsParagraphToCellData(paragraph);
        await kernel.editWithoutParagraphUpdate(async () => {
            await kernel.insertNoteCells(notebook, index, [cellData]);
        });
    } catch (error) {
        logDebug('WsIntegration: Failed to add paragraph', error);
    }
}

/**
 * Handle paragraph removed event
 */
async function _handleParagraphRemovedEvent(payload: WsEventPayloads['paragraphRemoved']): Promise<void> {
    const kernel = state.kernel;
    if (!kernel) {
        return;
    }

    const { noteId, paragraphId } = payload;
    if (!noteId || !paragraphId) {
        return;
    }

    logDebug(`WsIntegration: Paragraph ${paragraphId} removed from note ${noteId}`);

    const notebook = _findNotebookByNoteId(noteId);
    if (!notebook) {
        return;
    }

    const cell = _findCellByParagraphId(notebook, paragraphId);
    if (!cell) {
        logDebug(`WsIntegration: Paragraph ${paragraphId} not found locally, skipping`);
        return;
    }

    // Remove the cell
    try {
        const range = new vscode.NotebookRange(cell.index, cell.index + 1);
        await kernel.editWithoutParagraphUpdate(async () => {
            await kernel.deleteNoteCells(notebook, range);
        });
    } catch (error) {
        logDebug('WsIntegration: Failed to remove paragraph', error);
    }
}

/**
 * Handle paragraph moved event
 */
async function _handleParagraphMovedEvent(payload: WsEventPayloads['paragraphMoved']): Promise<void> {
    const kernel = state.kernel;
    if (!kernel) {
        return;
    }

    const { noteId, paragraphId, index } = payload;
    if (!noteId || !paragraphId || index === undefined) {
        return;
    }

    logDebug(`WsIntegration: Paragraph ${paragraphId} moved to index ${index}`);

    // Note: Moving cells in VS Code requires delete + insert
    // This can be complex; for now just log it
    // Full implementation would need to track and apply the move
}

/**
 * Handle progress event from WebSocket
 */
function _handleProgressEvent(payload: WsEventPayloads['progress']): void {
    const kernel = state.kernel;
    if (!kernel) {
        return;
    }

    const { noteId, paragraphId, progress } = payload;
    if (!noteId || !paragraphId) {
        return;
    }

    logDebug(`WsIntegration: Progress ${progress}% for paragraph ${paragraphId}`);

    // Update execution progress
    const execution = kernel.getExecutionByParagraphId(paragraphId);
    if (execution) {
        execution.setProgress(progress);
    }
}

/**
 * Handle output append event
 */
function _handleOutputAppendEvent(payload: WsEventPayloads['outputAppend']): void {
    const { noteId, paragraphId, data } = payload;
    if (!noteId || !paragraphId) {
        return;
    }

    logDebug(`WsIntegration: Output append for paragraph ${paragraphId}`);

    // This would require streaming output support
    // For now, we handle full output updates in paragraph events
}

/**
 * Handle output update event
 */
function _handleOutputUpdateEvent(payload: WsEventPayloads['outputUpdate']): void {
    const { noteId, paragraphId, type, data } = payload;
    if (!noteId || !paragraphId) {
        return;
    }

    logDebug(`WsIntegration: Output update for paragraph ${paragraphId}, type: ${type}`);

    // This would update the cell output
    // For now, we handle full output updates in paragraph events
}

// =====================
// Helper Functions
// =====================

/**
 * Find a notebook document by its Zeppelin note ID
 */
function _findNotebookByNoteId(noteId: string): vscode.NotebookDocument | undefined {
    for (const doc of vscode.workspace.notebookDocuments) {
        if (doc.metadata?.id === noteId) {
            return doc;
        }
    }
    return undefined;
}

/**
 * Find a cell in a notebook by paragraph ID
 */
function _findCellByParagraphId(notebook: vscode.NotebookDocument, paragraphId: string): vscode.NotebookCell | undefined {
    for (const cell of notebook.getCells()) {
        if (cell.metadata?.id === paragraphId) {
            return cell;
        }
    }
    return undefined;
}

/**
 * Update cell metadata from paragraph data
 */
async function _updateCellMetadataFromParagraph(
    kernel: any,
    cell: vscode.NotebookCell,
    paragraph: WsParagraphData
): Promise<void> {
    const updates: Record<string, any> = {};

    if (paragraph.status !== undefined) {
        updates.status = paragraph.status;
    }
    if (paragraph.progress !== undefined) {
        updates.progress = paragraph.progress;
    }
    if (paragraph.dateStarted !== undefined) {
        updates.dateStarted = paragraph.dateStarted;
    }
    if (paragraph.dateFinished !== undefined) {
        updates.dateFinished = paragraph.dateFinished;
    }
    if (paragraph.config !== undefined) {
        updates.config = paragraph.config;
    }

    if (Object.keys(updates).length > 0) {
        try {
            await kernel.updateCellMetadata(cell, updates);
        } catch (error) {
            logDebug('WsIntegration: Failed to update cell metadata', error);
        }
    }

    // Handle execution results
    if (paragraph.results && paragraph.status !== 'RUNNING' && paragraph.status !== 'PENDING') {
        const execution = kernel.getExecutionByParagraphId(paragraph.id);
        if (execution) {
            try {
                const cellOutput = parseParagraphResultToCellOutput(paragraph.results as any);
                if (cellOutput.length > 0) {
                    execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
                }
                execution.end(paragraph.status !== 'ERROR', Date.now());
            } catch (error) {
                logDebug('WsIntegration: Failed to update execution output', error);
            }
        }
    }
}

/**
 * Convert WebSocket paragraph data to VS Code cell data
 */
function _wsParagraphToCellData(paragraph: WsParagraphData): vscode.NotebookCellData {
    // This mirrors parseParagraphToCellData but for WS data
    const text = paragraph.text || '';
    const kind = text.startsWith('%md') || text.startsWith('%markdown')
        ? vscode.NotebookCellKind.Markup
        : vscode.NotebookCellKind.Code;

    // Extract language from text
    let languageId = 'sql'; // default
    const match = text.match(/^%(\w+)/);
    if (match) {
        languageId = match[1].toLowerCase();
    }

    const cellData = new vscode.NotebookCellData(
        kind,
        kind === vscode.NotebookCellKind.Markup ? text.replace(/^%m(ark)?d(own)?\s*/, '') : text,
        languageId
    );

    cellData.metadata = {
        id: paragraph.id,
        status: paragraph.status,
        config: paragraph.config,
        dateCreated: paragraph.dateCreated,
        dateStarted: paragraph.dateStarted,
        dateFinished: paragraph.dateFinished,
    };

    return cellData;
}

/**
 * Get WebSocket configuration from VS Code settings
 */
export function getWsConfigFromSettings(baseUrl: string, principal: string, ticket: string): WsIntegrationConfig {
    const config = vscode.workspace.getConfiguration('zeppelin');
    
    return {
        enabled: config.get('websocket.enabled', true),
        maxActiveNotebooks: config.get('websocket.maxActiveNotebooks', 5),
        pingInterval: config.get('websocket.pingInterval', 10),
        reconnectDelay: config.get('websocket.reconnectDelay', 3),
        maxReconnectAttempts: config.get('websocket.maxReconnectAttempts', 5),
        baseUrl,
        principal,
        ticket,
    };
}
