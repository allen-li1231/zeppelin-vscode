import * as vscode from 'vscode';
import { logger } from '../common/logger';
import {
	parseParagraphToCellData,
	parseCellToParagraphData
} from '../common/parser';
import { NotebookReloadObserver, RELOAD_GENERATION } from '../common/notebookReload';
import { NoteData } from '../common/types';
// import { Mutex } from '../common/mutex';


export class ZeppelinSerializer implements vscode.NotebookSerializer {
	constructor(private readonly reloadObserver?: NotebookReloadObserver) {}

	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<vscode.NotebookData> {

		let raw: NoteData;

		var contents = new TextDecoder().decode(content);
		let reEmpty = /^\s*$/;
		if (reEmpty.test(contents)) {
			logger.debug(contents);
			raw = {};
		}
		else {
			try {
				raw = <NoteData>JSON.parse(contents);
			} catch(err) {
				logger.error("error serializing note file to JSON", err);
				throw err;
			}
		}
		// raw.mutex = new Mutex();

		const cells = raw.paragraphs
						? raw.paragraphs.map(parseParagraphToCellData)
						: [];
		logger.info(`deserializeNotebook: loaded ${cells.length} cells from note '${raw.name ?? '(unnamed)'}'`);

		let note = new vscode.NotebookData(cells);
        note.metadata = { ...raw };
        // Signal only after successful parsing. The model reset happens after
        // this promise resolves; its metadata carries this exact generation.
        if (this.reloadObserver) {
            note.metadata[RELOAD_GENERATION] = this.reloadObserver.markNotebookReload(_token);
        }

		return note;
	}

	async serializeNotebook(
		data: vscode.NotebookData,
		_token: vscode.CancellationToken
	): Promise<Uint8Array> {
	// function to take output renderer data to a format to save to the file

		// transform vscode notebook cells into Zeppelin paragraphs
		let paragraphs = data.cells.map(parseCellToParagraphData);
		// build Zeppelin note data
		let noteData: NoteData = {
			id: data.metadata?.id,
			name: data.metadata?.name,
			paragraphs: paragraphs,
			info: data.metadata?.info,
			noteForms: data.metadata?.noteForms,
			noteParams: data.metadata?.noteParams,
			angularObjects: data.metadata?.angularObjects
		};
		return new TextEncoder().encode(JSON.stringify(noteData));
	}
}

// NEEDED Declaration to silence errors
declare class TextDecoder {
	decode(data: Uint8Array): string;
}

declare class TextEncoder {
	encode(data: string): Uint8Array;
}
