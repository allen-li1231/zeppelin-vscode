import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logDebug } from '../common/common';
import { ZeppelinKernel } from '../extension/notebookKernel';

/**
 * CodeLens provider for AI Mode action buttons
 */
class AIModeCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        // Only show CodeLens for AI Mode SQL files
        if (!document.fileName.includes('ai-mode') || !document.fileName.endsWith('.sql')) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];

        const saveLens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
            title: '═════    S A V E    ═════',
            command: 'zeppelin-vscode.aiMode.done',
            tooltip: 'Apply changes to notebook cells and close'
        });
        lenses.push(saveLens);

        const cancelLens = new vscode.CodeLens(new vscode.Range(1, 0, 1, 0), {
            title: '═════  C A N C E L  ═════',
            command: 'zeppelin-vscode.aiMode.cancel',
            tooltip: 'Discard changes and close'
        });
        lenses.push(cancelLens);

        return lenses;
    }
}

/**
 * AI Mode Manager - Handles editing selected cells in a temporary file
 */
export class AIModeManager {
    private static _selectedCells = new Set<vscode.NotebookCell>();
    private static _activeSession: {
        notebook: vscode.NotebookDocument;
        cells: vscode.NotebookCell[];
        tempFile: vscode.Uri;
        statusBarItem: vscode.StatusBarItem;
        kernel: ZeppelinKernel;
    } | undefined;

    /**
     * Toggle cell selection for AI Mode
     */
    public static toggleCellSelection(cell: vscode.NotebookCell): void {
        if (this._selectedCells.has(cell)) {
            this._selectedCells.delete(cell);
            vscode.window.showInformationMessage(
                `Cell ${cell.index + 1} deselected. ${this._selectedCells.size} cell(s) selected for AI Mode.`,
                { modal: false }
            );
        } else {
            this._selectedCells.add(cell);
            vscode.window.showInformationMessage(
                `Cell ${cell.index + 1} selected. ${this._selectedCells.size} cell(s) selected for AI Mode.`,
                { modal: false }
            );
        }
    }

    /**
     * Get currently selected cells
     */
    public static getSelectedCells(): vscode.NotebookCell[] {
        return Array.from(this._selectedCells);
    }

    /**
     * Clear selected cells
     */
    public static clearSelectedCells(): void {
        this._selectedCells.clear();
    }

    /**
     * Enter AI Mode: Extract selected cells and open them in a temporary file
     */
    public static async enterAIMode(kernel: ZeppelinKernel): Promise<void> {
        const activeEditor = vscode.window.activeNotebookEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('No active notebook editor found');
            return;
        }

        const notebook = activeEditor.notebook;
        if (!notebook.uri.fsPath.endsWith('.zpln')) {
            vscode.window.showWarningMessage('AI Mode is only available for Zeppelin notebooks');
            return;
        }

        // Get selected cells - prioritize manually selected cells, then editor selection
        let selectedCells: vscode.NotebookCell[] = [];
        
        // First check if there are manually selected cells (via cell buttons)
        const manuallySelected = this.getSelectedCells().filter(c => c.notebook === notebook);
        if (manuallySelected.length > 0) {
            selectedCells = manuallySelected;
            this.clearSelectedCells(); // Clear after use
        } else {
            // Fall back to editor selection
            const selection = activeEditor.selection;
            if (selection && selection.start !== selection.end) {
                // Multiple cells selected
                for (let i = selection.start; i < selection.end; i++) {
                    selectedCells.push(notebook.cellAt(i));
                }
            } else {
                // Single cell or no selection - use active cell
                const cellIndex = selection?.start ?? 0;
                if (cellIndex < notebook.cellCount) {
                    selectedCells.push(notebook.cellAt(cellIndex));
                }
            }
        }

        if (selectedCells.length === 0) {
            vscode.window.showWarningMessage(
                'No cells selected. Click "Select for AI Mode" on cells, or use editor selection.'
            );
            return;
        }

        // First selected cell must have an interpreter (e.g. %spark_dharma-shashank)
        const firstCell = selectedCells[0];
        if (firstCell.kind === vscode.NotebookCellKind.Code) {
            const interpreterPrefix = kernel.getInterpreterFromCell(firstCell);
            if (!interpreterPrefix) {
                vscode.window.showWarningMessage(
                    'The first cell must have an interpreter (e.g. %spark_username) at the top. Please add it to the cell and try AI Mode again.'
                );
                return;
            }
        }

