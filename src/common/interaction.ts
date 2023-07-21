import { AxiosError } from 'axios';
import { NotebookService } from './api';
import { reURL, logDebug } from './common';
import * as vscode from 'vscode';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { parseCellToParagraphData } from './parser';


// function that calls quick-input box
// for users to provide Zeppelin server URL and display name
export async function showInputURL() {
	// get url from input box
	const url = await vscode.window.showInputBox({
		value: '',
		title: '(1/2) Specify the URL of the Existing Zeppelin Server',
		placeHolder: 'e.g, http://127.0.0.1:8080',
		validateInput: text => {
			if (text.match(reURL)) {
				return null;
			}
			return 'incorrect url format';
		},
	});
	if (!url) {
		return undefined;
	}

	// get url display label from input box
	const label = await vscode.window.showInputBox({
		title: '(2/2) Change Zeppelin Server Display Name (Leave Blank To Use URL)',
	});
	if (label === undefined) {
		return undefined;
	}
	logDebug(`received server name: ${label}`);

	// create dict and return as result
	const result = {
		label: label || url,
		url,
		lastConnect: (new Date()).toString()
	};

	return result;
}


// function that gives user a set of options to choose Zeppelin URLs,
// URLs and the respective display names will be shared across workspaces.
export async function showQuickPickURL(
	context: vscode.ExtensionContext,
	onDidHide?: Function
) {
	let urlHistory: { [key: string]: string }[]
		= context.globalState.get('urlHistory') ?? [];
	let pickUrlItems = urlHistory.map(pair => ({ 
		label: pair.label,
		description: pair.url,
		detail: 'Last Connection: ' + pair.lastConnect
	}));

	const quickPick = vscode.window.createQuickPick();
	quickPick.placeholder = 'Pick How To Connect to Zeppelin';
	quickPick.items = [

		// option 1: None, ZeppelinKernel will become silent
		// and notes won't run code in cell.
		{
			label: `$(close)None`,
			detail: 'Do not connect to any remote Zeppelin server'
		},
		// option 2: Existing, prompt user to provide server URL and name.
		// if the URL provided exists in URL history
		{
			label: `$(server-environment)Existing`,
			detail: 'Specify the URL of an existing server'
		},
		// option 3: choose from URL history.
		...pickUrlItems
	];
	quickPick.onDidChangeSelection(async selection => {
		let picked = selection[0];
		if (!picked) {
			return;
		}

		let pickedLabel: string;
		let pickedURL: string;

		if (picked.label === `$(close)None`) {
			pickedLabel = '';
			pickedURL = '';
			context.workspaceState.update('currentZeppelinServerLabel', pickedLabel);
			context.workspaceState.update('currentZeppelinServerURL', pickedURL);
			quickPick.hide();
			return;
		}

		if (picked.label === `$(server-environment)Existing`) {
			let pickedPair = await showInputURL().catch(logDebug);
			if (!pickedPair) {
				// user aborted, pass
				quickPick.hide();
				return;
			}

			pickedLabel = pickedPair.label;
			pickedURL = pickedPair.url;
			// url history is sorted by most recent usage
			// put picked url to the front of url history list
			urlHistory = urlHistory.filter(pair => pair.url !== pickedPair?.url);
			urlHistory.unshift({
				label: pickedPair?.label,
				url: pickedPair.url,
				lastConnect: (new Date()).toString()
			});
		}
		else {
			if (!picked.description) {
				logDebug('got unexpected empty url from pickItem.description');
				quickPick.hide();
				return;
			}

			logDebug("URL picked from history", picked);
			pickedLabel = picked.label;
			pickedURL = picked.description;
			urlHistory = urlHistory.filter(pair => pair.url !== pickedURL);
			urlHistory.unshift({
				label: picked.label,
				url: picked.description,
				lastConnect: (new Date()).toString()
			});
		}

		// save current URL to workspace.
		context.workspaceState.update('currentZeppelinServerLabel', pickedLabel);
		context.workspaceState.update('currentZeppelinServerURL', pickedURL);
		// save URL history across workspaces.
		context.globalState.update('urlHistory', urlHistory);
		context.globalState.setKeysForSync(['urlHistory']);
		quickPick.hide();
	});

	quickPick.onDidHide( _=> {
		if (onDidHide !== undefined) {
			onDidHide();
		}
		quickPick.dispose();
	});

	logDebug("showing quick-pick URLs", quickPick);
	quickPick.show();
}


// function that prompts user to provide Zeppelin credentials
export async function showQuickPickLogin(context: vscode.ExtensionContext) {
	const username = await vscode.window.showInputBox({
		title: '(1/2) Specify User Name to connect to Zeppelin server'
	});
	if (username === undefined) {
		return false;
	}

	const password = await vscode.window.showInputBox({
		title: `(2/2) Specify ${username}'s Password`,
		password: true
	});
	if (password === undefined) {
		return false;
	}

	context.secrets.store('zeppelinUsername', username);
	context.secrets.store('zeppelinPassword', password);

	return true;
}


