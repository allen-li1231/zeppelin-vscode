/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Zeppelin WebSocket Client
 * Manages WebSocket connection to Zeppelin server for real-time notebook sync
 */

import * as vscode from 'vscode';
import * as WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logDebug } from './common';
import {
    WsOperation,
    WsMessage,
    WsConnectionState,
    WsNoteData,
    WsParagraphData,
    WsEventType,
    WsEventPayloads,
} from './wsTypes';

/**
 * Configuration for WebSocket client
 */
export interface WsClientConfig {
    baseUrl: string;
    principal: string;
    ticket: string;
    roles?: string;
    pingInterval?: number;      // ms, default 10000
    reconnectDelay?: number;    // ms, default 3000
    maxReconnectAttempts?: number; // default 5
}

/**
 * Zeppelin WebSocket Client
 * Handles connection, authentication, and message routing for a single notebook
 */
export class ZeppelinWsClient extends EventEmitter {
    private _ws: WebSocket | null = null;
    private _state: WsConnectionState = WsConnectionState.DISCONNECTED;
    private _config: WsClientConfig;
    private _noteId: string;
    private _pingTimer: NodeJS.Timer | null = null;
    private _reconnectTimer: NodeJS.Timer | null = null;
    private _reconnectAttempts: number = 0;
    private _messageQueue: WsMessage[] = [];
    private _pendingRequests: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();

    constructor(noteId: string, config: WsClientConfig) {
        super();
        this._noteId = noteId;
        this._config = {
            pingInterval: 10000,
            reconnectDelay: 3000,
            maxReconnectAttempts: 5,
            ...config,
        };
    }

    /**
     * Get current connection state
     */
    get state(): WsConnectionState {
        return this._state;
    }

    /**
     * Get the note ID this client is connected to
     */
    get noteId(): string {
        return this._noteId;
    }

    /**
     * Check if connected and authenticated
     */
    get isConnected(): boolean {
        return this._state === WsConnectionState.AUTHENTICATED;
    }

    /**
     * Connect to Zeppelin WebSocket server
     */
    async connect(): Promise<void> {
        if (this._state === WsConnectionState.CONNECTING || 
            this._state === WsConnectionState.AUTHENTICATED) {
            logDebug(`WsClient[${this._noteId}]: Already connected or connecting`);
            return;
        }

        this._setState(WsConnectionState.CONNECTING);

        try {
            // Convert HTTP URL to WebSocket URL
            const wsUrl = this._config.baseUrl
                .replace(/^http:/, 'ws:')
                .replace(/^https:/, 'wss:')
                .replace(/\/$/, '') + '/ws';

            logDebug(`WsClient[${this._noteId}]: Connecting to ${wsUrl}`);

            this._ws = new WebSocket(wsUrl, {
                headers: {
                    'Origin': this._config.baseUrl,
                },
            });

            this._ws.on('open', () => this._onOpen());
            this._ws.on('message', (data: WebSocket.Data) => this._onMessage(data));
            this._ws.on('error', (error: Error) => this._onError(error));
            this._ws.on('close', (code: number, reason: Buffer) => this._onClose(code, reason.toString()));

        } catch (error) {
            logDebug(`WsClient[${this._noteId}]: Connection error`, error);
            this._setState(WsConnectionState.ERROR);
            throw error;
        }
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        logDebug(`WsClient[${this._noteId}]: Disconnecting`);
        this._stopPingTimer();
        this._stopReconnectTimer();
        this._clearPendingRequests('Connection closed');

        if (this._ws) {
            this._ws.removeAllListeners();
            if (this._ws.readyState === WebSocket.OPEN) {
                this._ws.close(1000, 'Client disconnect');
            }
            this._ws = null;
        }

        this._setState(WsConnectionState.DISCONNECTED);
        this.emit('disconnected', { noteId: this._noteId });
    }

