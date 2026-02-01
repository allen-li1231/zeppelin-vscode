import { AxiosError } from 'axios';
import { NotebookService } from './api';
import { reURL, logDebug, getRestartInterpreterId } from './common';
import * as vscode from 'vscode';
import { ZeppelinKernel } from '../extension/notebookKernel';
import { parseCellToParagraphData } from './parser';
import { Mutex } from '../component/mutex';

let mutex = new Mutex();

// function that calls quick-input box
// for users to provide Zeppelin server URL and display name
export async function showInputURL() {
	// get url from input box
	const url = await vscode.window.showInputBox({
		value: '',
		title: '(1/2) Specify the URL of the Existing Zeppelin Server',
		placeHolder: 'e.g, http://127.0.0.1:8080',
		prompt: '',
		ignoreFocusOut: true,
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
		prompt: '',
		ignoreFocusOut: true,
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
		detail: 'Last Connection: ' + pair.lastConnect,
		buttons: [{iconPath: new vscode.ThemeIcon('trash')}]
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
			context.workspaceState.update('currentZeppelinServerName', undefined);
			context.workspaceState.update('currentZeppelinServerURL', '');
			quickPick.hide();
			return;
		}

		if (picked.label === `$(server-environment)Existing`) {
			context.workspaceState.update('currentZeppelinServerName', undefined);
			context.workspaceState.update('currentZeppelinServerURL', '');
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
				lastConnect: (new Date()).toString(),
				connectable: "false"
			});
		}

		// save current URL to workspace.
		context.workspaceState.update('currentZeppelinServerName', pickedLabel);
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

	quickPick.onDidTriggerItemButton(e => {
		let idx = urlHistory.findIndex(pair => pair.label === e.item.label);
		urlHistory.splice(idx, 1);

		if (context.workspaceState.get('currentZeppelinServerName') === e.item.label) {
			context.workspaceState.update('currentZeppelinServerName', undefined);
			context.workspaceState.update('currentZeppelinServerURL', '');
		}
		// save URL history across workspaces.
		context.globalState.update('urlHistory', urlHistory);
		context.globalState.setKeysForSync(['urlHistory']);

		let pickUrlItems = urlHistory.map(pair => ({ 
			label: pair.label,
			description: pair.url,
			detail: 'Last Connection: ' + pair.lastConnect,
			buttons: [{iconPath: new vscode.ThemeIcon('trash')}]
		}));
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
		});

	logDebug("showing quick-pick URLs", quickPick);
	quickPick.show();
}


// function that prompts user to provide Zeppelin credentials
export async function showQuickPickLogin(context: vscode.ExtensionContext) {
	const username = await vscode.window.showInputBox({
		title: '(1/2) Specify User Name to connect to Zeppelin server',
		prompt: '',
		ignoreFocusOut: true
	});
	if (username === undefined) {
		return false;
	}

	const password = await vscode.window.showInputBox({
		title: `(2/2) Specify ${username}'s Password`,
		prompt: '',
		password: true,
		ignoreFocusOut: true
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
			vscode.window.showErrorMessage(`Failed to login for user '${username}'`);
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
		// test if server has configured Shiro for multi-users,
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
			vscode.window.showErrorMessage(`Failed to login for user '${username}'`);
		}
		return false;
	}

	return true;
}


// function that prompts user to connect to remote Zeppelin server
export async function promptRemoteConnection() {
	return mutex.runExclusive(async () => {
	let selection = await vscode.window.showInformationMessage(
		`Notebook under current workspace is not connected to 
		any Zeppelin server, do you want to connect to server?`,
		"Yes", "No"
	);

	return selection === 'Yes';
	});
}


