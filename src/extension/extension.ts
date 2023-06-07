// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { NotebookService } from '../common/api';
import { showQuickPickURL, doLogin } from '../common/common';
import { ZeppelinSerializer } from './notebookSerializer';
import { ZeppelinKernel } from './notebookKernel';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand(
		'zeppelin-vscode.setZeppelinServerURL',
		_ => ( showQuickPickURL(context) )
	);

	context.subscriptions.push(disposable);

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer('zeppelin-notebook', new ZeppelinSerializer())
	);

	let kernel = new ZeppelinKernel(context);
	let baseURL: string | undefined = context.workspaceState.get('currentZeppelinServerURL');
	if (baseURL === undefined) {
		showQuickPickURL(context);
		// baseURL is supposed not to be null or undefined by now
		baseURL = context.workspaceState.get('currentZeppelinServerURL');
		if (!baseURL) {
			return undefined;
		}
	}

	let service = new NotebookService(baseURL);
	let isSuccess = await doLogin(context, service);
	if (isSuccess) {
		kernel.setService(service);
		kernel.activate();
	}
	else {
		kernel.deactivate();
	}

	context.subscriptions.push(kernel);
}

// This method is called when your extension is deactivated
export function deactivate() { }