// function that checks Zeppelin credential.
// if credential exists, will call login API subsequently.
export async function doLogin(
	context: vscode.ExtensionContext,
	service: NotebookService,
	retrying: boolean = false
	): Promise<boolean> {

	let username = await context.secrets.get('zeppelinUsername');
	let res;
	// prompt user to provide Zeppelin credential
	// if he/she hasn't provided one under current workspace
	// currently only store one credential for each workspace
	if (username === undefined || retrying) {
		// user name could be '' 
		// if remote server doesn't require credential
		let hasCredential = await showQuickPickLogin(context);
		if (!hasCredential) {
			return false;
		}

		username = await context.secrets.get('zeppelinUsername');
		let password = await context.secrets.get('zeppelinPassword') ?? '';

		res = await service.login(username ?? '', password ?? '');
	}
	else {
		// try to login using cached credential
		let password = await context.secrets.get('zeppelinPassword') ?? '';
		res = await service.login(username, password ?? '');
	}

	if (res instanceof AxiosError) {
		if (!res.response) {
			// local network issue
			vscode.window.showErrorMessage(`${res.code}: ${res.message}`);
		}
		else if (res.response.status === 403) {
			if (res.response.data.status === 'FORBIDDEN') {
				// wrong username or password
				const selection = await vscode.window.showErrorMessage(
					'Wrong username or password', "Retype", "Cancel"
				);
				if ( selection === 'Retype' ) {
					return await doLogin(context, service, true);
				}
			}
			else {
				vscode.window.showErrorMessage(res.response.data);
			}
		}
		// test if server has configured shiro for multi-users,
		// server will respond 'UnavailableSecurityManagerException' if not.
		else if (res.response.data.exception 
				=== 'UnavailableSecurityManagerException'
			) {
				vscode.window.showInformationMessage(`Zeppelin login API:
			remote server has no credential authorization manager configured.
			Please contact server administrator if this is unexpected.`);
			return true;
		}
		else {
			// server side error or client side error
			vscode.window.showErrorMessage(
				`${res.response.data.exception}: ${res.response.data.message}`
			);
		}
		return false;
	}

	return true;
}


// function that prompts user to connect to remote Zeppelin server
export async function promptRemoteConnection() {
	let selection = await vscode.window.showInformationMessage(
		`Notebook under current workspace is read-only 
		as it is not connected to Zeppelin server,
		do you want to connect to server?`,
		"Yes", "No"
	);

	return selection === 'Yes';
}


// function that prompts user to always connect to server under current workspace
export async function promptAlwaysConnect() {
	let selection = await vscode.window.showInformationMessage(
		`Always connect to the same server for notebooks under current workspace?`,
		"Yes", "No", "Never"
	);
	let config = vscode.workspace.getConfiguration('zeppelin');
	config.update('alwaysConnectLastServer', selection);
	return selection;
}


// function that prompts user to create new notebook on server
// based on notebook provided
export async function promptCreateNotebook(
	kernel: ZeppelinKernel,
	note: vscode.NotebookDocument | undefined,
	onCreateSuccess?: Function
) {
	if (!kernel.isActive() || note === undefined) {
		return false;
	}

	// take name in metadata, or note path base name as name of note
	let name = note.metadata.name ?? note.uri.path.split('/').pop();

	let visibleNotes = await kernel.listNotes();

	let visiblePaths: string[];
	try {
		visiblePaths = visibleNotes.map(
			(info: {[key: string]: string}) => {
				// before Zeppelin 10.0, path of note
            	// is stored in 'name' key instead of 'path'
				let path = info.path ?? info.name;
				// take base directory of notes
				return path.startsWith('/~Trash')
					? '/'
					: path.substring(0, path.lastIndexOf('/') + 1);
			}
		);

		// remove duplicated paths and sort the rests
		visiblePaths = [...new Set(visiblePaths)].sort();
	} catch (err) {
		logDebug(err);
		return false;
	}

	const quickPick = vscode.window.createQuickPick();
	// remove suffix
	quickPick.value = name.replace(/\.[^/.]+$/, '');
	quickPick.title = `Specify Path to Save the
		 New Notebook "${name}" on Zeppelin Server`;
	quickPick.items = visiblePaths.map(value => { return { label: value }; });

	quickPick.onDidAccept( async _ => {
		let newNotebookPath = quickPick.value;
		if (!!newNotebookPath){
			let noteId: string;

			try {
				if (note.metadata.id === undefined) {
					let paragraphs = note.getCells().map(parseCellToParagraphData);
					noteId = await kernel.createNote(newNotebookPath, paragraphs);
				}
				else {
					noteId = await kernel.importNote(note.metadata);
				}
			}
			catch (err) {
				logDebug("error create/import note", err);
				quickPick.hide();
				return;
			}

			if (onCreateSuccess !== undefined) {
				onCreateSuccess();
			}

			kernel.updateNoteMetadata(note, { id: noteId });
		}

		quickPick.hide();
	});

	quickPick.onDidChangeSelection(selection => {
		let picked = selection[0];
		if (!picked) {
			return;
		}

		quickPick.value = picked.label + name;
	});

	quickPick.onDidHide(quickPick.dispose);

	logDebug("showing quick-pick remote paths", quickPick);
	quickPick.show();

	return true;
}


// task after notebook is created or remote server is on.
function unlockActiveEditor() {
	// unlock file
	vscode.commands.executeCommand(
		"workbench.action.files.setActiveEditorWriteableInSession"
	);

	promptAlwaysConnect();
};


export async function promptUnlockCurrentNotebook(kernel: ZeppelinKernel) {
	let note = vscode.window.activeNotebookEditor?.notebook;
	if (note === undefined) {
		return;
	}

	// task when remote server is connectable.
	kernel.checkInService(async () => {
		if (await kernel.hasNote(note?.metadata.id)) {
			unlockActiveEditor();
		}
		else {
			// import/create identical note when there doesn't exist one.
			promptCreateNotebook(kernel, note, unlockActiveEditor);
		}
	});
}