// function that prompts user to always connect to server under current workspace
export async function promptAlwaysConnect() {
	return mutex.runExclusive(async () => {
	let selection = await vscode.window.showInformationMessage(
		`Always connect to the same server for notebooks under current workspace?`,
		"Yes", "No", "Never"
	);
	let config = vscode.workspace.getConfiguration('zeppelin');
	config.update('alwaysConnectToTheLastServer', selection);
	return selection;
	});
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

	return mutex.runExclusive(async () => {
	// Use workspace-relative path as the default (like Zeppelin web UI)
	// This ensures the path is based on current directory
	var name = note.metadata.name ?? kernel.getWorkspaceRelativePath(note.uri);
	let baseName = name.split('/').pop();

	// First, check if notebook with this path already exists on server
	// If it does, connect to it instead of creating a new one
	let existingNote = await kernel.findNoteByPath(name);
	if (existingNote) {
		logDebug("Found existing notebook on server with same path", existingNote);
		
		// Connect to the existing notebook instead of creating new
		await kernel.updateNoteMetadata(note, { 
			id: existingNote.id,
			name: existingNote.path,
			path: existingNote.path
		});
		
		vscode.window.showInformationMessage(
			`Connected to existing notebook "${existingNote.path}" on server`
		);
		
		// Sync the notebook to get latest content from server
		kernel.syncNote(note);
		
		if (onCreateSuccess !== undefined) {
			onCreateSuccess();
		}
		
		return true;
	}

	let visibleNotes = await kernel.listNotes();

	let visiblePaths: string[];
	try {
		visiblePaths = visibleNotes.map(
			(info: {[key: string]: string}) => {
				// before Zeppelin 0.10.0, path of note
            	// is stored in 'name' key instead of 'path'
				let path = info.path ?? info.name;
				// take base directory of notes
				return path.startsWith('/~Trash')
					? '/'
					// remove first and last '/'
					: path.substring(1, path.lastIndexOf('/') + 1);
			}
		);

		// remove duplicated paths and sort the rests
		visiblePaths = [...new Set(visiblePaths)].sort();
	} catch (err) {
		logDebug("error in promptCreateNotebook", err);
		return false;
	}

	const disposables: vscode.Disposable[] = [];
	const quickPick = vscode.window.createQuickPick();
	// remove suffix
	quickPick.value = name;
	quickPick.title = `Specify path to save
		 new notebook "${baseName}" to Zeppelin server`;
	quickPick.ignoreFocusOut = true;
	quickPick.items = visiblePaths.map(value => { return { label: value }; });

	disposables.push(quickPick.onDidAccept( async _ => {
		if (quickPick.busy) {
			quickPick.busy = false;
			return;
		}

		let newNotebookPath = quickPick.value;
		if (!!newNotebookPath){
			// Normalize path: ensure it starts with '/'
			if (!newNotebookPath.startsWith('/')) {
				newNotebookPath = '/' + newNotebookPath;
			}

			// Check again if notebook with this path exists (user might have changed the path)
			let existingNoteForPath = await kernel.findNoteByPath(newNotebookPath);
			if (existingNoteForPath) {
				logDebug("Found existing notebook for specified path", existingNoteForPath);
				
				// Connect to the existing notebook instead of creating new
				await kernel.updateNoteMetadata(note, { 
					id: existingNoteForPath.id,
					name: existingNoteForPath.path,
					path: existingNoteForPath.path
				});
				
				vscode.window.showInformationMessage(
					`Connected to existing notebook "${existingNoteForPath.path}" on server`
				);
				
				// Sync the notebook to get latest content from server
				kernel.syncNote(note);
				
				if (onCreateSuccess !== undefined) {
					onCreateSuccess();
				}
				
				quickPick.hide();
				return;
			}

			let noteId: string;

			try {
				if (note.metadata.id === undefined) {
					let paragraphs = note.getCells().map(parseCellToParagraphData);
					
					// SAFETY CHECK: Warn if creating empty notebook
					if (paragraphs.length === 0) {
						const confirm = await vscode.window.showWarningMessage(
							`Local notebook is empty. Are you sure you want to create an empty notebook on the server?`,
							"Yes, Create Empty", "Cancel"
						);
						if (confirm !== "Yes, Create Empty") {
							quickPick.hide();
							return;
						}
					}
					
					noteId = await kernel.createNote(newNotebookPath, paragraphs);
				}
				else {
					await kernel.updateNoteMetadata(note, {name: newNotebookPath});
					noteId = await kernel.importNote(note.metadata);
				}
			}
			catch (err) {
				logDebug("error create/import note", err);
				quickPick.hide();
				return;
			}

			if (noteId) {
				if (onCreateSuccess !== undefined) {
					onCreateSuccess();
				}

				kernel.updateNoteMetadata(note, { id: noteId, name: newNotebookPath, path: newNotebookPath });
				
				vscode.window.showInformationMessage(
					`Created notebook "${newNotebookPath}" on server`
				);
			}
		}

		quickPick.hide();
	}));

	disposables.push(quickPick.onDidChangeSelection(selection => {
		let picked = selection[0];
		if (!picked) {
			return;
		}

		quickPick.value = picked.label + baseName;
		quickPick.busy = true;
	}));

	disposables.push(quickPick.onDidHide(() => {
		disposables.forEach(d => d.dispose());
		quickPick.dispose();
	}));

	logDebug("showing quick-pick remote paths", quickPick);
	quickPick.show();

	return true;
	});
}