        // Check if there's already an active session
        if (this._activeSession) {
            const action = await vscode.window.showWarningMessage(
                'AI Mode session already active. Close existing session?',
                'Yes', 'No'
            );
            if (action === 'Yes') {
                await this.cancelAIMode();
            } else {
                return;
            }
        }

        // Create temporary file with cell contents
        const tempFile = await this.createTempFile(notebook, selectedCells);
        if (!tempFile) {
            vscode.window.showErrorMessage('Failed to create temporary file for AI Mode');
            return;
        }

        // Register CodeLens provider for Done/Cancel buttons
        const codeLensProvider = new AIModeCodeLensProvider();
        const codeLensDisposable = vscode.languages.registerCodeLensProvider(
            { scheme: 'file', pattern: '**/*ai-mode*.sql' },
            codeLensProvider
        );

        // Open the temporary file in the same window as a new tab (not split)
        const document = await vscode.workspace.openTextDocument(tempFile);
        const editor = await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Active,
            preview: false
        });

        // Create status bar item for actions (backup option)
        const statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            1000
        );
        statusBarItem.text = 'AI Mode';
        statusBarItem.tooltip = `Editing ${selectedCells.length} cell(s). Use SAVE or CANCEL at top of file.`;
        statusBarItem.command = 'zeppelin-vscode.aiMode.showActions';
        statusBarItem.show();

        // Store session info
        this._activeSession = {
            notebook,
            cells: selectedCells,
            tempFile,
            statusBarItem,
            kernel
        };

        // Store disposable for cleanup
        (this._activeSession as any).codeLensDisposable = codeLensDisposable;

        vscode.window.showInformationMessage(
            `AI Mode: editing ${selectedCells.length} cell(s). Use SAVE or CANCEL at top of file.`
        );

        // Listen for file changes to update status
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (this._activeSession && e.document.uri.toString() === tempFile.toString()) {
                this._activeSession.statusBarItem.text = '$(sparkle) AI Mode: $(pencil) Modified';
                this._activeSession.statusBarItem.tooltip = `Editing ${selectedCells.length} cell(s) - Changes detected. Click to finish.`;
            }
        });
    }

    /**
     * Create a temporary file with cell contents and metadata
     */
    private static async createTempFile(
        notebook: vscode.NotebookDocument,
        cells: vscode.NotebookCell[]
    ): Promise<vscode.Uri | undefined> {
        try {
            // Create temp directory if it doesn't exist
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const tempDir = workspaceRoot 
                ? path.join(workspaceRoot, '.zeppelin-ai-mode')
                : path.join(os.tmpdir(), '.zeppelin-ai-mode');
            
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Create temp file name based on notebook name
            const notebookName = path.basename(notebook.uri.fsPath, '.zpln');
            const timestamp = Date.now();
            const tempFileName = `${notebookName}-ai-mode-${timestamp}.sql`;
            const tempFilePath = path.join(tempDir, tempFileName);

            let content = `\n\n-- ==============================================================================\n`;
            content += `-- AI MODE  |  ${cells.length} cell(s) from "${notebookName}"\n`;
            content += `-- ==============================================================================\n`;
            content += `-- Edit the SQL below. Do not change '--====' lines and use below format for new cell queries.\n`;
            content += `-- click SAVE or CANCEL above.\n`;
            content += `-- ==============================================================================\n\n`;

            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                const cellIndex = cell.index;
                const language = cell.document.languageId;
                const cellId = cell.metadata?.id || `cell-${cellIndex}`;
                
                // Cell marker with metadata (using SQL comments) - with proper spacing
                content += `\n--========================================================================================================================================================================================================================================== CELL_START:index=${cellIndex},id=${cellId},language=${language}\n\n`;
                const cellText = cell.document.getText().trim();
                content += cellText;
                if (cellText && !cellText.endsWith('\n')) {
                    content += '\n';
                }
                content += `\n--========================================================================================================================================================================================================================================== CELL_END:index=${cellIndex},id=${cellId}\n\n\n`;
            }

            // Write to file
            fs.writeFileSync(tempFilePath, content, 'utf8');

            return vscode.Uri.file(tempFilePath);
        } catch (error) {
            logDebug('Error creating temp file for AI Mode:', error);
            return undefined;
        }
    }

    /**
     * Show actions (Done/Cancel) for AI Mode
     */
    public static async showAIModeActions(): Promise<void> {
        if (!this._activeSession) {
            vscode.window.showWarningMessage('No active AI Mode session');
            return;
        }

        const action = await vscode.window.showQuickPick(
            [
                { label: 'SAVE', description: 'Apply changes to notebook cells' },
                { label: 'CANCEL', description: 'Discard changes' }
            ],
            { placeHolder: 'AI Mode action', ignoreFocusOut: true }
        );

        if (!action) {
            return;
        }

        if (action.label === 'SAVE') {
            await this.applyAIModeChanges();
        } else {
            await this.cancelAIMode();
        }
    }

    /**
     * Parse the temporary file and extract cell contents
     */
    private static parseTempFile(content: string): Array<{
        index: number;
        id: string;
        language: string;
        content: string;
    }> {
        const cells: Array<{
            index: number;
            id: string;
            language: string;
            content: string;
        }> = [];

        // Match cell blocks: -- CELL_START:... ... -- CELL_END:...
        // Updated regex to handle SQL comment format
        const cellPattern = /--==========================================================================================================================================================================================================================================\s*CELL_START:([^\n]+)\n([\s\S]*?)\n--==========================================================================================================================================================================================================================================\s*CELL_END:[^\n]+/g;
        
        let match;
        while ((match = cellPattern.exec(content)) !== null) {
            const metadataStr = match[1];
            const cellContent = match[2];

            // Parse metadata: index=X,id=Y,language=Z
            const metadata: { [key: string]: string } = {};
            metadataStr.split(',').forEach(part => {
                const [key, value] = part.split('=');
                if (key && value) {
                    metadata[key.trim()] = value.trim();
                }
            });

            // Use language from metadata, default to sql
            const cellLanguage = metadata.language || 'sql';

            cells.push({
                index: parseInt(metadata.index || '0', 10),
                id: metadata.id || '',
                language: cellLanguage,
                content: cellContent.trim()
            });
        }

        return cells;
    }

    /**
     * Preview changes before applying
     */
    private static async previewAIModeChanges(): Promise<void> {
        if (!this._activeSession) {
            return;
        }

        const { tempFile, cells } = this._activeSession;

        try {
            const document = await vscode.workspace.openTextDocument(tempFile);
            const editedContent = document.getText();
            const parsedCells = this.parseTempFile(editedContent);

            if (parsedCells.length !== cells.length) {
                vscode.window.showWarningMessage(
                    `Warning: Found ${parsedCells.length} cells in edited file, but expected ${cells.length}. ` +
                    'The file structure may have been modified incorrectly.'
                );
            }

            // Show diff for each cell
            let diffContent = `# AI Mode Changes Preview\n\n`;
            diffContent += `**Editing ${cells.length} cell(s)**\n\n`;

            for (let i = 0; i < Math.min(parsedCells.length, cells.length); i++) {
                const originalCell = cells[i];
                const editedCell = parsedCells[i];
                const originalText = originalCell.document.getText();
                const editedText = editedCell.content;

                if (originalText !== editedText) {
                    diffContent += `## Cell ${i + 1} (Index: ${originalCell.index})\n\n`;
                    diffContent += `**Language:** ${originalCell.document.languageId}\n\n`;
                    diffContent += `**Original:**\n\`\`\`${originalCell.document.languageId}\n${originalText}\n\`\`\`\n\n`;
                    diffContent += `**Edited:**\n\`\`\`${editedCell.language}\n${editedText}\n\`\`\`\n\n`;
                    diffContent += `---\n\n`;
                } else {
                    diffContent += `## Cell ${i + 1} (Index: ${originalCell.index}) - No changes\n\n`;
                }
            }

            // Open preview in new document
            const previewDoc = await vscode.workspace.openTextDocument({
                content: diffContent,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(previewDoc, {
                viewColumn: vscode.ViewColumn.Active,
                preview: true
            });

            // Ask if user wants to apply
            const apply = await vscode.window.showInformationMessage(
                'Review the changes above. Apply these changes to the notebook?',
                'Apply Changes',
                'Cancel'
            );

            if (apply === 'Apply Changes') {
                await this.applyAIModeChanges();
            }
        } catch (error) {
            logDebug('Error previewing AI Mode changes:', error);
            vscode.window.showErrorMessage(`Failed to preview changes: ${error}`);
        }
    }

    /**
     * Apply changes from temporary file back to notebook cells (public for command)
     */
    public static async applyAIModeChanges(): Promise<void> {
        if (!this._activeSession) {
            vscode.window.showWarningMessage('No active AI Mode session');
            return;
        }

        const { notebook, cells, tempFile, kernel, statusBarItem } = this._activeSession;

        try {
            // Read edited content
            const document = await vscode.workspace.openTextDocument(tempFile);
            const editedContent = document.getText();
            const parsedCells = this.parseTempFile(editedContent);

            if (parsedCells.length === 0) {
                vscode.window.showErrorMessage(
                    'Could not parse edited file. Make sure you did not modify the cell markers.'
                );
                return;
            }

            // First cell (if code) must have interpreter prefix (e.g. %spark_username)
            const hasInterpreterRe = /^[\s\n]*(%[\w\d\._-]+)/;
            const firstParsed = parsedCells[0];
            if (firstParsed.language !== 'markdown' && !hasInterpreterRe.test(firstParsed.content)) {
                vscode.window.showErrorMessage(
                    'The first cell must contain an interpreter (e.g. %spark_dharma-shashank) at the top. Please add it in the cell and save again.'
                );
                return;
            }

            // 1) Update existing cells
            const edits: vscode.WorkspaceEdit[] = [];
            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < Math.min(parsedCells.length, cells.length); i++) {
                const originalCell = cells[i];
                const editedCell = parsedCells[i];
                const newContent = editedCell.content;

                try {
                    const cellEdit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        originalCell.document.positionAt(0),
                        originalCell.document.positionAt(originalCell.document.getText().length)
                    );
                    cellEdit.replace(originalCell.document.uri, fullRange, newContent);
                    edits.push(cellEdit);
                    successCount++;
                } catch (error) {
                    logDebug(`Error updating cell ${i}:`, error);
                    errorCount++;
                }
            }

            for (const edit of edits) {
                await vscode.workspace.applyEdit(edit);
            }

            // 2) If edited file has more cells than original, create new notebook cells
            if (parsedCells.length > cells.length) {
                const lastOriginalIndex = cells[cells.length - 1].index;
                const insertIndex = lastOriginalIndex + 1;

                // Resolve interpreter prefix for new cells: inherit from last cell or build from login username
                let interpreterPrefix: string | undefined =
                    kernel.getInterpreterFromCell(cells[cells.length - 1]);
                if (!interpreterPrefix) {
                    const username = await kernel.getContext().secrets.get('zeppelinUsername');
                    if (username) {
                        const normalized = String(username).trim().replace(/\s+/g, '-');
                        interpreterPrefix = `%spark_${normalized}`;
                    }
                }

                const newCellsData: vscode.NotebookCellData[] = [];
                const hasInterpreterRe = /^[\s\n]*(%[\w\d\._-]+)/;

                for (let i = cells.length; i < parsedCells.length; i++) {
                    const p = parsedCells[i];
                    let content = p.content;
                    if (p.language !== 'markdown' && interpreterPrefix && !hasInterpreterRe.test(content)) {
                        content = interpreterPrefix + '\n' + content;
                    }
                    const kind = p.language === 'markdown'
                        ? vscode.NotebookCellKind.Markup
                        : vscode.NotebookCellKind.Code;
                    const lang = p.language || 'sql';
                    newCellsData.push(new vscode.NotebookCellData(kind, content, lang));
                }

                try {
                    await kernel.editWithoutParagraphUpdate(async () => {
                        await kernel.insertNoteCells(notebook, insertIndex, newCellsData);
                    });
                    successCount += newCellsData.length;
                } catch (error) {
                    logDebug('Error inserting new cells:', error);
                    vscode.window.showWarningMessage(
                        `Updated ${successCount} cell(s), but failed to add ${newCellsData.length} new cell(s).`
                    );
                }
            }

            // Close the temporary file
            const tempDoc = await vscode.workspace.openTextDocument(tempFile);
            await vscode.window.showTextDocument(tempDoc);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

            // Clean up
            await this.cleanupAIMode();

            const newCount = Math.max(0, parsedCells.length - cells.length);
            if (errorCount === 0) {
                const msg = newCount > 0
                    ? `Applied changes to ${cells.length} cell(s) and added ${newCount} new cell(s).`
                    : `Applied changes to ${successCount} cell(s).`;
                vscode.window.showInformationMessage(msg);
            } else {
                vscode.window.showWarningMessage(
                    `Applied changes to ${successCount} cell(s), ${errorCount} error(s) occurred.`
                );
            }
        } catch (error) {
            logDebug('Error applying AI Mode changes:', error);
            vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
        }
    }

    /**
     * Save changes and delete cells from notebook
     */
    public static async saveAndDeleteAIMode(): Promise<void> {
        if (!this._activeSession) {
            vscode.window.showWarningMessage('No active AI Mode session');
            return;
        }

        const { notebook, cells, kernel } = this._activeSession;

        // Confirm deletion
        const confirm = await vscode.window.showWarningMessage(
            `Save changes and delete ${cells.length} cell(s) from notebook?`,
            { modal: true },
            'Yes, Save & Delete',
            'Cancel'
        );

        if (confirm !== 'Yes, Save & Delete') {
            return;
        }

        // Store original cell count before applying changes
        const originalCellCount = notebook.cellCount;
        
        // First apply the changes
        await this.applyAIModeChanges();

        // Then delete the cells - need to get updated cell references after apply
        if (cells.length > 0) {
            // Get current cell indices (they might have shifted)
            const cellIndices: number[] = [];
            for (const originalCell of cells) {
                // Find the cell by its ID in the updated notebook
                for (let i = 0; i < notebook.cellCount; i++) {
                    const cell = notebook.cellAt(i);
                    if (cell.metadata?.id === originalCell.metadata?.id) {
                        cellIndices.push(i);
                        break;
                    }
                }
            }

            // Sort descending to delete from highest index first
            cellIndices.sort((a, b) => b - a);
            
            // Delete cells from highest index to lowest to avoid index shifting issues
            for (const index of cellIndices) {
                if (index >= 0 && index < notebook.cellCount) {
                    const range = new vscode.NotebookRange(index, index + 1);
                    await kernel.deleteNoteCells(notebook, range);
                }
            }

            vscode.window.showInformationMessage(
                `✓ Changes applied and ${cells.length} cell(s) deleted from notebook`
            );
        }
    }

    /**
     * Cancel AI Mode and discard changes
     */
    public static async cancelAIMode(): Promise<void> {
        if (!this._activeSession) {
            return;
        }

        const { tempFile, statusBarItem } = this._activeSession;

        // Close the temporary file if open
        try {
            const openEditors = vscode.window.visibleTextEditors;
            for (const editor of openEditors) {
                if (editor.document.uri.toString() === tempFile.toString()) {
                    await vscode.window.showTextDocument(editor.document);
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    break;
                }
            }
        } catch (error) {
            logDebug('Error closing temp file:', error);
        }

        await this.cleanupAIMode();
        vscode.window.showInformationMessage('AI Mode cancelled - changes discarded');
    }

    /**
     * Clean up AI Mode session
     */
    private static async cleanupAIMode(): Promise<void> {
        if (!this._activeSession) {
            return;
        }

        const { tempFile, statusBarItem } = this._activeSession;

        // Dispose CodeLens provider
        const codeLensDisposable = (this._activeSession as any).codeLensDisposable;
        if (codeLensDisposable) {
            codeLensDisposable.dispose();
        }

        // Hide status bar item
        statusBarItem.hide();
        statusBarItem.dispose();

        try {
            if (fs.existsSync(tempFile.fsPath)) {
                fs.unlinkSync(tempFile.fsPath);
            }
        } catch (error) {
            logDebug('Error cleaning up temp file:', error);
        }

        this._activeSession = undefined;
    }

    /**
     * Check if AI Mode is currently active
     */
    public static isActive(): boolean {
        return this._activeSession !== undefined;
    }
}
