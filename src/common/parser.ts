import * as vscode from 'vscode';
import { mapLanguageKind, logDebug } from '../common/common';
import {
    ParagraphData,
	ParagraphResult,
	ParagraphResultMsg
} from './types';


export function parseParagraphToCellData(
    paragraph: ParagraphData,
): vscode.NotebookCellData {
    let lang = paragraph.config?.editorSetting?.language ?? '';
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

export function parseParagraphResultToCellOutput(
    results: ParagraphResult, progressbarText?: string
) {
    let outputs: vscode.NotebookCellOutputItem[] = [];

    let encoder = new TextEncoder();
    let textOutput = '', htmlOutput = '', errorOutput = '';
    let imageOutputs: Uint8Array[] = [];
    for (let msg of results.msg ?? []) {
        if (msg.type === 'HTML') {
            htmlOutput += msg.data;
        }
        else if (msg.type === 'IMG') {
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
                name: 'ERROR',
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

    if (progressbarText || textOutput.length > 0) {
        outputs.push(
            new vscode.NotebookCellOutputItem(
                encoder.encode((progressbarText ?? '') + textOutput),
                'text/plain'
            )
        );
    }

    return outputs;
}

export function parseCellOutputsToParagraphResult(
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
                switch (output.mime)  {
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
                    data: outputContents,
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

export function parseCellToParagraphData(
    cell: vscode.NotebookCellData | vscode.NotebookCell
): ParagraphData {
    let paragraph = <ParagraphData> {...cell.metadata};

    paragraph.text = cell instanceof vscode.NotebookCellData
        ? cell.value
        : cell.document.getText();

    let languageId = cell instanceof vscode.NotebookCellData
        ? cell.languageId
        : cell.document.languageId;

    if (paragraph.id !== undefined) {
        if (paragraph.config === undefined) {
            paragraph.config = {"editorSetting": {}};
        }
        if (paragraph.config.editorSetting === undefined) {
            paragraph.config.editorSetting = {};
        }

        paragraph.config.editorSetting.language = languageId;
    }
    else {
        let lineNumbers = vscode.workspace.getConfiguration("editor")
            .get("lineNumbers", vscode.TextEditorLineNumbersStyle.Off)
                !== vscode.TextEditorLineNumbersStyle.Off;
        paragraph.config = {
            "lineNumbers": paragraph.config?.lineNumbers ?? lineNumbers,
            "editorSetting": {
                "language": languageId,
                "editOnDblClick": false,
                "completionKey": "TAB",
                "completionSupport": cell.kind !== 1
            }
        };
    }

    paragraph.results = cell.metadata?.results;
    return paragraph;
}


// NEEDED Declaration to silence errors
declare class TextDecoder {
	decode(data: Uint8Array): string;
}

declare class TextEncoder {
	encode(data: string): Uint8Array;
}