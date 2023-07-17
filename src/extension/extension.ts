// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as interact from '../common/interaction';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { NOTEBOOK_SUFFIX } from '../common/common';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinServerURL',
		interact.showQuickPickURL, context
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinCredential',
		interact.showQuickPickLogin, context
	);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.unlockCurrentNotebook',
		interact.promptUnlockCurrentNotebook, context
	);
	context.subscriptions.push(disposable);


	let kernel = new ZeppelinKernel(context);
	context.subscriptions.push(kernel);


	disposable = vscode.workspace.registerNotebookSerializer(
		'zeppelin-notebook', new ZeppelinSerializer()
	);
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidCreateFiles(event => {
		let fs = require("fs");

		for (let uri of event.files) {
			if (uri.fsPath.endsWith(NOTEBOOK_SUFFIX)) {
				fs.writeFileSync(uri.fsPath,  '{"paragraphs": []}');
			}
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidOpenNotebookDocument(async note => {

		// lock file before kernel is able to connected to server
		vscode.commands.executeCommand(
			"workbench.action.files.setActiveEditorReadonlyInSession"
		);

		// fastforward could be undefined (user never determined),
		// Yes, No or Never (user specified)
		let fastforward = context.workspaceState.get('alwaysConnectSameServer');
		if (fastforward === 'Never') {
			return;
		}

		let willConnectRemote = fastforward !== 'No';

		if (fastforward !== 'Yes') {
			// ask user to connect
			willConnectRemote = await interact.promptRemoteConnection();
		}

		// task after notebook is created or remote server is on.
		let unlockNote = () => {
			// unlock file
			vscode.commands.executeCommand(
				"workbench.action.files.setActiveEditorWriteableInSession"
			);
			if (fastforward === undefined) {
				// ask if connect automatically from now on.
				interact.promptAlwaysConnect(context);
			}
		};

		// task when remote server is connect but the note is not on it.
		if (willConnectRemote && await kernel.checkInService()) {
			if (await kernel.hasNote(note.metadata.id)) {
				unlockNote();
			}
			else {
				// import/create identical note when there doesn't exist one.
				interact.promptCreateNotebook(kernel, note, unlockNote);
			}
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onDidChangeNotebookDocument(event => {
		if (!kernel.isActive()) {
			return;
		}

		// add or modify paragraph on remote
		for (let cellChange of event.cellChanges) {
			if (cellChange.document !== undefined) {
				kernel.registerParagraphUpdate(cellChange.cell);
			}
		}

		// remove paragraph on remote
		for (let contentChange of event.contentChanges) {
			for (let cell of contentChange.removedCells) {
				kernel.registerParagraphUpdate(cell);
			}
		}
	});
	context.subscriptions.push(disposable);


	disposable = vscode.workspace.onWillSaveNotebookDocument(event => {
		if (event.notebook.isDirty) {
			kernel.instantUpdatePollingParagraphs();
		}
	});
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
