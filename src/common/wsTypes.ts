/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Zeppelin WebSocket Protocol Types
 * Based on Apache Zeppelin's NotebookServer WebSocket implementation
 */

/**
 * WebSocket Operation Types - matches Zeppelin's OP enum
 */
export enum WsOperation {
    // Client -> Server operations
    PING = 'PING',
    GET_NOTE = 'GET_NOTE',
    COMMIT_PARAGRAPH = 'COMMIT_PARAGRAPH',
    RUN_PARAGRAPH = 'RUN_PARAGRAPH',
    CANCEL_PARAGRAPH = 'CANCEL_PARAGRAPH',
    INSERT_PARAGRAPH = 'INSERT_PARAGRAPH',
    PARAGRAPH_REMOVE = 'PARAGRAPH_REMOVE',
    MOVE_PARAGRAPH = 'MOVE_PARAGRAPH',
    LIST_NOTES = 'LIST_NOTES',
    
    // Server -> Client operations (events)
    NOTE = 'NOTE',
    PARAGRAPH = 'PARAGRAPH',
    PARAGRAPH_ADDED = 'PARAGRAPH_ADDED',
    PARAGRAPH_REMOVED = 'PARAGRAPH_REMOVED',
    PARAGRAPH_MOVED = 'PARAGRAPH_MOVED',
    PROGRESS = 'PROGRESS',
    PARAGRAPH_APPEND_OUTPUT = 'PARAGRAPH_APPEND_OUTPUT',
    PARAGRAPH_UPDATE_OUTPUT = 'PARAGRAPH_UPDATE_OUTPUT',
    NOTE_UPDATED = 'NOTE_UPDATED',
    NOTE_RUNNING_STATUS = 'NOTE_RUNNING_STATUS',
    NOTES_INFO = 'NOTES_INFO',
    
    // Error/Auth
    ERROR_INFO = 'ERROR_INFO',
    AUTH_INFO = 'AUTH_INFO',
    SESSION_LOGOUT = 'SESSION_LOGOUT',
}

/**
 * Base WebSocket message structure
 */
export interface WsMessage {
    op: WsOperation | string;
    principal?: string;
    ticket?: string;
    roles?: string;
    msgId?: string;
    data?: Record<string, any>;
}

/**
 * Paragraph data from WebSocket
 */
export interface WsParagraphData {
    id: string;
    noteId?: string;
    title?: string;
    text?: string;
    status?: string;
    progress?: number;
    results?: {
        code: string;
        msg: Array<{ type: string; data: string }>;
    };
    config?: Record<string, any>;
    settings?: Record<string, any>;
    dateStarted?: string;
    dateFinished?: string;
    dateCreated?: string;
    dateUpdated?: string;
}

/**
 * Note data from WebSocket
 */
export interface WsNoteData {
    id: string;
    name?: string;
    path?: string;
    config?: Record<string, any>;
    info?: Record<string, any>;
    paragraphs?: WsParagraphData[];
}

/**
 * Progress update event
 */
export interface WsProgressEvent {
    id: string; // paragraph ID
    progress: number; // 0-100
}

/**
 * Output update event
 */
export interface WsOutputEvent {
    noteId: string;
    paragraphId: string;
    index: number;
    type?: string;
    data: string;
}

/**
 * WebSocket connection state
 */
export enum WsConnectionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    AUTHENTICATED = 'AUTHENTICATED',
    RECONNECTING = 'RECONNECTING',
    ERROR = 'ERROR',
}

/**
 * Subscription to a notebook via WebSocket
 */
export interface WsNoteSubscription {
    noteId: string;
    subscribedAt: number;
    lastActivity: number;
}

/**
 * WebSocket event types for EventEmitter
 */
export type WsEventType = 
    | 'connected'
    | 'disconnected'
    | 'error'
    | 'note'
    | 'paragraph'
    | 'paragraphAdded'
    | 'paragraphRemoved'
    | 'paragraphMoved'
    | 'progress'
    | 'outputAppend'
    | 'outputUpdate'
    | 'noteUpdated'
    | 'noteRunningStatus'
    | 'notesInfo'
    | 'sessionLogout';

/**
 * Event payload types
 */
export interface WsEventPayloads {
    connected: { noteId: string };
    disconnected: { noteId: string; reason?: string };
    error: { noteId?: string; error: Error; message: string };
    note: { note: WsNoteData };
    paragraph: { noteId: string; paragraph: WsParagraphData; msgId?: string };
    paragraphAdded: { noteId: string; paragraph: WsParagraphData; index: number };
    paragraphRemoved: { noteId: string; paragraphId: string };
    paragraphMoved: { noteId: string; paragraphId: string; index: number };
    progress: { noteId: string; paragraphId: string; progress: number };
    outputAppend: WsOutputEvent;
    outputUpdate: WsOutputEvent;
    noteUpdated: { noteId: string; name?: string; config?: Record<string, any> };
    noteRunningStatus: { noteId: string; status: boolean };
    notesInfo: { notes: Array<{ id: string; path: string }> };
    sessionLogout: { info: string };
}
