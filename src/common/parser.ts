import * as vscode from 'vscode';
import {
    mapLanguage,
    mapLanguageKind,
    mapZeppelinLanguage,
    reInterpreter,
    logDebug
} from '../common/common';
import {
    ParagraphData,
	ParagraphResult,
	ParagraphResultMsg
} from './types';
import {
    isTableData,
    isDataFrameSchema,
    isPythonSparkDataFrame,
    isPySparkRowCollection,
    isSinglePySparkRow,
    formatTableOutput,
    formatTableOutputAsHtml,
    formatDataFrameSchemaAsCard
} from './tableFormatter';
import {
    formatTextOutput,
    shouldUseEnhancedTextFormat
} from './textFormatter';


export function parseCellInterpreter(cell: vscode.NotebookCell) {
    let interpreterIds = cell.document.getText().match(reInterpreter);
    if (interpreterIds === null || interpreterIds.length === 0) {
        return undefined;
    }

    let interpreterId = interpreterIds[1];
    let rootIdx = interpreterId.indexOf('.');
    interpreterId = rootIdx > 0 ? interpreterId.slice(0, rootIdx) : interpreterId;
    return interpreterId;
}

export function parseParagraphToCellData(
    paragraph: ParagraphData,
): vscode.NotebookCellData {
    let lang = paragraph.config?.editorSetting?.language ?? '';
    lang = mapLanguage.get(lang) ?? "sql";
    // default cell kind is markup language
    let kind: number = mapLanguageKind.get(lang) ?? vscode.NotebookCellKind.Code;
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
    let htmlOutput = '', errorOutput = '';
    let imageOutputs: Uint8Array[] = [];
    let mixedOutputs: { type: 'text' | 'schema' | 'table', content: string, index: number }[] = [];
    
    // Add progress bar text as first item if present
    if (progressbarText && progressbarText.trim()) {
        mixedOutputs.push({ type: 'text', content: progressbarText, index: -1 });
    }
    
    let msgIndex = 0;
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
            // First check if the ENTIRE message is a table or schema (don't split these)
            const isTABLE = msg.type === 'TABLE';
            const isFullMessagePySparkDF = msg.data && isPythonSparkDataFrame(msg.data);
            const isFullMessageRowCollection = msg.data && isPySparkRowCollection(msg.data);
            const isFullMessageSingleRow = msg.data && isSinglePySparkRow(msg.data);
            const isFullMessageDataFrame = msg.data && isDataFrameSchema(msg.data);
            const isFullMessageTable = msg.data && isTableData(msg.data);
            
            if (isTABLE || isFullMessagePySparkDF || isFullMessageRowCollection || isFullMessageSingleRow) {
                // Full PySpark table, Row collection, or single Row - don't split
                const tableHtml = formatTableOutputAsHtml(msg.data, `table-${msgIndex}`);
                if (tableHtml) {
                    mixedOutputs.push({ type: 'table', content: tableHtml, index: msgIndex });
                } else {
                    mixedOutputs.push({ type: 'text', content: msg.data, index: msgIndex });
                }
            } else if (isFullMessageDataFrame) {
                // Single DataFrame schema - don't split
                const schemaHtml = formatDataFrameSchemaAsCard(msg.data);
                if (schemaHtml) {
                    mixedOutputs.push({ type: 'schema', content: schemaHtml, index: msgIndex });
                } else {
                    mixedOutputs.push({ type: 'text', content: msg.data, index: msgIndex });
                }
            } else if (isFullMessageTable) {
                // Tab-separated table - don't split
                const tableHtml = formatTableOutputAsHtml(msg.data, `table-${msgIndex}`);
                if (tableHtml) {
                    mixedOutputs.push({ type: 'table', content: tableHtml, index: msgIndex });
                } else {
                    mixedOutputs.push({ type: 'text', content: msg.data, index: msgIndex });
                }
            } else if (msg.data && msg.data.trim()) {
                // Mixed content (multiple schemas/text in one message) - need smart splitting
                const lines = msg.data.split('\n');
                let currentTextBuffer: string[] = [];
                let currentRowBuffer = '';
                let inRowCollection = false;
                let bracketDepth = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmedLine = line.trim();
                    
                    // Track if we're inside a Row collection
                    for (const char of line) {
                        if (char === '[') {
                            bracketDepth++;
                            if (bracketDepth === 1 && line.includes('Row(')) {
                                inRowCollection = true;
                                // Flush text buffer before starting Row collection
                                if (currentTextBuffer.length > 0) {
                                    mixedOutputs.push({ 
                                        type: 'text', 
                                        content: currentTextBuffer.join('\n'), 
                                        index: msgIndex 
                                    });
                                    currentTextBuffer = [];
                                }
                            }
                        } else if (char === ']') {
                            bracketDepth--;
                        }
                    }
                    
                    if (inRowCollection) {
                        // Accumulate Row collection lines
                        currentRowBuffer += (currentRowBuffer ? '\n' : '') + line;
                        
                        // Check if Row collection is complete
                        if (bracketDepth === 0) {
                            inRowCollection = false;
                            // Try to format the complete Row collection
                            const tableHtml = formatTableOutputAsHtml(currentRowBuffer.trim(), `table-${msgIndex}-${i}`);
                            if (tableHtml) {
                                mixedOutputs.push({ type: 'table', content: tableHtml, index: msgIndex });
                            } else {
                                // Fallback to text if formatting failed
                                currentTextBuffer.push(currentRowBuffer);
                            }
                            currentRowBuffer = '';
                        }
                    } else if (!trimmedLine) {
                        // Empty line
                        if (currentTextBuffer.length > 0) {
                            currentTextBuffer.push(line);
                        }
                    } else if (isSinglePySparkRow(trimmedLine)) {
                        // Single Row object on single line
                        // Flush text buffer first
                        if (currentTextBuffer.length > 0) {
                            mixedOutputs.push({ 
                                type: 'text', 
                                content: currentTextBuffer.join('\n'), 
                                index: msgIndex 
                            });
                            currentTextBuffer = [];
                        }
                        
                        // Add single Row
                        const rowHtml = formatTableOutputAsHtml(trimmedLine, `table-${msgIndex}-${i}`);
                        if (rowHtml) {
                            mixedOutputs.push({ type: 'table', content: rowHtml, index: msgIndex });
                        } else {
                            currentTextBuffer.push(line);
                        }
                    } else if (isDataFrameSchema(trimmedLine)) {
                        // DataFrame schema on single line
                        // Flush text buffer first
                        if (currentTextBuffer.length > 0) {
                            mixedOutputs.push({ 
                                type: 'text', 
                                content: currentTextBuffer.join('\n'), 
                                index: msgIndex 
                            });
                            currentTextBuffer = [];
                        }
                        
                        // Add schema
                        const schemaHtml = formatDataFrameSchemaAsCard(trimmedLine);
                        if (schemaHtml) {
                            mixedOutputs.push({ type: 'schema', content: schemaHtml, index: msgIndex });
                        } else {
                            currentTextBuffer.push(line);
                        }
                    } else {
                        // Regular text line
                        currentTextBuffer.push(line);
                    }
                }
                
                // Flush remaining text buffer
                if (currentTextBuffer.length > 0) {
                    mixedOutputs.push({ 
                        type: 'text', 
                        content: currentTextBuffer.join('\n'), 
                        index: msgIndex 
                    });
                }
                
                // Flush remaining Row collection if any
                if (currentRowBuffer) {
                    const tableHtml = formatTableOutputAsHtml(currentRowBuffer.trim(), `table-${msgIndex}-final`);
                    if (tableHtml) {
                        mixedOutputs.push({ type: 'table', content: tableHtml, index: msgIndex });
                    } else {
                        mixedOutputs.push({ type: 'text', content: currentRowBuffer, index: msgIndex });
                    }
                }
            }
        }
        msgIndex++;
    }
    
    // Combine mixed outputs with proper separation
    if (mixedOutputs.length > 0) {
        let combinedHtml = '';
        let currentTextBuffer = '';
        
        // Add header if we have many outputs
        if (mixedOutputs.length > 10) {
            combinedHtml += `
                <div style="padding: 8px 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; font-size: 12px;">
                    <strong style="color: var(--vscode-textLink-foreground);">Multiple Outputs:</strong> 
                    <span style="color: var(--vscode-foreground);">Showing ${mixedOutputs.length} outputs (expand any item for details)</span>
                </div>
            `;
        }
        
        mixedOutputs.forEach((output, idx) => {
            if (output.type === 'text') {
                // Buffer text outputs
                currentTextBuffer += output.content + '\n';
            } else {
                // Flush text buffer before schema/table
                if (currentTextBuffer.trim()) {
                    combinedHtml += `
                        <div style="padding: 8px 12px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 8px 0; font-family: monospace; font-size: 11px; white-space: pre-wrap; color: var(--vscode-foreground);">${escapeHtml(currentTextBuffer.trim())}</div>
                    `;
                    currentTextBuffer = '';
                }
                
                // Add schema or table
                if (output.type === 'schema') {
                    combinedHtml += `<div style="margin: 8px 0;">${output.content}</div>`;
                } else if (output.type === 'table') {
                    // Add separator and number for tables if multiple
                    const tableCount = mixedOutputs.filter(o => o.type === 'table').length;
                    if (tableCount > 1) {
                        const tableNumber = mixedOutputs.slice(0, idx + 1).filter(o => o.type === 'table').length;
                        combinedHtml += `
                            <div style="padding: 8px 12px; background: var(--vscode-input-background); border-left: 3px solid var(--vscode-textLink-foreground); margin: 15px 0 10px 0; font-weight: 600; font-size: 13px;">
                                Result ${tableNumber} of ${tableCount}
                            </div>
                        `;
                    }
                    combinedHtml += output.content;
                    if (idx < mixedOutputs.length - 1) {
                        combinedHtml += '<div style="margin: 15px 0; border-top: 2px solid var(--vscode-panel-border);"></div>';
                    }
                }
            }
        });
        
        // Flush any remaining text
        if (currentTextBuffer.trim()) {
            combinedHtml += `
                <div style="padding: 8px 12px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 8px 0; font-family: monospace; font-size: 11px; white-space: pre-wrap; color: var(--vscode-foreground);">${escapeHtml(currentTextBuffer.trim())}</div>
            `;
        }
        
        outputs.push(
            new vscode.NotebookCellOutputItem(
                encoder.encode(combinedHtml),
                'text/html'
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
            vscode.NotebookCellOutputItem.stderr(errorOutput)
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

function escapeHtml(text: string): string {
    if (text == null || text === undefined) {
        return '';
    }
    
    const str = String(text);
    const htmlEscapes: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    
    return str.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
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
                    case 'application/vnd.code.notebook.stderr': 
                        code = 'ERROR';
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
        ? mapZeppelinLanguage.get(cell.languageId) ?? "sql"
        : mapZeppelinLanguage.get(cell.document.languageId) ?? "sql";

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
            "editorMode": `ace/mode/${languageId}`,
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
export declare class TextDecoder {
	decode(data: Uint8Array): string;
}

export declare class TextEncoder {
	encode(data: string): Uint8Array;
}