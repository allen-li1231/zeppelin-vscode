// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as interact from '../common/interaction';
import { CellStatusProvider} from '../component/cellStatusBar';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { EXTENSION_NAME, NOTEBOOK_SUFFIX, mapZeppelinLanguage, logDebug } from '../common/common';
import { AIModeManager } from '../component/aiMode';
import _ = require('lodash');


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
const REFRESH_COOLDOWN_MS = 30 * 1000;  // Button visible but inactive for 30s after click (global limit is in kernel: 5 per 30 min)

export async function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	let kernel = new ZeppelinKernel(context);
	context.subscriptions.push(kernel);

	// Auto-refresh all open Zeppelin notebooks on reload/reopen
	_refreshOpenNotebooksOnStartup(kernel);

	let disposable = vscode.workspace.registerNotebookSerializer(
		EXTENSION_NAME, new ZeppelinSerializer()
	);
	context.subscriptions.push(disposable);

	let cellStatusBar = new CellStatusProvider(kernel);
	disposable = vscode.notebooks.registerNotebookCellStatusBarItemProvider(
		EXTENSION_NAME, cellStatusBar
	);
	kernel.cellStatusBar = cellStatusBar;
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinServerURL',
		() => interact.promptZeppelinServerURL(kernel)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinCredential',
		_ => interact.promptZeppelinCredential(kernel)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.logout',
		_ => interact.promptZeppelinLogout(kernel)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.importCurrentNotebook',
		_ => interact.promptCreateNotebook(
			kernel, vscode.window.activeNotebookEditor?.notebook
		)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.restartInterpreter',
		_.partial(interact.promptRestartInterpreter, kernel)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.restartNotebookInterpreter',
		() => interact.promptRestartNotebookInterpreter(kernel)
	);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.recreateNote',
		() => interact.promptRecreateNote(kernel)
	);
	context.subscriptions.push(disposable);

	// Create AI Notebook: prompt file name + interpreter, create notebook with one cell, then enter AI Mode
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.createAINotebook',
		async () => {
			await interact.promptCreateAINotebook(kernel);
			await AIModeManager.enterAIMode(kernel);
		}
	);
	context.subscriptions.push(disposable);

	// Refresh button stays visible but inactive for 30s after each click
	let refreshCooldownEndTime = 0;

	// Command to manually refresh/resync the notebook (global 5-per-30min limit enforced in kernel.syncNote)
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.refreshNotebook',
		async () => {
			const note = vscode.window.activeNotebookEditor?.notebook;
			if (!note) {
				vscode.window.showWarningMessage('No active notebook to refresh');
				return;
			}
			if (!kernel.isActive()) {
				vscode.window.showWarningMessage('Not connected to Zeppelin server');
				return;
			}
			if (kernel.isNoteSyncing(note)) {
				vscode.window.setStatusBarMessage('$(sync~spin) Refresh already in progress...', 2000);
				return;
			}

			const now = Date.now();
			if (now < refreshCooldownEndTime) {
				const secs = Math.ceil((refreshCooldownEndTime - now) / 1000);
				vscode.window.showWarningMessage(`Refresh available in ${secs} second(s).`);
				return;
			}

			refreshCooldownEndTime = now + REFRESH_COOLDOWN_MS;

			vscode.window.showInformationMessage('Refreshing notebook from server...');
			const isHealthy = await kernel.forceConnectionCheck();
			if (!isHealthy) {
				vscode.window.showErrorMessage('Cannot connect to Zeppelin server. Please check your network connection.');
				return;
			}
			await kernel.syncNote(note);
			vscode.window.showInformationMessage('Notebook refreshed successfully');
		}
	);
	context.subscriptions.push(disposable);

	// Reload Window - reloads the VS Code window (e.g. to apply config changes)
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.reloadWindow',
		async () => {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	);
	context.subscriptions.push(disposable);

	// AI Mode command - Enter AI Mode for selected cells
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.enterAIMode',
		async () => {
			await AIModeManager.enterAIMode(kernel);
		}
	);
	context.subscriptions.push(disposable);


	// AI Mode actions command - Show Done/Cancel options
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.aiMode.showActions',
		async () => {
			await AIModeManager.showAIModeActions();
		}
	);
	context.subscriptions.push(disposable);


	// Select cell for AI Mode
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.selectCellForAIMode',
		async (cell: vscode.NotebookCell) => {
			AIModeManager.toggleCellSelection(cell);
			cellStatusBar.refresh();
		}
	);
	context.subscriptions.push(disposable);


	// AI Mode Done command (for command palette)
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.aiMode.done',
		async () => {
			await AIModeManager.applyAIModeChanges();
		}
	);
	context.subscriptions.push(disposable);


	// AI Mode Cancel command (for command palette)
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.aiMode.cancel',
		async () => {
			await AIModeManager.cancelAIMode();
		}
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.createMissingParagraph',
		_.partial(interact.promptCreateParagraph, kernel)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.copyCellContent',
		async (cell?: vscode.NotebookCell) => {
			// If cell is not provided, try to get the active cell
			if (!cell) {
				const activeEditor = vscode.window.activeNotebookEditor;
				if (activeEditor && activeEditor.selection) {
					const cellIndex = activeEditor.selection.start;
					cell = activeEditor.notebook.cellAt(cellIndex);
				}
			}
			
			if (cell) {
				const content = cell.document.getText();
				await vscode.env.clipboard.writeText(content);
				vscode.window.showInformationMessage('✓ Cell content copied to clipboard!');
			} else {
				vscode.window.showWarningMessage('No cell selected to copy');
			}
		}
	);
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidOpenNotebookDocument(async note => {
		if (!note.uri.fsPath.endsWith(NOTEBOOK_SUFFIX) 
			|| note.uri.scheme === 'git') {
			return;
		}
		logDebug("onDidOpenNotebookDocument:", note);

		// lock file before kernel is able to connected to server
		// vscode.commands.executeCommand(
		// 	"workbench.action.files.setActiveEditorReadonlyInSession"
		// );

		// user selection could be undefined (user never determined),
		// Yes, No or Never (user specified)
		let config = vscode.workspace.getConfiguration('zeppelin');
		let selection = config.get('alwaysConnectToTheLastServer');
		if (selection === 'Never') {
			return;
		}

		// user choose to connect to remote, will do later
		let willConnectRemote = selection !== 'No';

		if (selection !== 'Yes') {
			// ask user to connect if user choose 'No' or has never determined
			willConnectRemote = await interact.promptRemoteConnection();
		}

		if (willConnectRemote) {
			let baseURL = context.workspaceState.get(
				'currentZeppelinServerURL', undefined
			);
			kernel.checkInService(baseURL, async () => {
				// task when remote server is connectable
				// First check if notebook exists on server by ID
				if (await kernel.hasNote(note.metadata.id)) {
					if (selection === null) {
						// ask if connect automatically from now on.
						interact.promptAlwaysConnect();
					}
					
					// Activate WebSocket for this notebook
					const noteId = note.metadata.id;
					if (noteId) {
						await kernel.activateNotebookWebSocket(noteId);
					}
					
					// Sync the notebook to get latest content
					// If WebSocket is active, it will handle sync; otherwise use REST
					if (!noteId || !kernel.isNotebookUsingWebSocket(noteId)) {
						kernel.syncNote(note);
					}
				}
				else {
					// Notebook doesn't exist by ID, check by path
					// This handles the case where the notebook exists on server
					// but the local file doesn't have the ID yet
					const workspacePath = kernel.getWorkspaceRelativePath(note.uri);
					const existingNote = await kernel.findNoteByPath(workspacePath);
					
					if (existingNote) {
						// Found notebook by path - connect to it
						logDebug("Found existing notebook by path:", existingNote);
						await kernel.updateNoteMetadata(note, {
							id: existingNote.id,
							name: existingNote.path,
							path: existingNote.path
						});
						
						if (selection === null) {
							interact.promptAlwaysConnect();
						}
						
						// Activate WebSocket for this notebook
						await kernel.activateNotebookWebSocket(existingNote.id);
						
						// Sync to get latest content from server
						// If WebSocket is active, it will handle sync; otherwise use REST
						if (!kernel.isNotebookUsingWebSocket(existingNote.id)) {
							kernel.syncNote(note);
						}
					}
					else {
						// Notebook doesn't exist on server - prompt to create/import
						interact.promptCreateNotebook(kernel, note, 
							selection === null
							? interact.promptAlwaysConnect
							: undefined);
					}
				}
			});
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidChangeNotebookDocument(event => {
		if (!event.notebook.uri.fsPath.endsWith(NOTEBOOK_SUFFIX)
			|| !kernel.isActive()) {
			return;
		}

		// SAFETY CHECK: Don't sync changes if connection is unhealthy
		if (!kernel.isConnectionHealthy()) {
			logDebug("onDidChangeNotebookDocument: skipping - connection unhealthy");
			return;
		}

		// SAFETY CHECK: Count total removals - if too many, block to prevent data loss
		let totalRemovals = 0;
		for (let contentChange of event.contentChanges) {
			totalRemovals += contentChange.removedCells.length;
		}
		
		// If removing more than 3 cells at once, and notebook will be empty/near-empty, block it
		const resultingCellCount = event.notebook.cellCount;
		if (totalRemovals > 3 && resultingCellCount <= 1) {
			logDebug("onDidChangeNotebookDocument: BLOCKED bulk deletion", {
				removals: totalRemovals,
				resultingCellCount
			});
			vscode.window.showWarningMessage(
				`Blocked bulk deletion of ${totalRemovals} paragraphs. ` +
				`This may indicate corrupted state. Use "Refresh Notebook from Server" to restore.`
			);
			return;
		}

		// modify paragraph on remote
		for (let cellChange of event.cellChanges) {
			if (cellChange.document !== undefined) {
				logDebug("onDidChangeNotebookDocument: cellChange", cellChange);
				kernel.registerParagraphUpdate(cellChange.cell);
			}
		}

		// add or remove paragraph on remote
		for (let contentChange of event.contentChanges) {
			// cell language change behavior in VS Code: remove original cell,
			// and add (inplace) a new cell having the requested language id
			for (let [cellAdded, cellRemoved] of
					_.zip(contentChange.addedCells, contentChange.removedCells)) {
				if (cellAdded?.metadata.id !== undefined
					&& cellAdded.metadata.id === cellRemoved?.metadata.id) {
					logDebug("onDidChangeNotebookDocument: cellReplaced", cellAdded);
					kernel.updateParagraph(cellAdded);
				}
				else {
					// normal add/remove cell registeration
					if (cellAdded !== undefined) {
						logDebug("onDidChangeNotebookDocument: cellAdded", cellAdded.index);
						
						// Inherit interpreter from above cell for new empty cells
						kernel.handleNewCellAdded(cellAdded);
						
						// update right away,
						// otherwise more added cell contaminate the indices
						kernel.updateParagraph(cellAdded);
					}
					if (cellRemoved !== undefined) {
						logDebug("onDidChangeNotebookDocument: cellRemoved", cellRemoved);
						kernel.updateParagraph(cellRemoved);
					}
				}
			}
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onWillSaveNotebookDocument(event => {
		if (!event.notebook.uri.fsPath.endsWith(NOTEBOOK_SUFFIX)
			|| !kernel.isActive()) {
			return;
		}

		if (event.notebook.isDirty) {
			kernel.instantUpdatePollingParagraphs();
		}
		kernel.applyPolledNotebookEdits();
	});
	context.subscriptions.push(disposable);


	disposable = vscode.window.onDidChangeTextEditorOptions(async event => {
		if (!event.textEditor.document.uri.fsPath.endsWith(NOTEBOOK_SUFFIX)
			|| !kernel.isActive()) {
			return;
		}
		let lineNumbers =
			event.options.lineNumbers !== vscode.TextEditorLineNumbersStyle.Off;

		let notebook: vscode.NotebookDocument | undefined;
		for (let note of vscode.workspace.notebookDocuments) {
			if (note.uri === event.textEditor.document.uri) {
				notebook = note;
			}
		}

		if (notebook === undefined) {
			return;
		}

		for (let cell of notebook.getCells()) {
			if (cell.document !== event.textEditor.document) {
				continue;
			}
			let lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "sql";
			let res: boolean = await kernel.updateCellMetadata(cell, {
				config: {
					"lineNumbers": lineNumbers,
					"editorMode": `ace/mode/${lang}`,
					"editorSetting": {
						"language": lang,
						"editOnDblClick": false,
						"completionKey": "TAB",
						"completionSupport": cell.kind !== 1
					}
				}
			});
			if (!res) {
				break;
			}
			kernel.updateParagraphConfig(cell);
			break;
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.window.onDidChangeActiveNotebookEditor(async event => {
		if (!event?.notebook.uri.fsPath.endsWith(NOTEBOOK_SUFFIX)
			|| !kernel.isActive()) {
			return;
		}
		logDebug("onDidChangeActiveNotebookEditor", event);

		const notebook = event?.notebook;
		if (!notebook) {
			return;
		}

		const noteId = notebook.metadata?.id;

		// First check if notebook exists by ID
		if (await kernel.doesNotebookExist(notebook)) {
			// Activate WebSocket for this notebook (LRU will evict old ones if needed)
			if (noteId) {
				await kernel.activateNotebookWebSocket(noteId);
				kernel.touchNotebook(noteId);
			}

			// Always refresh on tab change - sync from server when switching to this tab
			if (!kernel.isNoteSyncing(notebook)) {
				if (!noteId || !kernel.isNotebookUsingWebSocket(noteId)) {
					vscode.window.setStatusBarMessage(`$(sync~spin) Refreshing notebook...`, 2000);
					await kernel.syncNote(notebook);
					vscode.window.setStatusBarMessage(`$(check) Refreshed`, 1500);
				}
			}
		}
		else {
			// Notebook doesn't exist by ID, check by path
			const workspacePath = kernel.getWorkspaceRelativePath(notebook.uri);
			const existingNote = await kernel.findNoteByPath(workspacePath);
			
			if (existingNote) {
				// Found notebook by path - connect to it silently
				logDebug("Found existing notebook by path:", existingNote);
				await kernel.updateNoteMetadata(notebook, {
					id: existingNote.id,
					name: existingNote.path,
					path: existingNote.path
				});
				
				// Activate WebSocket for this notebook
				await kernel.activateNotebookWebSocket(existingNote.id);
				
				// Always refresh on tab change
				if (!kernel.isNoteSyncing(notebook)) {
					if (!kernel.isNotebookUsingWebSocket(existingNote.id)) {
						vscode.window.setStatusBarMessage(`$(sync~spin) Refreshing notebook...`, 2000);
						await kernel.syncNote(notebook);
						vscode.window.setStatusBarMessage(`$(check) Refreshed`, 1500);
					}
				}
			}
			else {
				// Notebook doesn't exist - prompt to create
				interact.promptCreateNotebook(kernel, notebook);
			}
		}
	});
	context.subscriptions.push(disposable);
}

/**
 * On window reload/reopen: after a delay, refresh all open Zeppelin notebooks.
 * Delay allows kernel to connect (e.g. when "always connect to last server" is Yes).
 */
function _refreshOpenNotebooksOnStartup(kernel: ZeppelinKernel): void {
	// Delay so workspace is ready and kernel may have connected via restored notebooks
	setTimeout(async () => {
		if (!kernel.isActive()) {
			logDebug("refreshOnStartup: kernel not active, skip");
			return;
		}
		const notebooks = vscode.workspace.notebookDocuments.filter(
			(doc) => doc.uri.fsPath.endsWith(NOTEBOOK_SUFFIX) && doc.uri.scheme !== 'git'
		);
		if (notebooks.length === 0) {
			logDebug("refreshOnStartup: no open Zeppelin notebooks");
			return;
		}
		logDebug("refreshOnStartup: refreshing", notebooks.length, "notebook(s)");
		vscode.window.setStatusBarMessage(`$(sync~spin) Refreshing ${notebooks.length} notebook(s)...`, 5000);
		let refreshed = 0;
		for (const note of notebooks) {
			if (!note.metadata?.id) continue;
			try {
				if (await kernel.doesNotebookExist(note)) {
					await kernel.syncNote(note);
					refreshed++;
				}
			} catch (e) {
				logDebug("refreshOnStartup: sync failed for", note.uri.fsPath, e);
			}
		}
		if (refreshed > 0) {
			vscode.window.setStatusBarMessage(`$(check) Refreshed ${refreshed} notebook(s)`, 2000);
		}
	}, 3000);
}

// This method is called when your extension is deactivated
export function deactivate() {
	logDebug("deactivate");
}