// function that prompt user to provide zeppelin server URL, 
// will also ask for Zeppelin credential if last used credential is not valid
export async function promptZeppelinServerURL(
	kernel: ZeppelinKernel
	) {
	await showQuickPickURL(kernel.getContext(), async () => {
		let baseURL = kernel.getContext().workspaceState.get(
			'currentZeppelinServerURL', undefined
		);
		if (!baseURL) {
			return;
		}

		// task when remote server is connectable.
		kernel.checkInService(baseURL, async () => {
			let config = vscode.workspace.getConfiguration('zeppelin');
			let selection = config.get('alwaysConnectToTheLastServer');
			if (selection === null) {
				promptAlwaysConnect();
			}

			let note = vscode.window.activeNotebookEditor?.notebook;
			if (note === undefined) {
				return;
			}

			if (!await kernel.hasNote(note?.metadata.id)) {
				// import/create identical note when there doesn't exist one.
				promptCreateNotebook(kernel, note,
					selection === null
					? promptAlwaysConnect
					: undefined);
			}
		});
	});
}


export async function promptZeppelinCredential(kernel: ZeppelinKernel) {
	return mutex.runExclusive(async () => {
	let note = vscode.window.activeNotebookEditor?.notebook;
	let baseURL = kernel.getContext().workspaceState.get(
		'currentZeppelinServerURL', undefined
	);

	if (note === undefined) {
		kernel.deactivate();
		await kernel.getContext().secrets.delete('zeppelinUsername');
		await kernel.getContext().secrets.delete('zeppelinPassword');
		kernel.checkInService(baseURL);
		return;
	}

	// remove username and password so login procedure could be triggered
	await kernel.getContext().secrets.delete('zeppelinUsername');
	await kernel.getContext().secrets.delete('zeppelinPassword');

	// task when remote server is connectable.
	kernel.checkInService(baseURL, async () => {
		let config = vscode.workspace.getConfiguration('zeppelin');
		let selection = config.get('alwaysConnectToTheLastServer');
		if (selection === null) {
			promptAlwaysConnect();
		}
		if (await kernel.hasNote(note?.metadata.id)) {
			// import/create identical note when there doesn't exist one.
			promptCreateNotebook(kernel, note);
		}
	});
	});
}


// function that logs out from Zeppelin server
export async function promptZeppelinLogout(kernel: ZeppelinKernel) {
	return mutex.runExclusive(async () => {
		const selection = await vscode.window.showInformationMessage(
			'Are you sure you want to logout from Zeppelin server?',
			"Yes", "No"
		);
		
		if (selection !== 'Yes') {
			return;
		}

		// Clear stored credentials
		await kernel.getContext().secrets.delete('zeppelinUsername');
		await kernel.getContext().secrets.delete('zeppelinPassword');

		// Deactivate kernel (disconnect from server)
		kernel.deactivate();

		vscode.window.showInformationMessage(
			'Successfully logged out from Zeppelin server. Credentials have been cleared.'
		);
	});
}


// function that prompts user to create a missing paragraph
export async function promptCreateParagraph(
	kernel: ZeppelinKernel, cell: vscode.NotebookCell
) {
	if (typeof cell.metadata.status === "string") {
		return;
	}

	let selection = await vscode.window.showInformationMessage(
		`The remote paragraph of the cell ${cell.index} doesn't exist. 
Do you wish to create the paragraph?`,
		"Yes", "No"
	);

	if (selection === undefined || selection === "No") {
		return;
	}

	try {
		logDebug("promptCreateParagraph", cell);
		return await kernel.createParagraph(cell);
		// await kernel.updateByReplaceCell(cell);
	}
	catch (err) {
		logDebug("promptCreateParagraph abort");
		return;
	}
}


