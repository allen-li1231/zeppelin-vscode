// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as interact from '../common/interaction';
import { CellStatusProvider} from '../component/cellStatusBar';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { EXTENSION_NAME,
	NOTEBOOK_SUFFIX,
	mapZeppelinLanguage,
	logDebug,
	isLocalNotebook
} from '../common/common';
import { ParagraphData } from '../common/types';
const _ = require('lodash');


/**
 * Virtual document provider that serves the remote (server) version
 * of a cell's text so we can open a VS Code diff editor against it.
 *
 * URI format:  zeppelin-remote:/<noteId>/<paragraphId>
 * The actual text is stashed in the provider before opening the diff.
 */
class ZeppelinRemoteContentProvider implements vscode.TextDocumentContentProvider {
	private _contents = new Map<string, string>();

	onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	onDidChange = this.onDidChangeEmitter.event;

	/** Store remote text so provideTextDocumentContent can return it. */
	setContent(uri: vscode.Uri, text: string) {
		this._contents.set(uri.toString(), text);
	}

	/** Remove cached content after the diff is closed. */
	clearContent(uri: vscode.Uri) {
		this._contents.delete(uri.toString());
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this._contents.get(uri.toString()) ?? '';
	}
}


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
	context.subscriptions.push(cellStatusBar);

	// Register virtual document provider for remote cell content (diff view)
	const remoteProvider = new ZeppelinRemoteContentProvider();
	disposable = vscode.workspace.registerTextDocumentContentProvider(
		'zeppelin-remote', remoteProvider
	);
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
		'zeppelin-vscode.createMissingParagraph',
		_.partial(interact.promptCreateParagraph, kernel)
	);
	context.subscriptions.push(disposable);


	// Show diff between local cell and remote (server) version
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.showCellDiff',
		async (cell: vscode.NotebookCell) => {
			let conflict: ParagraphData | undefined = cell.metadata?.syncConflict;
			if (conflict === undefined) {
				vscode.window.showInformationMessage('No sync conflict on this cell.');
				return;
			}

			// Mark cell as resolving diff so syncNote preserves the conflict
			// and paragraph updates / execution are blocked until resolved.
			if (!cell.metadata.resolvingDiff) {
				await kernel.editWithoutParagraphUpdate(async () => {
					await kernel.updateCellMetadata(cell, { resolvingDiff: true });
				});
			}

			let noteId = cell.notebook.metadata.id ?? 'unknown';
			let paragraphId = cell.metadata.id ?? 'unknown';
			let remoteUri = vscode.Uri.parse(
				`zeppelin-remote:/${noteId}/${paragraphId}.txt`
			);

			remoteProvider.setContent(remoteUri, conflict.text ?? '');
			remoteProvider.onDidChangeEmitter.fire(remoteUri);

			await vscode.commands.executeCommand(
				'vscode.diff',
				remoteUri,
				cell.document.uri,
				`Remote ↔ Local  [${paragraphId}]`
			);
		}
	);
	context.subscriptions.push(disposable);


	// Accept the remote (server) version of a cell
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.acceptRemoteCell',
		async (cell: vscode.NotebookCell) => {
			await kernel.acceptRemoteCell(cell);
		}
	);
	context.subscriptions.push(disposable);


	// Accept the local version of a cell and push to server
	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.acceptLocalCell',
		async (cell: vscode.NotebookCell) => {
			await kernel.acceptLocalCell(cell);
		}
	);
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidOpenNotebookDocument(async note => {
		if (!isLocalNotebook(note.uri)) {
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
		if (!isLocalNotebook(event.notebook.uri)
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
					kernel.updateParagraph(cellAdded);
				}
				else {
					// normal add/remove cell registeration
					if (cellAdded !== undefined) {
						logDebug("onDidChangeNotebookDocument: cellAdded", cellAdded.index);
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
		if (!isLocalNotebook(event.notebook.uri)
			|| !kernel.isActive()) {
			return;
		}

		if (event.notebook.isDirty) {
			event.waitUntil(
				kernel.updatePollingParagraphsDirect()
					.then(() => kernel.applyPolledNotebookEdits())
			);
		}
		else {
			event.waitUntil(kernel.applyPolledNotebookEdits());
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.window.onDidChangeTextEditorOptions(async event => {
		if (event.textEditor.document.uri.scheme !== 'file'
			|| !event.textEditor.document.uri.fsPath.endsWith(NOTEBOOK_SUFFIX)
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
			let lang = mapZeppelinLanguage.get(cell.document.languageId) ?? "plain_text";
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
		if (event?.notebook === undefined
			|| !kernel.isActive()
			|| !isLocalNotebook(event.notebook.uri)) {
			return;
		}
		logDebug("onDidChangeActiveNotebookEditor", event);

		if (await kernel.doesNotebookExist(event.notebook)) {
			let config = vscode.workspace.getConfiguration('zeppelin');
			let selection = config.get('autosave.syncActiveNotebook');

			if (selection && !kernel.isNoteSyncing(event.notebook)) {
        		await kernel.updatePollingParagraphsDirect();
				await kernel.syncNote(event.notebook);
			}
		}
		else {
			interact.promptCreateNotebook(kernel, event.notebook);
		}
	});
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	logDebug("deactivate");
}