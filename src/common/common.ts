import { ExtensionContext, window } from 'vscode';


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
		title: 'Specify the URL of the Existing Zeppelin Server',
		placeHolder: 'e.g, http://127.0.0.1:8080',
		validateInput: text => {
			let re = RegExp(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi);
			if (text.match(re)){
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
		title: 'Change Zeppelin Server Display Name (Leave Blank To Use URL)',
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
			return;
		}

		if (picked.label === `$(server-environment)Existing`) {
			let pickedPair = await showInputURL().catch(logDebug);
			if (!pickedPair) {
				return;
			}

			pickedURL = pickedPair.url;
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
				return;
			}

			pickedURL = picked.description;
			urlHistory = urlHistory.filter(pair => pair.url !== pickedURL);
			urlHistory.unshift({
				label: picked.label,
				url: picked.description ?? '',
				lastConnect: (new Date()).toString()
			});
		}
		context.workspaceState.update('currentZeppelinServerURL', pickedURL);
		context.globalState.update('urlHistory', urlHistory);
		context.globalState.setKeysForSync(['urlHistory']);
	});

	quickPick.onDidHide(() => quickPick.dispose());
	quickPick.show();
}