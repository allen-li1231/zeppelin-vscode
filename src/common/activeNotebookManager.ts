/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Active Notebook Manager
 * Manages a pool of max N active WebSocket connections using LRU eviction
 * 
 * Only "active" notebooks get real-time WebSocket sync; others fall back to REST
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { ZeppelinWsClient, WsClientConfig } from './wsClient';
import { WsEventPayloads, WsConnectionState } from './wsTypes';
import { logDebug } from './common';

/**
 * Configuration for Active Notebook Manager
 */
export interface ActiveNotebookManagerConfig {
    maxActiveNotebooks: number;  // default 5
    wsConfig: Omit<WsClientConfig, 'baseUrl'>;
    baseUrl: string;
}

/**
 * Active notebook entry with LRU tracking
 */
interface ActiveNotebookEntry {
    noteId: string;
    client: ZeppelinWsClient;
    lastActivity: number;
    subscribedAt: number;
}

/**
 * Events emitted by ActiveNotebookManager
 */
export type ActiveNotebookEvent =
    | 'notebookActivated'
    | 'notebookDeactivated'
    | 'note'
    | 'paragraph'
    | 'paragraphAdded'
    | 'paragraphRemoved'
    | 'paragraphMoved'
    | 'progress'
    | 'outputAppend'
    | 'outputUpdate'
    | 'noteUpdated'
    | 'error'
    | 'sessionLogout';

/**
 * Active Notebook Manager
 * Maintains at most maxActiveNotebooks WebSocket connections
 * Uses LRU eviction when limit is exceeded
 */
export class ActiveNotebookManager extends EventEmitter {
    private _config: ActiveNotebookManagerConfig;
    private _activeNotebooks: Map<string, ActiveNotebookEntry> = new Map();
    private _enabled: boolean = true;

    constructor(config: ActiveNotebookManagerConfig) {
        super();
        this._config = {
            ...config,
            maxActiveNotebooks: config.maxActiveNotebooks || 5,
        };
        logDebug(`ActiveNotebookManager: initialized with max ${this._config.maxActiveNotebooks} notebooks`);
    }

    /**
     * Get the maximum number of active notebooks allowed
     */
    get maxActiveNotebooks(): number {
        return this._config.maxActiveNotebooks;
    }

    /**
     * Get current count of active notebooks
     */
    get activeCount(): number {
        return this._activeNotebooks.size;
    }

    /**
     * Check if a notebook is currently active (has WebSocket connection)
     */
    isActive(noteId: string): boolean {
        return this._activeNotebooks.has(noteId);
    }

    /**
     * Get the WebSocket client for an active notebook
     */
    getClient(noteId: string): ZeppelinWsClient | undefined {
        const entry = this._activeNotebooks.get(noteId);
        if (entry) {
            // Update last activity time
            entry.lastActivity = Date.now();
        }
        return entry?.client;
    }

    /**
     * Get all active notebook IDs
     */
    getActiveNoteIds(): string[] {
        return Array.from(this._activeNotebooks.keys());
    }

    /**
     * Enable/disable WebSocket connections
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
        if (!enabled) {
            // Disconnect all when disabled
            this.disconnectAll();
        }
    }

    /**
     * Check if WebSocket is enabled
     */
    get isEnabled(): boolean {
        return this._enabled;
    }

    /**
     * Activate a notebook - creates WebSocket connection
     * If at capacity, evicts the least recently used notebook
     */
    async activate(noteId: string): Promise<ZeppelinWsClient | undefined> {
        if (!this._enabled) {
            logDebug(`ActiveNotebookManager: WebSocket disabled, skipping activation for ${noteId}`);
            return undefined;
        }

        // Already active - just update activity time
        if (this._activeNotebooks.has(noteId)) {
            const entry = this._activeNotebooks.get(noteId)!;
            entry.lastActivity = Date.now();
            logDebug(`ActiveNotebookManager: ${noteId} already active, updated activity time`);
            return entry.client;
        }

        // Check if we need to evict
        if (this._activeNotebooks.size >= this._config.maxActiveNotebooks) {
            await this._evictLRU();
        }

        // Create new WebSocket client
        const client = new ZeppelinWsClient(noteId, {
            baseUrl: this._config.baseUrl,
            ...this._config.wsConfig,
        });

        // Set up event forwarding
        this._setupClientEvents(noteId, client);

        const entry: ActiveNotebookEntry = {
            noteId,
            client,
            lastActivity: Date.now(),
            subscribedAt: Date.now(),
        };

        this._activeNotebooks.set(noteId, entry);

        try {
            await client.connect();
            logDebug(`ActiveNotebookManager: Activated notebook ${noteId} (${this._activeNotebooks.size}/${this._config.maxActiveNotebooks})`);
            this.emit('notebookActivated', { noteId });
            return client;
        } catch (error) {
            logDebug(`ActiveNotebookManager: Failed to activate ${noteId}`, error);
            this._activeNotebooks.delete(noteId);
            throw error;
        }
    }

