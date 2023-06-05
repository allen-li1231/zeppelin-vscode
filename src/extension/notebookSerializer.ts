import * as vscode from 'vscode';
import { logDebug, mapLanguageKind } from '../common/common';
import {
	NoteData,
	NoteInfo,
	AngularObjects,
	ParagraphData, 
	ParagraphResult, 
	ParagraphResultMsg
} from '../common/dataStructure';
import { Dictionary, List } from 'lodash';


// extend vscode.NotebookData to maintain Zeppelin variables
class ZeppelinNotebookData extends vscode.NotebookData {
	id: string;
	name: string;
	info?: NoteInfo;
	noteForms?: Dictionary<any>;
	noteParams?: Dictionary<any>;
	angularObjects?: AngularObjects;
	config?: Dictionary<any>;

	constructor(
		id: string,
		name: string,
		cells: vscode.NotebookCellData[],
		info?: NoteInfo,
		noteForms?: Dictionary<any>,
		noteParams?: Dictionary<any>,
		angularObjects?: AngularObjects) {
			super(cells);
			this.id = id;
			this.name = name;
			this.info = info;
			this.noteForms = noteForms;
			this.noteParams = noteParams;
			this.angularObjects = angularObjects;
		}
}


export class ZeppelinSerializer implements vscode.NotebookSerializer {

	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<ZeppelinNotebookData> {

		function parseParagraphToCellData(
			paragraph: ParagraphData
		): vscode.NotebookCellData {
			let lang: string = paragraph.config.editorSetting.language;
			let kind: number = mapLanguageKind.get(lang) ?? 1;
			// default cell kind is markup language
			return new vscode.NotebookCellData(kind, paragraph.text, lang);
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
		return new ZeppelinNotebookData(
			// required
			raw.id, raw.name, cells,
			// optional
			raw.info, raw.noteForms, raw.noteParams, raw.angularObjects);
	}

	async serializeNotebook(
		data: ZeppelinNotebookData,
		_token: vscode.CancellationToken
	): Promise<Uint8Array> {
	// function to take output renderer data to a format to save to the file
		
		function asRawParagraphResult(
			cellOutputs: vscode.NotebookCellOutput[]
		): ParagraphResult {

			let results: ParagraphResultMsg[] = [];
			let code = 'READY';
			let msgType = 'TEXT';
			for (let cellOutput of cellOutputs){
				for (let output of cellOutput.items ?? []) {
					let outputContents = '';
					try {
						outputContents = new TextDecoder().decode(output.data);
					} catch(err) {
						// pass
						logDebug("error in decoding output data", err);
						throw err;
					}
		
					try {
						let outputData = JSON.parse(outputContents);
						switch (outputData.mime)  {
							case 'text/plain': 
								code = 'SUCCESS';
								msgType = 'TEXT';
							case 'text/plain': 
								code = 'SUCCESS';
								msgType = 'TEXT';
							case 'text/html': 
								code = 'SUCCESS';
								msgType = 'HTML';
							case 'application/vnd.code.notebook.stdout': 
								code = 'SUCCESS';
								msgType = 'TEXT';
							case 'application/vnd.code.notebook.error': 
								code = 'ERROR';
								msgType = 'TEXT';
							default:
								code = 'SUCCESS';
								msgType = 'TEXT';
						}
						results.push({
							data: outputData.data,
							type: msgType
						});
					} catch(err) {
						logDebug("error in parsing output countents to JSON", err);
						throw err;
					}
				}
			}
			return { code: code, msg: results };
		}

		function asRawParagraph(
			cell: vscode.NotebookCellData
		): ParagraphData {
			let paragraph: ParagraphData = {
				config: {
					enabled: true,
					editorMode: "ace/mode/" + cell.languageId,
					editorSetting: {
						completionKey: "TAB",
						completionSupport: true,
						editOnDblClick: false,
						language: cell.languageId
					}
				},
				status: 'READY',
				text: cell.value
			};

			if (cell.outputs) {
				paragraph.results = asRawParagraphResult(cell.outputs);
			}
			return paragraph;
		}

		// transform vscode notebook cells into Zeppelin paragraphs
		let paragraphs = data.cells.map(asRawParagraph);
		// build Zeppelin note data
		let noteData: NoteData = {
			id: data.id,
			name: data.name,
			paragraphs: paragraphs,
			info: data.info,
			noteForms: data.noteForms,
			noteParams: data.noteParams,
			angularObjects: data.angularObjects
		}
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