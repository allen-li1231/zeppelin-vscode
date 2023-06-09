import { reURL, logDebug } from './common';
import { ExtensionContext, window } from 'vscode';
import { NotebookService } from './api';


// function that calls quick-input box
// for users to provide Zeppelin server URL and display name
export async function showInputURL() {
	// get url from input box
	const url = await window.showInputBox({
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
	const label = await window.showInputBox({
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
export async function showQuickPickURL(context: ExtensionContext) {
	let urlHistory: { [key: string]: string }[] = context.globalState.get('urlHistory') ?? [];
	let pickUrlItems = urlHistory.map(pair => ({ 
		label: pair.label,
		description: pair.url,
		detail: 'Last Connection: ' + pair.lastConnect
	}));

	const quickPick = window.createQuickPick();
	quickPick.placeholder = 'Pick How To Connect to Zeppelin';
	quickPick.items = [

		// option 1: None, ZeppelinKernel will become silent and notes won't run code in cell.
		{
			label: `$(close)None`,
			detail: 'Do not connect to any remote Zeppelin server'
		},
		// option 2: Existing, this will prompt user to provide server URL and display name.
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

		let pickedURL: string;

		if (picked.label === `$(close)None`) {
			pickedURL = '';
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
			pickedURL = picked.description;
			urlHistory = urlHistory.filter(pair => pair.url !== pickedURL);
			urlHistory.unshift({
				label: picked.label,
				url: picked.description,
				lastConnect: (new Date()).toString()
			});
		}
		quickPick.hide();

		// save current URL to workspace.
		context.workspaceState.update('currentZeppelinServerURL', pickedURL);
		// save URL history across workspaces.
		context.globalState.update('urlHistory', urlHistory);
		context.globalState.setKeysForSync(['urlHistory']);
	});

	quickPick.onDidHide(() => quickPick.dispose());

	logDebug("showing quick-pick URLs");
	quickPick.show();
}


// function that prompts user to provide Zeppelin credentials
export async function showQuickPickLogin(context: ExtensionContext) {
	const username = await window.showInputBox({
		title: '(1/2) Specify User Name to connect to Zeppelin server'
	});
	if (username === undefined) {
		return false;
	}

	const password = await window.showInputBox({
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
	context: ExtensionContext,
	service: NotebookService
	): Promise<boolean> {

	let username = await context.secrets.get('zeppelinUsername');
	let isSuccess;
	// prompt user to provide Zeppelin credential
	// if he/she hasn't provided one under current workspace
	// currently only store one credential for each workspace
	if (username === undefined) {
		// user name could be '' if remote server doesn't require credential to access to
		let hasCredential = await showQuickPickLogin(context);
		if (!hasCredential) {
			return false;
		}

		username = await context.secrets.get('zeppelinUsername');
		let password = await context.secrets.get('zeppelinPassword') ?? '';

		isSuccess = await service.login(username ?? '', password ?? '');
	}
	else {
		// try to login using cached credential
		let password = await context.secrets.get('zeppelinPassword') ?? '';
		isSuccess = await service.login(username, password ?? '');
	}

	return isSuccess;
}