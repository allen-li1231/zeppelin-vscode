// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {
	showQuickPickURL,
	showQuickPickLogin,
	promptRemoteConnection,
	promptAlwaysConnect
} from '../common/interaction';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';
import { serialize } from 'v8';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinServerURL',
		showQuickPickURL, context
	);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinCredential',
		showQuickPickLogin, context
	);
	context.subscriptions.push(disposable);

	let kernel = new ZeppelinKernel(context);
	context.subscriptions.push(kernel);

	disposable = vscode.workspace.registerNotebookSerializer(
		'zeppelin-notebook', new ZeppelinSerializer()
	);
	context.subscriptions.push(disposable);

	disposable = vscode.workspace.onDidOpenNotebookDocument( async _ => {
		vscode.commands.executeCommand(
			"workbench.action.files.setActiveEditorReadonlyInSession"
		);

		let alwaysConnect = context.workspaceState.get('alwaysConnectZeppelinServer');
		if (!alwaysConnect) {
			let selection = await promptRemoteConnection();
			if (selection && await kernel.checkInService()) {
				vscode.commands.executeCommand(
					"workbench.action.files.setActiveEditorWriteableInSession"
				);
				promptAlwaysConnect(context);
			}
		}
		else if (await kernel.checkInService()) {
			vscode.commands.executeCommand(
				"workbench.action.files.setActiveEditorWriteableInSession"
			);
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
