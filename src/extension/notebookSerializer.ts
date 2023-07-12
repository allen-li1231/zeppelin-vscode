import * as vscode from 'vscode';
import { logDebug, mapLanguageKind } from '../common/common';
import {
	NoteData,
	ParagraphData,
	ParagraphResult,
	ParagraphResultMsg
} from '../common/dataStructure';


export class ZeppelinSerializer implements vscode.NotebookSerializer {

	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<vscode.NotebookData> {

		function parseParagraphToCellData(
			paragraph: ParagraphData,
		): vscode.NotebookCellData {
			let lang: string = paragraph.config.editorSetting.language;
			// default cell kind is markup language
			let kind: number = mapLanguageKind.get(lang) ?? 1;
			// empty cell could have no text method, while NotebookCellData must have text value,
			// thus we give it an empty string.
			let text = paragraph.text ?? '';

			let cell = new vscode.NotebookCellData(kind, text, lang);
			if (paragraph.results) {
				let cellOutputs = parseParagraphResultToCellOutput(paragraph.results);
				cell.outputs = [new vscode.NotebookCellOutput(cellOutputs)];
			}
			// insert notebook id into metadata so we can get sufficient information to call api
			cell.metadata = <ParagraphData> paragraph;

			return cell;
		}

		function parseParagraphResultToCellOutput(results: ParagraphResult) {
			let outputs: vscode.NotebookCellOutputItem[] = [];

			let encoder = new TextEncoder();
			let textOutput = '', htmlOutput = '', errorOutput = '';
			let imageOutputs: Uint8Array[] = [];
			for (let msg of results['msg']) {
				if (msg['type'] === 'HTML') {
					textOutput += msg.data;
				}
				else if (msg['type'] === 'IMG') {
					let data = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
					imageOutputs.push(data);
				}
				else if (results.code === 'ERROR') {
					errorOutput += msg.data;
				}
				else {
					textOutput += msg.data;
				}
			}

			if (textOutput.length > 0) {
				outputs.push(
					new vscode.NotebookCellOutputItem(
						encoder.encode(textOutput),
						'text/plain'
					)
				);
			}
			if (htmlOutput.length > 0) {
				outputs.push(
					new vscode.NotebookCellOutputItem(
						encoder.encode(htmlOutput),
						'text/html'
					)
				);
			}
			if (errorOutput.length > 0) {
				outputs.push(
					vscode.NotebookCellOutputItem.error({ 
						name: 'error',
						message: errorOutput})
				);
			}
			if (imageOutputs.length > 0) {
				let allArrayLength = imageOutputs.map((array) => array.length);
				var mergedArray = new Uint8Array(
					allArrayLength.reduce((partialSum, cur) => partialSum + cur)
				);

				let offset = 0;
				imageOutputs.forEach(item => {
					mergedArray.set(item, offset);
					offset += item.length;
				});
				outputs.push(
					new vscode.NotebookCellOutputItem(mergedArray, 'image/png')
				);
			}
			return outputs;
		}

		var contents = new TextDecoder().decode(content);
		let reEmpty = new RegExp('^[\s\n\t\r]*$');
		if (reEmpty.test(contents)) {
			logDebug(contents);
			// TODO: create a new note on remote
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

		function asRawParagraph(
			cell: vscode.NotebookCellData
		): ParagraphData {
			let paragraph = <ParagraphData> cell.metadata;

			paragraph.text = cell.value;
			if (paragraph.id !== undefined) {
				paragraph.config.editorSetting.language = cell.languageId;
			}
			else {
				paragraph.config = {
					"editorSetting": {
						"language": cell.languageId,
						"editOnDblClick": false,
						"completionKey": "TAB",
						"completionSupport": cell.kind !== 1
					} };
			}

			paragraph.results = cell.metadata?.results;
			return paragraph;
		}

		// transform vscode notebook cells into Zeppelin paragraphs
		let paragraphs = data.cells.map(asRawParagraph);
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
