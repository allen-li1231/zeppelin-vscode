// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as interact from '../common/interaction';
import { CellStatusProvider} from '../component/cellStatusBar';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { EXTENSION_NAME, NOTEBOOK_SUFFIX, mapZeppelinLanguage, logDebug } from '../common/common';
import _ = require('lodash');


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	let kernel = new ZeppelinKernel(context);
	context.subscriptions.push(kernel);


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


	// Command to manually refresh/resync the notebook
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

			vscode.window.showInformationMessage('Refreshing notebook from server...');
			
			// First check connection health
			const isHealthy = await kernel.forceConnectionCheck();
			if (!isHealthy) {
				vscode.window.showErrorMessage('Cannot connect to Zeppelin server. Please check your network connection.');
				return;
			}
			
			// Sync the notebook
			await kernel.syncNote(note);
			vscode.window.showInformationMessage('Notebook refreshed successfully');
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
					// Sync the notebook to get latest content
					kernel.syncNote(note);
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
						
						// Sync to get latest content from server
						kernel.syncNote(note);
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

		// First check if notebook exists by ID
		if (await kernel.doesNotebookExist(notebook)) {
			let config = vscode.workspace.getConfiguration('zeppelin');
			let selection = config.get('autosave.syncActiveNotebook');

			if (selection && !kernel.isNoteSyncing(notebook)) {
				await kernel.syncNote(notebook);
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
				
				// Sync to get latest content from server
				let config = vscode.workspace.getConfiguration('zeppelin');
				let selection = config.get('autosave.syncActiveNotebook');
				if (selection && !kernel.isNoteSyncing(notebook)) {
					await kernel.syncNote(notebook);
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

// This method is called when your extension is deactivated
export function deactivate() {
	logDebug("deactivate");
}