    /**
     * Send a message to the server
     */
    send(op: WsOperation, data?: Record<string, any>, msgId?: string): void {
        const message: WsMessage = {
            op,
            principal: this._config.principal,
            ticket: this._config.ticket,
            roles: this._config.roles || '[]',
            data: data || {},
        };

        if (msgId) {
            message.msgId = msgId;
        }

        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            const jsonMsg = JSON.stringify(message);
            logDebug(`WsClient[${this._noteId}]: Sending ${op}`, data);
            this._ws.send(jsonMsg);
        } else {
            // Queue message for when connected
            this._messageQueue.push(message);
            logDebug(`WsClient[${this._noteId}]: Queued message ${op} (not connected)`);
        }
    }

    /**
     * Send a request and wait for response
     */
    async request<T>(op: WsOperation, data?: Record<string, any>, timeoutMs: number = 30000): Promise<T> {
        return new Promise((resolve, reject) => {
            const msgId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            const timeout = setTimeout(() => {
                this._pendingRequests.delete(msgId);
                reject(new Error(`Request ${op} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this._pendingRequests.set(msgId, { resolve, reject, timeout });
            this.send(op, { ...data, msgId }, msgId);
        });
    }

    // =====================
    // Notebook Operations
    // =====================

    /**
     * Subscribe to a note (GET_NOTE)
     */
    async getNote(): Promise<WsNoteData> {
        this.send(WsOperation.GET_NOTE, { id: this._noteId });
        // The response comes via the 'note' event
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.removeListener('note', handler);
                reject(new Error('GET_NOTE timeout'));
            }, 30000);

            const handler = (payload: WsEventPayloads['note']) => {
                if (payload.note.id === this._noteId) {
                    clearTimeout(timeout);
                    this.removeListener('note', handler);
                    resolve(payload.note);
                }
            };

            this.on('note', handler);
        });
    }

    /**
     * Update paragraph text/config (COMMIT_PARAGRAPH)
     */
    commitParagraph(paragraphId: string, text: string, title?: string, 
                    params?: Record<string, any>, config?: Record<string, any>): void {
        this.send(WsOperation.COMMIT_PARAGRAPH, {
            id: paragraphId,
            noteId: this._noteId,
            paragraph: text,
            title: title,
            params: params || {},
            config: config || {},
        });
    }

    /**
     * Run a paragraph (RUN_PARAGRAPH)
     */
    runParagraph(paragraphId: string, text: string, title?: string,
                 params?: Record<string, any>, config?: Record<string, any>): void {
        this.send(WsOperation.RUN_PARAGRAPH, {
            id: paragraphId,
            noteId: this._noteId,
            paragraph: text,
            title: title,
            params: params || {},
            config: config || {},
        });
    }

    /**
     * Cancel paragraph execution (CANCEL_PARAGRAPH)
     */
    cancelParagraph(paragraphId: string): void {
        this.send(WsOperation.CANCEL_PARAGRAPH, {
            id: paragraphId,
            noteId: this._noteId,
        });
    }

    /**
     * Insert a new paragraph (INSERT_PARAGRAPH)
     */
    insertParagraph(index: number, config?: Record<string, any>): void {
        this.send(WsOperation.INSERT_PARAGRAPH, {
            index,
            noteId: this._noteId,
            config: config || {},
        });
    }

    /**
     * Remove a paragraph (PARAGRAPH_REMOVE)
     */
    removeParagraph(paragraphId: string): void {
        this.send(WsOperation.PARAGRAPH_REMOVE, {
            id: paragraphId,
            noteId: this._noteId,
        });
    }

    /**
     * Move a paragraph (MOVE_PARAGRAPH)
     */
    moveParagraph(paragraphId: string, newIndex: number): void {
        this.send(WsOperation.MOVE_PARAGRAPH, {
            id: paragraphId,
            index: newIndex,
            noteId: this._noteId,
        });
    }

    // =====================
    // Private Methods
    // =====================

    private _setState(state: WsConnectionState): void {
        const oldState = this._state;
        this._state = state;
        logDebug(`WsClient[${this._noteId}]: State ${oldState} -> ${state}`);
    }

    private _onOpen(): void {
        logDebug(`WsClient[${this._noteId}]: WebSocket opened`);
        this._reconnectAttempts = 0;
        this._setState(WsConnectionState.CONNECTED);

        // Start ping timer
        this._startPingTimer();

        // Subscribe to the note
        this.send(WsOperation.GET_NOTE, { id: this._noteId });
        
        // Mark as authenticated (Zeppelin uses ticket in each message)
        this._setState(WsConnectionState.AUTHENTICATED);

        // Flush queued messages
        this._flushMessageQueue();

        this.emit('connected', { noteId: this._noteId });
    }

    private _onMessage(data: WebSocket.Data): void {
        try {
            const message: WsMessage = JSON.parse(data.toString());
            
            // Don't log PING responses
            if (message.op !== WsOperation.PING) {
                logDebug(`WsClient[${this._noteId}]: Received ${message.op}`, message.data);
            }

            // Check for pending request response
            if (message.msgId && this._pendingRequests.has(message.msgId)) {
                const pending = this._pendingRequests.get(message.msgId)!;
                clearTimeout(pending.timeout);
                this._pendingRequests.delete(message.msgId);
                pending.resolve(message.data);
                return;
            }

            // Route message to appropriate handler
            this._handleMessage(message);

        } catch (error) {
            logDebug(`WsClient[${this._noteId}]: Failed to parse message`, error);
        }
    }

    private _handleMessage(message: WsMessage): void {
        const noteId = this._noteId;

        switch (message.op) {
            case WsOperation.NOTE:
                this.emit('note', { note: message.data?.note || message.data });
                break;

            case WsOperation.PARAGRAPH:
                this.emit('paragraph', {
                    noteId,
                    paragraph: message.data?.paragraph || message.data,
                    msgId: message.msgId,
                });
                break;

            case WsOperation.PARAGRAPH_ADDED:
                this.emit('paragraphAdded', {
                    noteId,
                    paragraph: message.data?.paragraph,
                    index: message.data?.index,
                });
                break;

            case WsOperation.PARAGRAPH_REMOVED:
                this.emit('paragraphRemoved', {
                    noteId,
                    paragraphId: message.data?.id,
                });
                break;

            case WsOperation.PARAGRAPH_MOVED:
                this.emit('paragraphMoved', {
                    noteId,
                    paragraphId: message.data?.id,
                    index: message.data?.index,
                });
                break;

            case WsOperation.PROGRESS:
                this.emit('progress', {
                    noteId,
                    paragraphId: message.data?.id,
                    progress: message.data?.progress,
                });
                break;

            case WsOperation.PARAGRAPH_APPEND_OUTPUT:
                this.emit('outputAppend', {
                    noteId: message.data?.noteId || noteId,
                    paragraphId: message.data?.paragraphId,
                    index: message.data?.index,
                    data: message.data?.data,
                });
                break;

            case WsOperation.PARAGRAPH_UPDATE_OUTPUT:
                this.emit('outputUpdate', {
                    noteId: message.data?.noteId || noteId,
                    paragraphId: message.data?.paragraphId,
                    index: message.data?.index,
                    type: message.data?.type,
                    data: message.data?.data,
                });
                break;

            case WsOperation.NOTE_UPDATED:
                this.emit('noteUpdated', {
                    noteId,
                    name: message.data?.name,
                    config: message.data?.config,
                });
                break;

            case WsOperation.NOTE_RUNNING_STATUS:
                this.emit('noteRunningStatus', {
                    noteId,
                    status: message.data?.status,
                });
                break;

            case WsOperation.NOTES_INFO:
                this.emit('notesInfo', {
                    notes: message.data?.notes,
                });
                break;

            case WsOperation.SESSION_LOGOUT:
                this.emit('sessionLogout', {
                    info: message.data?.info,
                });
                // Disconnect on session logout
                this.disconnect();
                break;

            case WsOperation.ERROR_INFO:
                this.emit('error', {
                    noteId,
                    error: new Error(message.data?.info || 'Unknown error'),
                    message: message.data?.info,
                });
                break;

            case WsOperation.AUTH_INFO:
                logDebug(`WsClient[${this._noteId}]: Auth info`, message.data);
                break;

            default:
                logDebug(`WsClient[${this._noteId}]: Unhandled operation ${message.op}`);
        }
    }

    private _onError(error: Error): void {
        logDebug(`WsClient[${this._noteId}]: WebSocket error`, error);
        this.emit('error', {
            noteId: this._noteId,
            error,
            message: error.message,
        });
    }

    private _onClose(code: number, reason: string): void {
        logDebug(`WsClient[${this._noteId}]: WebSocket closed (${code}: ${reason})`);
        this._stopPingTimer();

        if (this._state !== WsConnectionState.DISCONNECTED) {
            // Attempt reconnection
            this._attemptReconnect();
        }
    }

    private _attemptReconnect(): void {
        this._stopReconnectTimer();
        this._reconnectAttempts++;
        this._setState(WsConnectionState.RECONNECTING);

        const delay = this._config.reconnectDelay ?? 3000;
        logDebug(`WsClient[${this._noteId}]: Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);

        this._reconnectTimer = setTimeout(() => {
            this._ws = null;
            this.connect().catch((error) => {
                logDebug(`WsClient[${this._noteId}]: Reconnect failed`, error);
                this._ws = null;
                this._onClose(0, 'Reconnect failed');
            });
        }, delay);
    }

    private _startPingTimer(): void {
        this._stopPingTimer();
        this._pingTimer = setInterval(() => {
            if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                this.send(WsOperation.PING);
            }
        }, this._config.pingInterval || 10000);
    }

    private _stopPingTimer(): void {
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
    }

    private _stopReconnectTimer(): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    private _flushMessageQueue(): void {
        while (this._messageQueue.length > 0) {
            const message = this._messageQueue.shift()!;
            if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                this._ws.send(JSON.stringify(message));
            }
        }
    }

    private _clearPendingRequests(reason: string): void {
        for (const [msgId, pending] of this._pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(reason));
        }
        this._pendingRequests.clear();
    }

    /**
     * Type-safe event listener
     */
    on<T extends WsEventType>(event: T, listener: (payload: WsEventPayloads[T]) => void): this {
        return super.on(event, listener);
    }

    emit<T extends WsEventType>(event: T, payload: WsEventPayloads[T]): boolean {
        return super.emit(event, payload);
    }
}
