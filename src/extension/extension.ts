// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { NotebookService } from '../common/api';
import { showQuickPickURL } from '../common/common';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinServerURL',
		showQuickPickURL
	);

	context.subscriptions.push(disposable);

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer('zeppelin-notebook', new ZeppelinSerializer())
	);

	let baseURL: string | undefined = context.workspaceState.get('currentZeppelinServerURL');
	if (baseURL === undefined) {
		showQuickPickURL(context);
		// baseURL is supposed not to be null or undefined by now
		baseURL = context.workspaceState.get('currentZeppelinServerURL') ?? '';
	}

	let kernel = new ZeppelinKernel(context);
	let interactiveKernel = new ZeppelinKernel(context, true);

	// baseURL is '' when user choose not to connect to Zeppelin server
	if (baseURL === '') {
		kernel.deactive();
		interactiveKernel.deactive();
	}
	else {
		let service = new NotebookService(baseURL);
		kernel.setService(service);
		interactiveKernel.setService(service);
	}

	context.subscriptions.push(kernel);
	
	context.subscriptions.push(interactiveKernel);

}

// This method is called when your extension is deactivated
export function deactivate() { }
