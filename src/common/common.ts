import { AxiosError } from 'axios';
import { ExtensionContext, window } from 'vscode';
import { NotebookService } from './api';


export const DEBUG_MODE = true;

export const NAME = 'zeppelin-notebook';
// export const MIME_TYPE = 'x-application/zeppelin-notebook';

export let mapLanguageKind = new Map<string, number>();
mapLanguageKind.set("markdown", 1);
mapLanguageKind.set("python", 2);
mapLanguageKind.set("scala", 2);
mapLanguageKind.set("r", 2);
mapLanguageKind.set("sql", 2);


export function formatURL(url: string): string {
    if(!url.startsWith('http')) {
        return `http://${url}`;
    } 
    return url;
}


export function logDebug(item: string | any, ...optionalParams: any[]) {
    if (DEBUG_MODE) {
        console.log(item, optionalParams);
    }
}


export async function showInputURL() {
	// get url from input box
	const url = await window.showInputBox({
		value: '',
		title: '(1/2) Specify the URL of the Existing Zeppelin Server',
		placeHolder: 'e.g, http://127.0.0.1:8080',
		validateInput: text => {
			let re = RegExp(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi);
			if (text.match(re)) {
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

	// create dict and save result
	const result = {
		label: label || url,
		url,
		lastConnect: (new Date()).toString()
	};

	return result;
}

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
		{
			label: `$(close)None`,
			detail: 'Do not connect to any remote Zeppelin server'
		},
		{
			label: `$(server-environment)Existing`,
			detail: 'Specify the URL of an existing server'
		},
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

		context.workspaceState.update('currentZeppelinServerURL', pickedURL);
		context.globalState.update('urlHistory', urlHistory);
		context.globalState.setKeysForSync(['urlHistory']);
	});

	quickPick.onDidHide(() => quickPick.dispose());
	logDebug("showing quick-pick URL");
	quickPick.show();
}


export async function showQuickPickLogin(context: ExtensionContext) {
	const username = await window.showInputBox({
		title: '(1/2) Specify User Name to connect to Zeppelin server'
	});
	if (!username) {
		return false;
	}

	const password = await window.showInputBox({
		title: `(2/2) Specify ${username}'s Password`,
		password: true
	});
	if (!password) {
		return false;
	}

	context.secrets.store('zeppelinUsername', username);
	context.secrets.store('zeppelinPassword', password);

	return true;
}

export async function doLogin(
	context: ExtensionContext,
	service: NotebookService
	): Promise<boolean> {

	let username = await context.secrets.get('zeppelinUsername');
	// prompt user to provide Zeppelin credential
	if (!username) {
		let hasCredential = await showQuickPickLogin(context);
		if (!hasCredential) {
			return false;
		}

		username = await context.secrets.get('zeppelinUsername');
		let password = await context.secrets.get('zeppelinPassword') ?? '';
		let res = await service.login(username ?? '', password ?? '');
		logDebug(`login response for ${username} using credential provided`, res);
	}
	else {
		// try to login using cached credential
		let password = await context.secrets.get('zeppelinPassword') ?? '';
		let res = await service.login(username ?? '', password ?? '');
		logDebug(`login response for ${username} using cached credential`, res);

		if (res instanceof AxiosError) {
			if (res.code === 'ECONNREFUSED') {
				window.showErrorMessage("failed to login to Zeppelin server, please check network availability.");
			}
			else {
				window.showErrorMessage("failed to login to Zeppelin server, please check remote server availability, username and password.");
			}
			return false;
		}
	}

	return true;
}