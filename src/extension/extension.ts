// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as interact from '../common/interaction';
import { CellStatusProvider} from '../component/cellStatusBar';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { logger, parseLogLevel } from '../common/logger';
import { EXTENSION_NAME,
	mapZeppelinLanguage,
	isLocalNotebook,
	isLocalNotebookCell
} from '../common/common';
import { ParagraphData, NoteData } from '../common/types';
import {
	parseCellToParagraphData
} from '../common/parser';
const _ = require('lodash');


/**
 * In-memory file-system provider used to serve temporary single-cell
 * notebook files for the notebook diff editor.
 *
 * URI format:  zeppelin-diff:/<side>/<noteId>/<paragraphId>.zpln
 *   where <side> is "local" or "remote".
 */
class ZeppelinDiffFileSystemProvider implements vscode.FileSystemProvider {
	private _files = new Map<string, Uint8Array>();
	private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this._onDidChangeFile.event;

	watch(): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	stat(uri: vscode.Uri): vscode.FileStat {
		const data = this._files.get(uri.toString());
		if (!data) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return {
			type: vscode.FileType.File,
			ctime: Date.now(),
			mtime: Date.now(),
			size: data.byteLength,
		};
	}

	readFile(uri: vscode.Uri): Uint8Array {
		const data = this._files.get(uri.toString());
		if (!data) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return data;
	}

	writeFile(uri: vscode.Uri, content: Uint8Array): void {
		this._files.set(uri.toString(), content);
		this._onDidChangeFile.fire([{
			type: vscode.FileChangeType.Changed,
			uri
		}]);
	}

	delete(uri: vscode.Uri): void {
		this._files.delete(uri.toString());
	}

	readDirectory(): [string, vscode.FileType][] { return []; }
	createDirectory(): void {}
	rename(): void {}
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	// Initialize logger level from settings
	const config = vscode.workspace.getConfiguration('zeppelin');
	logger.setLevel(parseLogLevel(config.get<string>('logLevel')));

	// React to log-level changes at runtime
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('zeppelin.logLevel')) {
				const cfg = vscode.workspace.getConfiguration('zeppelin');
				logger.setLevel(parseLogLevel(cfg.get<string>('logLevel')));
			}
		})
	);

	// Register logger for disposal
	context.subscriptions.push({ dispose: () => logger.dispose() });

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

	// Register in-memory file-system for notebook diff views
	const diffFsProvider = new ZeppelinDiffFileSystemProvider();
	disposable = vscode.workspace.registerFileSystemProvider(
		'zeppelin-diff', diffFsProvider, { isReadonly: true }
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


	// Show notebook-level diff between local cell and remote (server) version
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

			// Build a single-cell notebook for the remote (server) version
			let remoteNote: NoteData = {
				id: noteId,
				name: `Remote [${paragraphId}]`,
				paragraphs: [conflict],
			};
			let remoteBytes = new TextEncoder().encode(JSON.stringify(remoteNote));
			let remoteUri = vscode.Uri.parse(
				`zeppelin-diff:/remote/${noteId}/${paragraphId}.zpln`
			);
			diffFsProvider.writeFile(remoteUri, remoteBytes);

			// Build a single-cell notebook for the local version
			let localParagraph = parseCellToParagraphData(cell);
			let localNote: NoteData = {
				id: noteId,
				name: `Local [${paragraphId}]`,
				paragraphs: [localParagraph],
			};
			let localBytes = new TextEncoder().encode(JSON.stringify(localNote));
			let localUri = vscode.Uri.parse(
				`zeppelin-diff:/local/${noteId}/${paragraphId}.zpln`
			);
			diffFsProvider.writeFile(localUri, localBytes);

			await vscode.commands.executeCommand(
				'vscode.diff',
				remoteUri,
				localUri,
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
		logger.info("onDidOpenNotebookDocument:", note);

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
				logger.debug("onDidChangeNotebookDocument: cellChange", cellChange);
				kernel.registerParagraphUpdate(cellChange.cell);
				kernel.autoDetectCellLanguage(cellChange.cell).catch(err =>
					logger.warn("autoDetectCellLanguage error", err)
				);
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
					logger.debug("onDidChangeNotebookDocument: cellReplaced", cellAdded);
					kernel.updateParagraph(cellAdded);
				}
				else {
					// normal add/remove cell registeration
					if (cellAdded !== undefined) {
						logger.debug("onDidChangeNotebookDocument: cellAdded", cellAdded.index);
						// update right away,
						// otherwise more added cell contaminate the indices
						kernel.updateParagraph(cellAdded);
					}
					if (cellRemoved !== undefined) {
						logger.debug("onDidChangeNotebookDocument: cellRemoved", cellRemoved);
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
		if (!isLocalNotebookCell(event.textEditor.document.uri)
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
						"completionSupport": cell.kind !== vscode.NotebookCellKind.Markup
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
		logger.info("onDidChangeActiveNotebookEditor", event);

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
	logger.info("deactivate");
}