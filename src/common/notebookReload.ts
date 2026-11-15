import type * as vscode from 'vscode';

// Transient correlation token: never saved to .zpln or sent to Zeppelin.
export const RELOAD_GENERATION = '__zeppelinReloadGeneration';

export interface NotebookReloadObserver {
    markNotebookReload(token?: vscode.CancellationToken): number;
}