// function that prompts user to restart a interpreter
export async function promptRestartInterpreter(
	kernel: ZeppelinKernel, interpreterId: string | undefined
) {
	if (!kernel.isActive()) {
		return;
	}

	if (interpreterId === undefined) {
		interpreterId = await vscode.window.showInputBox({
			title: 'Please specify a interpreter:',
			prompt: '',
			ignoreFocusOut: true
		});
	}
	if (interpreterId === undefined || interpreterId.trim().length === 0) {
		return;
	}
	interpreterId = interpreterId.trim();
	let rootIdx = interpreterId.indexOf('.');
	interpreterId = rootIdx > 0 ? interpreterId.slice(0, rootIdx) : interpreterId;

	let selection = await vscode.window.showInformationMessage(
		`Please confirm to restart interpreter "${interpreterId}"`,
		"No", "Yes"
	);

	if (selection === undefined || selection === "No") {
		return;
	}
	// Zeppelin restart API uses group name (e.g. spark for pyspark)
	const restartId = getRestartInterpreterId(interpreterId);
	let res = await kernel.getService()?.restartInterpreter(restartId);
	if (res === undefined) {
		return;
	}
	if (res instanceof AxiosError) {
		if (!res.response) {
			// local network issue
			vscode.window.showErrorMessage(`Failed to restart interpreter "${interpreterId}"`);
		}
		else {
			vscode.window.showErrorMessage(`Failed to restart interpreter "${interpreterId}: ${res.response.data}"`);
		}
	}
	else if (res.status !== 200) {
		vscode.window.showWarningMessage(res.statusText);
	}
	else {
		vscode.window.showInformationMessage(`Interpreter "${interpreterId}" restarted.`);
	}
}


// function that prompts user to restart interpreter from the notebook toolbar
export async function promptRestartNotebookInterpreter(kernel: ZeppelinKernel) {
	if (!kernel.isActive()) {
		vscode.window.showWarningMessage('Not connected to any Zeppelin server');
		return;
	}

	const note = vscode.window.activeNotebookEditor?.notebook;
	if (!note || note.cellCount === 0) {
		vscode.window.showWarningMessage('No active notebook found');
		return;
	}

	// Extract interpreter IDs from cells in the notebook
	const interpreterIds = new Set<string>();
	for (let i = 0; i < note.cellCount; i++) {
		const cell = note.cellAt(i);
		if (cell.kind === vscode.NotebookCellKind.Code) {
			const text = cell.document.getText();
			// Match interpreter prefix like %spark_rajeswara-kaipa
			const match = text.match(/^[\s\n]*%([^\s\n]+)/);
			if (match && match[1]) {
				// Extract interpreter name without dot notation
				let interpreterId = match[1];
				let rootIdx = interpreterId.indexOf('.');
				interpreterId = rootIdx > 0 ? interpreterId.slice(0, rootIdx) : interpreterId;
				interpreterIds.add(interpreterId);
			}
		}
	}

	if (interpreterIds.size === 0) {
		const selection = await vscode.window.showInputBox({
			title: 'No interpreter found in cells. Please specify interpreter name:',
			placeHolder: 'e.g., spark_username',
			prompt: '',
			ignoreFocusOut: true
		});
		
		if (!selection || selection.trim().length === 0) {
			return;
		}
		interpreterIds.add(selection.trim());
	}

	// If multiple interpreters found, let user choose
	let selectedInterpreter: string;
	if (interpreterIds.size === 1) {
		selectedInterpreter = Array.from(interpreterIds)[0];
	} else {
		const selection = await vscode.window.showQuickPick(
			Array.from(interpreterIds),
			{
				title: 'Select interpreter to restart',
				placeHolder: 'Choose an interpreter'
			}
		);
		
		if (!selection) {
			return;
		}
		selectedInterpreter = selection;
	}

	// Confirm restart
	const confirmation = await vscode.window.showInformationMessage(
		`Restart interpreter "${selectedInterpreter}"?`,
		"Yes", "No"
	);

	if (confirmation !== "Yes") {
		return;
	}

	// Zeppelin restart API uses group name (e.g. spark for pyspark)
	const restartId = getRestartInterpreterId(selectedInterpreter);
	const res = await kernel.getService()?.restartInterpreter(restartId);
	if (res === undefined) {
		return;
	}
	if (res instanceof AxiosError) {
		if (!res.response) {
			vscode.window.showErrorMessage(`Failed to restart interpreter "${selectedInterpreter}"`);
		} else {
			vscode.window.showErrorMessage(`Failed to restart interpreter "${selectedInterpreter}": ${res.response.data}`);
		}
	} else if (res.status !== 200) {
		vscode.window.showWarningMessage(res.statusText);
	} else {
		vscode.window.showInformationMessage(`Interpreter "${selectedInterpreter}" restarted successfully.`);
	}
}