    /**
     * Deactivate a notebook - closes WebSocket connection
     */
    async deactivate(noteId: string): Promise<void> {
        const entry = this._activeNotebooks.get(noteId);
        if (!entry) {
            return;
        }

        entry.client.disconnect();
        entry.client.removeAllListeners();
        this._activeNotebooks.delete(noteId);

        logDebug(`ActiveNotebookManager: Deactivated notebook ${noteId} (${this._activeNotebooks.size}/${this._config.maxActiveNotebooks})`);
        this.emit('notebookDeactivated', { noteId });
    }

    /**
     * Update the activity time for a notebook (call when user interacts with it)
     */
    touch(noteId: string): void {
        const entry = this._activeNotebooks.get(noteId);
        if (entry) {
            entry.lastActivity = Date.now();
        }
    }

    /**
     * Disconnect all active notebooks
     */
    disconnectAll(): void {
        for (const [noteId, entry] of this._activeNotebooks) {
            entry.client.disconnect();
            entry.client.removeAllListeners();
            this.emit('notebookDeactivated', { noteId });
        }
        this._activeNotebooks.clear();
        logDebug(`ActiveNotebookManager: Disconnected all notebooks`);
    }

    /**
     * Update configuration (e.g., auth credentials)
     */
    updateConfig(config: Partial<ActiveNotebookManagerConfig>): void {
        this._config = { ...this._config, ...config };
        
        // If max active notebooks changed, might need to evict
        while (this._activeNotebooks.size > this._config.maxActiveNotebooks) {
            this._evictLRUSync();
        }
    }

    /**
     * Dispose the manager
     */
    dispose(): void {
        this.disconnectAll();
        this.removeAllListeners();
    }

    // =====================
    // Private Methods
    // =====================

    /**
     * Evict the least recently used notebook (async)
     */
    private async _evictLRU(): Promise<void> {
        const lru = this._findLRU();
        if (lru) {
            await this.deactivate(lru.noteId);
        }
    }

    /**
     * Evict the least recently used notebook (sync)
     */
    private _evictLRUSync(): void {
        const lru = this._findLRU();
        if (lru) {
            lru.client.disconnect();
            lru.client.removeAllListeners();
            this._activeNotebooks.delete(lru.noteId);
            this.emit('notebookDeactivated', { noteId: lru.noteId });
        }
    }

    /**
     * Find the least recently used notebook entry
     */
    private _findLRU(): ActiveNotebookEntry | undefined {
        let lru: ActiveNotebookEntry | undefined;
        
        for (const entry of this._activeNotebooks.values()) {
            if (!lru || entry.lastActivity < lru.lastActivity) {
                lru = entry;
            }
        }

        return lru;
    }

    /**
     * Set up event forwarding from client to manager
     */
    private _setupClientEvents(noteId: string, client: ZeppelinWsClient): void {
        // Forward all relevant events
        const events: Array<keyof WsEventPayloads> = [
            'note',
            'paragraph',
            'paragraphAdded',
            'paragraphRemoved',
            'paragraphMoved',
            'progress',
            'outputAppend',
            'outputUpdate',
            'noteUpdated',
            'error',
            'sessionLogout',
        ];

        for (const event of events) {
            client.on(event as any, (payload: any) => {
                this.emit(event, payload);
            });
        }

        // Handle disconnection
        client.on('disconnected', (payload) => {
            // If connection failed permanently, remove from active set
            if (client.state === WsConnectionState.ERROR) {
                this._activeNotebooks.delete(noteId);
                this.emit('notebookDeactivated', { noteId, reason: payload.reason });
            }
        });
    }
}

/**
 * Singleton instance getter
 */
let _instance: ActiveNotebookManager | undefined;

export function getActiveNotebookManager(): ActiveNotebookManager | undefined {
    return _instance;
}

export function createActiveNotebookManager(config: ActiveNotebookManagerConfig): ActiveNotebookManager {
    if (_instance) {
        _instance.dispose();
    }
    _instance = new ActiveNotebookManager(config);
    return _instance;
}

export function disposeActiveNotebookManager(): void {
    if (_instance) {
        _instance.dispose();
        _instance = undefined;
    }
}
