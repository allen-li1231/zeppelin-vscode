// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as interact from '../common/interaction';
import { CellStatusProvider} from '../component/cellStatusBar';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { EXTENSION_NAME, NOTEBOOK_SUFFIX, logDebug } from '../common/common';
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
		'zeppelin-vscode.importCurrentNotebook',
		_ => interact.promptCreateNotebook(
			kernel, vscode.window.activeNotebookEditor?.notebook
		)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.restartInterpreter',
		_.partial(interact.showRestartInterpreter, kernel)
	);
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidOpenNotebookDocument(async note => {
		if (!note.uri.fsPath.endsWith(NOTEBOOK_SUFFIX)) {
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
				// task when remote server is connectable but the note is not on it.
				if (await kernel.hasNote(note.metadata.id)) {
					if (selection === null) {
						// ask if connect automatically from now on.
						interact.promptAlwaysConnect();
					}
					//kernel.syncNote(note);
				}
				else {
					// import/create identical note when there doesn't exist one.
					interact.promptCreateNotebook(kernel, note, 
						selection === null
						? interact.promptAlwaysConnect
						: undefined);
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
					kernel.registerParagraphUpdate(cellAdded);
				}
				else {
					// normal add/remove cell registering
					if (cellAdded !== undefined) {
						logDebug("onDidChangeNotebookDocument: cellAdded", cellAdded);
						kernel.registerParagraphUpdate(cellAdded);
					}
					if (cellRemoved !== undefined) {
						logDebug("onDidChangeNotebookDocument: cellRemoved", cellRemoved);
						kernel.registerParagraphUpdate(cellRemoved);
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
			let res: boolean = await kernel.updateCellMetadata(cell, {
				config: {
					"lineNumbers": lineNumbers,
					"editorSetting": {
						"language": cell.document.languageId,
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

		if (await kernel.doesNotebookExist(event?.notebook)) {
			let config = vscode.workspace.getConfiguration('zeppelin');
			let selection = config.get('autosave.syncActiveNotebook');

			if (selection) {
				await kernel.syncNote(event?.notebook);
			}
		}
		else {
			interact.promptCreateNotebook(kernel, event?.notebook);
		}
	});
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}