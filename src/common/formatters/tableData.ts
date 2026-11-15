import { escapeHtml, escapeHtmlAttr, escapeHtmlForTextarea } from './escape';
import { TABLE_STYLES, renderTableScript } from './assets';

export interface TableData {
    headers: string[];
    rows: string[][];
}

/**
 * Parse Zeppelin table format (both %table and direct TABLE type) from text output.
 * Also used for Spark dataframe results returned by Spark interpreters (TABLE type or tab-separated).
 */
export function parseTableData(data: string): TableData | null {
    if (!data || typeof data !== 'string') {
        return null;
    }

    let tableText = data.trim();
    
    // Remove %table prefix if present
    if (tableText.startsWith('%table')) {
        tableText = tableText.replace(/^%table\s*\n?/, '').trim();
    }
    
    const lines = tableText.split('\n');
    
    if (lines.length === 0) {
        return null;
    }

    // First line is headers (tab-separated)
    const headers = lines[0].split('\t').map(h => h.trim()).filter(h => h.length > 0);
    
    if (headers.length === 0) {
        return null;
    }
    
    // Remaining lines are data rows
    const rows: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const row = lines[i].split('\t').map(cell => cell.trim());
            // Pad or trim row to match header length for consistency
            while (row.length < headers.length) {
                row.push('');
            }
            if (row.length > headers.length) {
                row.length = headers.length;
            }
            rows.push(row);
        }
    }

    // Only return valid table data
    if (rows.length === 0) {
        return null;
    }

    return { headers, rows };
}

export function isTableData(data: string): boolean {
    if (!data || typeof data !== 'string') {
        return false;
    }

    const trimmed = data.trim();

    // Check for %table prefix
    if (trimmed.startsWith('%table')) {
        return true;
    }

    // Check if it looks like tab-separated table data (e.g. Spark dataframe result)
    // (has tabs and multiple lines)
    const lines = trimmed.split('\n');
    if (lines.length >= 2) {
        // Check if first two lines have similar number of tabs
        const firstLineTabs = (lines[0].match(/\t/g) || []).length;
        const secondLineTabs = (lines[1].match(/\t/g) || []).length;
        
        // If both lines have multiple tabs and similar counts, likely a table
        return firstLineTabs > 0 && Math.abs(firstLineTabs - secondLineTabs) <= 1;
    }
    
    return false;
}

/**
 * Generate HTML table with enhanced formatting and download buttons
 * Uses data URL approach for reliable download in VS Code webviews
 */
export function formatTableAsHTML(tableData: TableData, tableId: string = 'table'): string {
    const { headers, rows } = tableData;
    const rowCount = rows.length;
    const colCount = headers.length;

    

    // Generate unique ID for this table
    const uniqueId = `zeppelin-table-${tableId}-${Date.now()}`;

    // Pre-generate CSV content for embedding
    const csvContent = generateCSV(headers, rows);
    // Encode CSV as base64 for data URL (add BOM for Excel compatibility)
    const csvWithBom = '\uFEFF' + csvContent;
    const csvBase64 = Buffer.from(csvWithBom, 'utf-8').toString('base64');
    const dataUrl = `data:text/csv;charset=utf-8;base64,${csvBase64}`;
    
    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `zeppelin_data_${timestamp}.csv`;

    // Build HTML with embedded CSS and JavaScript
    let html = `
${TABLE_STYLES}

<div class="zeppelin-table-container" id="${uniqueId}">
    <!-- Hidden download link for programmatic download -->
    <a id="download-link-${uniqueId}" href="${dataUrl}" download="${filename}" style="display: none;"></a>
    
    <div class="zeppelin-table-toolbar">
        <div class="zeppelin-table-info">
            <strong>${rowCount}</strong> rows × <strong>${colCount}</strong> columns
        </div>
        <div class="zeppelin-table-actions">
            <button class="zeppelin-table-btn" id="download-btn-${uniqueId}" title="Download as CSV file">
                <span class="btn-icon">↓</span>
                <span class="btn-text">Download CSV</span>
            </button>
            <button class="zeppelin-table-btn" id="copy-btn-${uniqueId}" title="Copy as CSV to clipboard">
                <span class="btn-icon">⎘</span>
                <span class="btn-text">Copy</span>
            </button>
        </div>
    </div>
    
    <div id="export-panel-${uniqueId}" class="csv-export-panel" style="display: none;">
        <div class="csv-export-header">
            <span class="csv-export-msg">
                <strong style="color: #27ae60;">CSV Data</strong> - Copy from textarea below or 
                <a href="${dataUrl}" download="${filename}" style="color: var(--vscode-textLink-foreground);">click here to download</a>
            </span>
            <button class="close-btn" id="close-panel-${uniqueId}">Close</button>
        </div>
        <textarea class="csv-export-textarea" id="csv-textarea-${uniqueId}" readonly>${escapeHtmlForTextarea(csvContent)}</textarea>
        <div class="csv-export-instructions">
            Click textarea to select all → Cmd/Ctrl+C to copy → paste into a new .csv file
        </div>
    </div>
    
    <div class="zeppelin-table-wrapper">
        <table class="zeppelin-table">
            <thead>
                <tr>
${headers.map(h => `                    <th>${escapeHtml(h)}</th>`).join('\n')}
                </tr>
            </thead>
            <tbody>
${rows.map(row => `                <tr>
${row.map(cell => `                    <td class="table-cell-with-copy" title="Click to expand/collapse, or click copy button to copy this cell" data-raw="${escapeHtmlAttr(cell)}">
                        <span class="cell-content">${escapeHtml(cell)}</span>
                        <button class="format-sql-btn" title="Format as SQL">Format</button>
                        <button class="cell-copy-btn" title="Copy this cell">📋</button>
                    </td>`).join('\n')}
                </tr>`).join('\n')}
            </tbody>
        </table>
    </div>
    
    <div class="zeppelin-table-footer">
        . Click cell to expand/collapse and copy individual cell value
    </div>
</div>

${renderTableScript(uniqueId, csvContent)}
`;

    return html;
}

/**
 * Generate CSV string from headers and rows
 */
function generateCSV(headers: string[], rows: string[][]): string {
    const escapeCSV = (str: string): string => {
        if (str == null) return '';
        const s = String(str);
        // Escape quotes and wrap in quotes if needed
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    
    const headerRow = headers.map(escapeCSV).join(',');
    const dataRows = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
    
    return headerRow + '\n' + dataRows;
}
