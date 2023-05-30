import * as vscode from 'vscode';


export class ZeppelinSerializer implements vscode.NotebookSerializer {
	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<vscode.NotebookData> {
		var contents = new TextDecoder().decode(content);

		let raw: RawNotebookCell[];
		try {
			raw = <RawNotebookCell[]>JSON.parse(contents);
		} catch {
			raw = [];
		}

		const cells = raw.map(
			item => new vscode.NotebookCellData(item.kind, item.value, item.language)
		);

		return new vscode.NotebookData(cells);
	}

	async serializeNotebook(
		data: vscode.NotebookData,
		_token: vscode.CancellationToken
	): Promise<Uint8Array> {
		let contents: RawNotebookCell[] = [];
        // function to take output renderer data to a format to save to the file
		function asRawOutput(cell: vscode.NotebookCellData): RawCellOutput[] {
			let result: RawCellOutput[] = [];
			for (let output of cell.outputs ?? []) {
				for (let item of output.items) {
                    let outputContents = '';
                    try {
                        outputContents = new TextDecoder().decode(item.data);
                    } catch {
                        
                    }

                    try {
                        let outputData = JSON.parse(outputContents);
                        result.push({ mime: item.mime, value: outputData });
                    } catch {
                        result.push({ mime: item.mime, value: outputContents });
                    }
				}
			}
			return result;
		}
		for (const cell of data.cells) {
			contents.push({
				kind: cell.kind,
				language: cell.languageId,
				value: cell.value,
				outputs: asRawOutput(cell)
			});
		}

		return new TextEncoder().encode(JSON.stringify(contents));
	}
}

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.NotebookCellKind;
    editable?: boolean;
    outputs: RawCellOutput[];
}

interface RawCellOutput {
	mime: string;
	value: any;
}

// NEEDED Declaration to silence errors
declare class TextDecoder {
	decode(data: Uint8Array): string;
}

declare class TextEncoder {
	encode(data: string): Uint8Array;
}