import * as vscode from 'vscode';
import { logDebug } from '../common/common';
import {
	parseParagraphToCellData,
	parseCellToParagraphData
} from '../common/parser';
import { NoteData } from '../common/dataStructure';


export class ZeppelinSerializer implements vscode.NotebookSerializer {

	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<vscode.NotebookData> {

		var contents = new TextDecoder().decode(content);
		let reEmpty = new RegExp('^[\s\n\t\r]*$');
		if (reEmpty.test(contents)) {
			logDebug(contents);
		}

		let raw: NoteData | undefined;
		try {
			raw = <NoteData>JSON.parse(contents);
		} catch(err) {
			logDebug("error serializing note to JSON", err);
			throw err;
		}

		const cells = raw.paragraphs.map(parseParagraphToCellData);

		let note = new vscode.NotebookData(cells);
		note.metadata = raw;

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
