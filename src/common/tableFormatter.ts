import * as vscode from 'vscode';
import { TextEncoder } from 'util';

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

/**
 * Generate HTML table with enhanced formatting and download buttons
 * Uses data URL approach for reliable download in VS Code webviews
 */
export function formatTableAsHTML(tableData: TableData, tableId: string = 'table'): string {
    const { headers, rows } = tableData;
    const rowCount = rows.length;
    const colCount = headers.length;

    console.log('[Table Formatter] Formatting table:', { rowCount, colCount, headers: headers.slice(0, 5) });

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
<style>
    .zeppelin-table-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        margin: 10px 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border-radius: 4px;
        overflow: hidden;
    }
    
    .zeppelin-table-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: var(--vscode-input-background);
        border-bottom: 2px solid var(--vscode-panel-border);
        gap: 8px;
        flex-wrap: wrap;
    }
    
    .zeppelin-table-info {
        font-size: 13px;
        color: var(--vscode-foreground);
        font-weight: 500;
    }
    
    .zeppelin-table-info strong {
        color: var(--vscode-textLink-foreground);
        font-weight: 600;
    }
    
    .zeppelin-table-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    
    .zeppelin-table-btn {
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 400;
        background: transparent;
        color: var(--vscode-button-foreground);
        border: 1px solid var(--vscode-button-border);
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        min-width: 100px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        text-decoration: none;
    }
    
    .zeppelin-table-btn:hover {
        background: var(--vscode-button-hoverBackground);
        border-color: var(--vscode-button-hoverBackground);
    }
    
    .zeppelin-table-btn:active {
        opacity: 0.8;
    }
    
    .zeppelin-table-btn.success {
        background: #28a745;
        color: white;
        border-color: #28a745;
    }
    
    .zeppelin-table-btn.error {
        background: #dc3545;
        color: white;
        border-color: #dc3545;
    }
    
    .zeppelin-table-wrapper {
        overflow-x: auto;
        overflow-y: auto;
        max-height: 420px;
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .zeppelin-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        table-layout: auto;
    }
    
    .zeppelin-table thead {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--vscode-editor-background);
    }
    
    .zeppelin-table th {
        text-align: left !important;
        padding: 12px 16px;
        font-weight: 600;
        background: var(--vscode-input-background);
        border-bottom: 2px solid var(--vscode-panel-border);
        white-space: nowrap;
        color: var(--vscode-editor-foreground);
        vertical-align: middle;
    }
    
    .zeppelin-table td {
        text-align: left !important;
        padding: 10px 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
        max-width: 500px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        word-wrap: break-word;
        vertical-align: top;
        transition: all 0.2s ease;
        user-select: text;
        position: relative;
    }
    
    .zeppelin-table td .cell-content {
        display: block;
        cursor: pointer;
        min-height: 24px;
    }
    
    .zeppelin-table td:hover .cell-content {
        padding-right: 30px;
    }
    
    .zeppelin-table td .cell-copy-btn {
        display: none;
        position: absolute;
        top: 4px;
        right: 4px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 11px;
        cursor: pointer;
        z-index: 10;
        opacity: 0;
        transition: opacity 0.2s, background 0.2s;
        line-height: 1;
    }
    
    .zeppelin-table td .cell-copy-btn:hover {
        opacity: 1 !important;
        background: var(--vscode-button-hoverBackground);
    }
    
    .zeppelin-table td:hover .cell-copy-btn {
        display: inline-block;
        opacity: 0.85;
    }
    
    .zeppelin-table td.copied {
        background: #28a745 !important;
        color: white !important;
        transition: all 0.3s ease;
    }
    
    .zeppelin-table td.copied .cell-copy-btn {
        background: #28a745 !important;
        color: white !important;
    }
    
    .zeppelin-table td.expanded {
        white-space: pre-wrap !important;
        max-width: 800px !important;
        min-width: 300px !important;
        overflow: visible !important;
        background: var(--vscode-editor-background) !important;
        border: 2px solid var(--vscode-focusBorder) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 100;
        position: relative;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        padding: 8px 12px !important;
        word-break: break-word;
    }
    
    .zeppelin-table td.expanded .cell-content {
        display: block;
        max-height: 400px;
        overflow-y: auto;
        padding-right: 40px;
    }
    
    .zeppelin-table td.expanded .cell-content.formatted-sql {
        color: var(--vscode-editor-foreground);
    }
    
    .zeppelin-table td.expanded .cell-copy-btn {
        display: inline-block !important;
        opacity: 1 !important;
        top: 8px;
        right: 8px;
    }
    
    .zeppelin-table td.expanded .format-sql-btn {
        display: inline-block !important;
        position: absolute;
        top: 8px;
        right: 40px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 3px;
        padding: 2px 6px;
        font-size: 10px;
        cursor: pointer;
        z-index: 11;
    }
    
    .format-sql-btn {
        display: none;
    }
    
    .zeppelin-table td:hover:not(.expanded) {
        background: var(--vscode-list-hoverBackground);
        transition: background 0.1s ease;
        outline: 1px solid var(--vscode-focusBorder);
    }
    
    .zeppelin-table tbody tr:hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .zeppelin-table tbody tr:nth-child(even) {
        background: rgba(128, 128, 128, 0.05);
    }
    
    .zeppelin-table tbody tr:nth-child(even):hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .zeppelin-table-footer {
        padding: 8px 12px;
        background: var(--vscode-input-background);
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-align: right;
    }
    
    .csv-export-panel {
        background: var(--vscode-input-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        padding: 12px;
    }
    
    .csv-export-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }
    
    .csv-export-msg {
        font-size: 12px;
        color: var(--vscode-foreground);
    }
    
    .csv-export-textarea {
        width: 100%;
        height: 100px;
        font-family: monospace;
        font-size: 11px;
        padding: 8px;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        resize: vertical;
        box-sizing: border-box;
    }
    
    .csv-export-instructions {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 8px;
    }
    
    .close-btn {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        padding: 4px 12px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
    }
</style>

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

<script>
(function() {
    var uniqueId = '${uniqueId}';
    var csvContent = ${JSON.stringify(csvContent)};
    
    // Get elements
    var downloadBtn = document.getElementById('download-btn-' + uniqueId);
    var downloadLink = document.getElementById('download-link-' + uniqueId);
    var copyBtn = document.getElementById('copy-btn-' + uniqueId);
    var exportPanel = document.getElementById('export-panel-' + uniqueId);
    var closeBtn = document.getElementById('close-panel-' + uniqueId);
    var csvTextarea = document.getElementById('csv-textarea-' + uniqueId);
    
    // Download CSV - directly trigger the hidden download link
    if (downloadBtn && downloadLink) {
        downloadBtn.addEventListener('click', function() {
            var originalHTML = downloadBtn.innerHTML;
            var originalClass = downloadBtn.className;
            
            // Trigger the download by clicking the hidden link
            try {
                downloadLink.click();
                
                // Show success feedback
                downloadBtn.className = 'zeppelin-table-btn success';
                downloadBtn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Downloaded!</span>';
                
                setTimeout(function() {
                    downloadBtn.className = originalClass;
                    downloadBtn.innerHTML = originalHTML;
                }, 2000);
            } catch (err) {
                console.log('[CSV] Download failed:', err);
                // Fallback: show the export panel
                downloadBtn.className = 'zeppelin-table-btn error';
                downloadBtn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Failed</span>';
                exportPanel.style.display = 'block';
                csvTextarea.focus();
                csvTextarea.select();
                
                setTimeout(function() {
                    downloadBtn.className = originalClass;
                    downloadBtn.innerHTML = originalHTML;
                }, 2000);
            }
        });
    }
    
    // Close panel
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            exportPanel.style.display = 'none';
        });
    }
    
    // Auto-select textarea content on focus/click
    if (csvTextarea) {
        csvTextarea.addEventListener('focus', function() {
            this.select();
        });
        csvTextarea.addEventListener('click', function() {
            this.select();
        });
    }
    
    // Copy to clipboard function with multiple fallbacks
    function copyToClipboard(text, btn) {
        var originalHTML = btn.innerHTML;
        var originalClass = btn.className;
        
        function showSuccess() {
            btn.className = 'zeppelin-table-btn success';
            btn.innerHTML = '<span class="btn-icon">✓</span><span class="btn-text">Copied!</span>';
            setTimeout(function() {
                btn.className = originalClass;
                btn.innerHTML = originalHTML;
            }, 2000);
        }
        
        function showError() {
            btn.className = 'zeppelin-table-btn error';
            btn.innerHTML = '<span class="btn-icon">✗</span><span class="btn-text">Failed</span>';
            // Show the export panel as fallback
            exportPanel.style.display = 'block';
            csvTextarea.focus();
            csvTextarea.select();
            setTimeout(function() {
                btn.className = originalClass;
                btn.innerHTML = originalHTML;
            }, 2000);
        }
        
        // Method 1: Modern Clipboard API
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text)
                .then(function() {
                    showSuccess();
                })
                .catch(function(err) {
                    console.log('[CSV] Clipboard API failed, trying fallback:', err);
                    tryExecCommand();
                });
        } else {
            tryExecCommand();
        }
        
        // Method 2: execCommand fallback
        function tryExecCommand() {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            
            var success = false;
            try {
                success = document.execCommand('copy');
            } catch (err) {
                console.log('[CSV] execCommand error:', err);
            }
            
            document.body.removeChild(textarea);
            
            if (success) {
                showSuccess();
            } else {
                showError();
            }
        }
    }
    
    // Copy button handler
    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            copyToClipboard(csvContent, copyBtn);
        });
    }
    
    // Individual cell copy functionality
    var container = document.getElementById(uniqueId);
    if (container) {
        // Get all table cells
        var tableCells = container.querySelectorAll('.table-cell-with-copy');
        
        tableCells.forEach(function(cell) {
            var copyButton = cell.querySelector('.cell-copy-btn');
            var formatButton = cell.querySelector('.format-sql-btn');
            var cellContent = cell.querySelector('.cell-content');
            
            // Store original content for reset
            var originalContent = cellContent.innerHTML;
            
            // Handle cell click for expand/collapse (on the cell itself)
            cell.addEventListener('click', function(e) {
                // Don't toggle if clicking on buttons
                if (e.target.classList.contains('cell-copy-btn') || 
                    e.target.classList.contains('format-sql-btn')) {
                    return;
                }
                
                var isExpanded = cell.classList.contains('expanded');
                
                if (isExpanded) {
                    // Collapsing - reset to original content
                    cell.classList.remove('expanded');
                    cellContent.innerHTML = originalContent;
                    cellContent.classList.remove('formatted-sql');
                    
                    // Reset format button
                    var formatBtn = cell.querySelector('.format-sql-btn');
                    if (formatBtn) {
                        formatBtn.textContent = 'Format';
                        formatBtn.disabled = false;
                    }
                } else {
                    // Expanding
                    cell.classList.add('expanded');
                }
            });
            
            // Handle copy button click
            if (copyButton) {
                copyButton.addEventListener('click', function(e) {
                    e.stopPropagation();
                    
                    // Get the raw text from data attribute (original unformatted value)
                    var textToCopy = cell.getAttribute('data-raw') || cellContent.textContent || '';
                    
                    // Copy to clipboard
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                        navigator.clipboard.writeText(textToCopy)
                            .then(function() {
                                showCellCopyFeedback(cell, true);
                            })
                            .catch(function() {
                                fallbackCopy(textToCopy, cell);
                            });
                    } else {
                        fallbackCopy(textToCopy, cell);
                    }
                });
            }
            
        });
    }
    
    // Fallback copy method for individual cells
    function fallbackCopy(text, cell) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        
        try {
            var success = document.execCommand('copy');
            showCellCopyFeedback(cell, success);
        } catch (err) {
            showCellCopyFeedback(cell, false);
        }
        
        document.body.removeChild(textarea);
    }
    
    // Show visual feedback when cell is copied
    function showCellCopyFeedback(cell, success) {
        if (success) {
            var originalBg = cell.style.background;
            cell.classList.add('copied');
            
            setTimeout(function() {
                cell.classList.remove('copied');
            }, 800);
        } else {
            alert('Failed to copy cell content. Please select and copy manually.');
        }
    }
    
    // SQL formatting function
    function formatSQL(text) {
        if (!text) return text;
        
        var formatted = text;
        
        // Add newlines before major SQL keywords
        var keywords = [
            'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 
            'INNER JOIN', 'OUTER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 
            'LIMIT', 'OFFSET', 'UNION', 'INSERT', 'UPDATE', 'DELETE', 'SET',
            'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE VIEW',
            'USING', 'PARTITIONED BY', 'LOCATION', 'TBLPROPERTIES', 'WITH'
        ];
        
        // Sort by length (longest first) to avoid partial matches
        keywords.sort(function(a, b) { return b.length - a.length; });
        
        keywords.forEach(function(kw) {
            var regex = new RegExp('\\\\s+(' + kw + ')\\\\b', 'gi');
            formatted = formatted.replace(regex, '\\n$1');
        });
        
        // Add newlines after commas in SELECT clause (but not inside parentheses)
        var inParen = 0;
        var result = '';
        for (var i = 0; i < formatted.length; i++) {
            var char = formatted[i];
            if (char === '(') inParen++;
            else if (char === ')') inParen--;
            
            result += char;
            
            // Add newline after comma if not in parentheses
            if (char === ',' && inParen === 0) {
                result += '\\n  ';
            }
        }
        formatted = result;
        
        // Add indentation for better readability
        var lines = formatted.split('\\n');
        var indentLevel = 0;
        formatted = lines.map(function(line) {
            var trimmed = line.trim();
            
            // Decrease indent for closing keywords
            if (trimmed.match(/^(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|\\))/i)) {
                indentLevel = Math.max(0, indentLevel - 1);
            }
            
            var indent = '  '.repeat(indentLevel);
            
            // Increase indent after opening keywords
            if (trimmed.match(/^(SELECT|FROM|WHERE|\\()/i)) {
                indentLevel++;
            }
            
            return indent + trimmed;
        }).join('\\n');
        
        return formatted;
    }
    
    // Handle format button clicks
    var formatButtons = container.querySelectorAll('.format-sql-btn');
    formatButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            
            var cell = btn.closest('.table-cell-with-copy');
            var cellContent = cell.querySelector('.cell-content');
            var rawText = cell.getAttribute('data-raw') || cellContent.textContent;
            
            // Format the SQL
            var formattedSQL = formatSQL(rawText);
            
            // Update the display
            cellContent.innerHTML = '<pre style="margin:0;white-space:pre-wrap;font-family:inherit;">' + 
                formattedSQL.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
            cellContent.classList.add('formatted-sql');
            
            // Expand the cell if not already expanded
            if (!cell.classList.contains('expanded')) {
                cell.classList.add('expanded');
            }
            
            // Change button text
            btn.textContent = 'Formatted';
            btn.disabled = true;
        });
    });
})();
</script>
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

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
    if (text == null || text === undefined) {
        return '<span style="color: var(--vscode-disabledForeground); font-style: italic;">null</span>';
    }
    
    if (text === '') {
        return '<span style="color: var(--vscode-disabledForeground); font-style: italic;">empty</span>';
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

/**
 * Escape text for HTML attribute values
 */
function escapeHtmlAttr(text: string): string {
    if (text == null || text === undefined) {
        return '';
    }
    
    const str = String(text);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '&#10;')
        .replace(/\r/g, '&#13;');
}

/**
 * Escape text for embedding in a textarea (less strict than full HTML escaping)
 */
function escapeHtmlForTextarea(text: string): string {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Detect Spark DataFrame schema format: DataFrame[col1: type1, col2: type2, ...]
 */
export function isDataFrameSchema(data: string): boolean {
    if (!data || typeof data !== 'string') {
        return false;
    }
    const trimmed = data.trim();
    // Match DataFrame[...] pattern - must be a complete schema on a single logical line
    // This ensures we don't match partial lines when split by newlines
    return trimmed.startsWith('DataFrame[') && trimmed.endsWith(']') && !trimmed.includes('\n');
}

/**
 * Parse Spark DataFrame schema string into table data (Column, Type).
 * Handles types that contain commas/brackets (e.g. array<string>, map<a,b>, struct<...>).
 */
export function parseDataFrameSchema(data: string): TableData | null {
    if (!data || typeof data !== 'string') {
        return null;
    }
    const trimmed = data.trim();
    if (!trimmed.startsWith('DataFrame[')) {
        return null;
    }
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    const inner = trimmed.slice(start + 1, end).trim();
    if (!inner) {
        return null;
    }

    // Split by comma only at top level (bracket depth 0) so types like map<string,int> stay intact
    const parts: string[] = [];
    let depth = 0;
    let partStart = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '[' || c === '<' || c === '(') {
            depth++;
        } else if (c === ']' || c === '>' || c === ')') {
            depth--;
        } else if (c === ',' && depth === 0) {
            parts.push(inner.slice(partStart, i).trim());
            partStart = i + 1;
        }
    }
    parts.push(inner.slice(partStart).trim());

    const rows: string[][] = [];
    for (const part of parts) {
        const colonIdx = part.indexOf(':');
        if (colonIdx === -1) continue;
        const colName = part.slice(0, colonIdx).trim();
        const colType = part.slice(colonIdx + 1).trim();
        if (colName && colType) {
            rows.push([colName, colType]);
        }
    }
    if (rows.length === 0) {
        return null;
    }
    return { headers: ['Column', 'Type'], rows };
}

/**
 * Detect if string is a Python Spark DataFrame string representation.
 * Matches patterns like:
 * +-----+-----+
 * |col1 |col2 |
 * +-----+-----+
 * |val1 |val2 |
 * +-----+-----+
 */
/**
 * Check if data is a single PySpark Row object (not in a list)
 * Format: Row(field1=value1, field2=value2)
 */
export function isSinglePySparkRow(data: string): boolean {
    if (!data || typeof data !== 'string') {
        return false;
    }
    const trimmed = data.trim();
    // Single Row: starts with Row( and ends with ), no leading [
    return trimmed.startsWith('Row(') && trimmed.endsWith(')') && !trimmed.startsWith('[');
}

/**
 * Check if data is PySpark Row collection format (from print(df.collect()))
 * Format: [Row(field1=value1, field2=value2), Row(...), ...]
 */
export function isPySparkRowCollection(data: string): boolean {
    if (!data || typeof data !== 'string') {
        return false;
    }
    const trimmed = data.trim();
    // Match pattern: starts with [ and contains Row( pattern
    return trimmed.startsWith('[Row(') && trimmed.includes(')]');
}

/**
 * Format a single Row or Row collection as simple key-value list
 * Universal handler for all Row formats
 */
export function formatPySparkRowSimple(data: string): string | null {
    if (!data) return null;
    
    const trimmed = data.trim();
    let content = trimmed;
    
    // Remove outer brackets if it's a collection
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        content = trimmed.slice(1, -1).trim();
    }
    
    // Extract Row(...) pattern
    const rowMatch = content.match(/^Row\(([\s\S]*)\)$/);
    if (!rowMatch) return null;
    
    const fieldsStr = rowMatch[1];
    const fields = parseRowFields(fieldsStr);
    
    if (fields.length === 0) return null;
    
    const uniqueId = `row-simple-${Date.now()}`;
    
    // Create simple list of key-value pairs
    const fieldsList = fields.map(([key, value]) => {
        const escapedKey = escapeHtml(key);
        const escapedValue = escapeHtml(value);
        return `
            <div style="display: grid; grid-template-columns: 200px 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border);">
                <div style="font-weight: 600; color: var(--vscode-textLink-foreground); font-size: 11px;">${escapedKey}</div>
                <div style="font-family: monospace; font-size: 11px; word-break: break-all; color: var(--vscode-editor-foreground);">${escapedValue}</div>
            </div>`;
    }).join('');
    
    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; margin: 10px 0; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; background: var(--vscode-editor-background);" id="${uniqueId}">
    <div style="padding: 8px 12px; background: var(--vscode-input-background); border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; font-size: 12px; color: var(--vscode-textLink-foreground);">
        Row Object • ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}
    </div>
    <div style="padding: 12px; max-height: 400px; overflow-y: auto;">
        ${fieldsList}
    </div>
</div>`;
}

/**
 * Parse PySpark Row collection into structured table data
 * Handles: [Row(id=1, name='shashank'), Row(id=2, name='test')]
 * For large collections (>10 rows), only parses first 10 for performance
 */
export function parsePySparkRowCollection(data: string): TableData | null {
    if (!isPySparkRowCollection(data)) {
        return null;
    }

    try {
        const trimmed = data.trim();
        // Remove outer brackets
        let content = trimmed.slice(1, -1).trim();
        
        // Quick row count estimate
        const rowCount = (content.match(/Row\(/g) || []).length;
        const shouldLimit = rowCount > 10;
        
        // Split by Row( to get individual rows
        const rowStrings: string[] = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = '';
        let rowsParsed = 0;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const prevChar = i > 0 ? content[i - 1] : '';
            
            // Track string context
            if ((char === '"' || char === "'") && prevChar !== '\\') {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                }
            }
            
            if (!inString) {
                if (char === '(') depth++;
                if (char === ')') depth--;
                
                // When we close a Row(...) at depth 0, we have a complete row
                if (char === ')' && depth === 0) {
                    current += char;
                    rowStrings.push(current.trim());
                    rowsParsed++;
                    current = '';
                    
                    // Stop parsing if we have enough rows for preview
                    if (shouldLimit && rowsParsed >= 10) {
                        break;
                    }
                    
                    // Skip comma and space after row
                    if (i + 1 < content.length && content[i + 1] === ',') i++;
                    if (i + 1 < content.length && content[i + 1] === ' ') i++;
                    continue;
                }
            }
            
            current += char;
        }
        
        if (current.trim() && rowsParsed < 10) {
            rowStrings.push(current.trim());
        }
        
        // Parse each row
        const rows: string[][] = [];
        const headerSet = new Set<string>();
        
        for (const rowStr of rowStrings) {
            // Extract content between Row( and )
            const match = rowStr.match(/^Row\((.*)\)$/);
            if (!match) continue;
            
            const fieldsStr = match[1];
            const fields = parseRowFields(fieldsStr);
            
            // Collect headers
            for (const [key] of fields) {
                headerSet.add(key);
            }
        }
        
        const headers = Array.from(headerSet);
        
        // Now parse rows with all headers
        for (const rowStr of rowStrings) {
            const match = rowStr.match(/^Row\((.*)\)$/);
            if (!match) continue;
            
            const fieldsStr = match[1];
            const fields = parseRowFields(fieldsStr);
            const fieldMap = new Map(fields);
            
            const row: string[] = headers.map(h => {
                const val = fieldMap.get(h);
                return val !== undefined ? val : '';
            });
            
            rows.push(row);
        }
        
        if (rows.length === 0 || headers.length === 0) {
            return null;
        }
        
        return { headers, rows };
        
    } catch (error) {
        console.error('Failed to parse PySpark Row collection:', error);
        return null;
    }
}

/**
 * Parse field=value pairs from Row content
 * Handles: id=1, name='shashank', data=datetime.date(2024, 3, 14)
 */
function parseRowFields(fieldsStr: string): [string, string][] {
    const fields: [string, string][] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let currentKey = '';
    
    for (let i = 0; i < fieldsStr.length; i++) {
        const char = fieldsStr[i];
        const prevChar = i > 0 ? fieldsStr[i - 1] : '';
        
        // Track string context
        if ((char === '"' || char === "'") && prevChar !== '\\') {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar) {
                inString = false;
            }
        }
        
        if (!inString) {
            if (char === '(' || char === '[') depth++;
            if (char === ')' || char === ']') depth--;
            
            // Found field separator at depth 0
            if (char === '=' && depth === 0 && !currentKey) {
                currentKey = current.trim();
                current = '';
                continue;
            }
            
            // Found value separator at depth 0
            if (char === ',' && depth === 0 && currentKey) {
                fields.push([currentKey, current.trim()]);
                currentKey = '';
                current = '';
                continue;
            }
        }
        
        current += char;
    }
    
    // Push last field
    if (currentKey && current.trim()) {
        fields.push([currentKey, current.trim()]);
    }
    
    return fields;
}

export function isPythonSparkDataFrame(data: string): boolean {
    if (!data || typeof data !== 'string') {
        return false;
    }

    const trimmed = data.trim();
    const lines = trimmed.split('\n').filter(line => line.trim());
    
    if (lines.length < 3) {
        return false;
    }

    // Find the first line that looks like a separator (could be after some metadata)
    let separatorIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i].trim();
        if (line.startsWith('+') && line.includes('-') && line.includes('+')) {
            separatorIdx = i;
            break;
        }
    }

    if (separatorIdx === -1 || separatorIdx + 2 >= lines.length) {
        return false;
    }

    // Check if line after separator starts with | (column headers)
    const headerLine = lines[separatorIdx + 1].trim();
    if (!headerLine.startsWith('|') || !headerLine.endsWith('|')) {
        return false;
    }

    // Check if line after header is also a separator
    const secondSeparator = lines[separatorIdx + 2].trim();
    if (!secondSeparator.startsWith('+') || !secondSeparator.includes('-')) {
        return false;
    }

    return true;
}

/**
 * Parse Python Spark DataFrame string representation into table data.
 * Handles PySpark .show() output format with proper column splitting.
 */
export function parsePythonSparkDataFrame(data: string): TableData | null {
    if (!data || typeof data !== 'string') {
        return null;
    }

    const trimmed = data.trim();
    const lines = trimmed.split('\n');

    console.log('[PySpark Parser] Total lines:', lines.length);
    console.log('[PySpark Parser] First line sample:', lines[0]?.substring(0, 200));
    console.log('[PySpark Parser] Second line sample:', lines[1]?.substring(0, 200));

    if (lines.length < 4) {
        console.log('[PySpark Parser] Not enough lines');
        return null;
    }

    // Find first separator line (skip any metadata at top)
    let firstSeparatorIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        const trimmedLine = line?.trim();
        console.log(`[PySpark Parser] Line ${i} check:`, {
            startsWithPlus: trimmedLine?.startsWith('+'),
            includesDash: trimmedLine?.includes('-'),
            matchesPattern: trimmedLine?.match(/^\+[-+]+\+$/) !== null,
            linePreview: trimmedLine?.substring(0, 100)
        });
        
        if (trimmedLine && trimmedLine.match(/^\+[-+]+\+$/)) {
            firstSeparatorIdx = i;
            console.log('[PySpark Parser] Found separator at line:', i);
            break;
        }
    }

    if (firstSeparatorIdx === -1 || firstSeparatorIdx + 2 >= lines.length) {
        console.log('[PySpark Parser] No separator found or not enough lines after separator');
        return null;
    }

    // Header should be right after first separator
    const headerLineIdx = firstSeparatorIdx + 1;
    const headerLine = lines[headerLineIdx];
    
    console.log('[PySpark Parser] Header line preview:', headerLine?.substring(0, 300));
    console.log('[PySpark Parser] Header line length:', headerLine?.length);
    
    if (!headerLine || !headerLine.includes('|')) {
        console.log('[PySpark Parser] No header line or missing pipes');
        return null;
    }

    // Count pipes in header
    const pipeCount = (headerLine.match(/\|/g) || []).length;
    console.log('[PySpark Parser] Pipe count in header:', pipeCount);

    // Simple approach: split by | and filter empty
    const rawHeaders = headerLine.split('|');
    console.log('[PySpark Parser] Raw headers length:', rawHeaders.length);
    console.log('[PySpark Parser] Raw headers sample:', rawHeaders.slice(0, 10));
    
    const headers = rawHeaders
        .slice(1, -1) // Remove first and last empty elements
        .map(h => h.trim())
        .filter(h => h.length > 0);

    console.log('[PySpark Parser] Final headers:', headers.length, headers.slice(0, 10));

    if (headers.length === 0) {
        console.log('[PySpark Parser] No headers after filtering');
        return null;
    }

    // Parse data rows (start after second separator)
    const rows: string[][] = [];
    const dataStartIdx = firstSeparatorIdx + 3;
    
    for (let i = dataStartIdx; i < lines.length; i++) {
        const line = lines[i];
        
        if (!line || line.trim().length === 0) {
            continue;
        }
        
        // Stop at final separator
        if (line.trim().match(/^\+[-+]+\+$/)) {
            break;
        }

        // Skip metadata messages
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('only showing') || lowerLine.includes('row(s)')) {
            continue;
        }

        // Parse data row - must contain |
        if (line.includes('|')) {
            const rawCells = line.split('|');
            const cells = rawCells
                .slice(1, -1) // Remove first and last empty elements
                .map(cell => cell.trim());
            
            // Ensure row has same number of columns as header
            while (cells.length < headers.length) {
                cells.push('');
            }
            if (cells.length > headers.length) {
                cells.length = headers.length;
            }
            
            if (cells.length === headers.length) {
                rows.push(cells);
            }
        }
    }

    console.log('[PySpark Parser] Final result - rows:', rows.length, 'columns:', headers.length);

    if (rows.length === 0) {
        console.log('[PySpark Parser] No data rows found');
        return null;
    }

    return { headers, rows };
}

/**
 * Format Python Spark DataFrame as expandable card view (better for wide tables)
 */
export function formatPySparkAsCards(data: string, preComputedTableData?: TableData): string | null {
    const tableData = preComputedTableData || parsePythonSparkDataFrame(data);
    if (!tableData) {
        return null;
    }

    const { headers, rows } = tableData;
    const uniqueId = `pyspark-cards-${Date.now()}`;
    
    // Check if this is a Row collection that was truncated
    const isRowCollection = isPySparkRowCollection(data);
    const actualRowCount = isRowCollection ? (data.match(/Row\(/g) || []).length : rows.length;
    const isTruncated = isRowCollection && actualRowCount > rows.length;
    
    // Generate card HTML for each row
    const cardsHtml = rows.map((row, rowIdx) => {
        const rowId = `${uniqueId}-row-${rowIdx}`;
        
        // Create key-value pairs for the expanded card body
        const fields = headers.map((header, colIdx) => {
            const value = row[colIdx] || '';
            const escapedValue = escapeHtml(value);
            const escapedHeader = escapeHtml(header);
            
            return `
                <div class="card-field">
                    <div class="field-label">${escapedHeader}</div>
                    <div class="field-value" title="${escapeHtmlAttr(value)}">
                        ${escapedValue}
                        <button class="field-copy-btn" data-value="${escapeHtmlAttr(value)}" title="Copy value">📋</button>
                    </div>
                </div>`;
        }).join('');
        
        // Create a horizontally scrollable preview showing ALL columns
        const previewItems = headers.map((header, idx) => {
            const value = row[idx] || 'null';
            return `
                <span class="preview-item">
                    <strong>${escapeHtml(header)}</strong>: ${escapeHtml(value)}
                </span>`;
        }).join('');
        
        return `
            <div class="data-card collapsed" id="${rowId}">
                <div class="card-header" onclick="toggleCard('${rowId}')">
                    <span class="card-toggle">▶</span>
                    <span class="card-number">Row ${rowIdx + 1}</span>
                    <div class="card-preview-scroll">
                        ${previewItems}
                    </div>
                    <span class="card-actions">
                        <button class="card-action-btn" onclick="event.stopPropagation(); copyRow('${rowId}')" title="Copy entire row">Copy</button>
                    </span>
                </div>
                <div class="card-body">
                    ${fields}
                </div>
            </div>`;
    }).join('');

    const html = `
<style>
    .pyspark-cards-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        margin: 10px 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--vscode-panel-border);
    }
    
    .pyspark-cards-container.main-collapsed .cards-wrapper {
        display: none;
    }
    
    .pyspark-cards-container.main-collapsed .cards-footer {
        display: none;
    }
    
    .pyspark-cards-container.main-collapsed .cards-toolbar {
        border-bottom: none;
    }
    
    .cards-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: var(--vscode-input-background);
        border-bottom: 2px solid var(--vscode-panel-border);
        cursor: pointer;
        user-select: none;
    }
    
    .cards-toolbar:hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .cards-info {
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .main-toggle {
        font-size: 10px;
        transition: transform 0.2s ease;
        display: inline-block;
        flex-shrink: 0;
    }
    
    .pyspark-cards-container:not(.main-collapsed) .main-toggle {
        transform: rotate(90deg);
    }
    
    .cards-info strong {
        color: var(--vscode-textLink-foreground);
        font-weight: 600;
    }
    
    .cards-actions {
        display: flex;
        gap: 8px;
    }
    
    .toolbar-btn {
        padding: 4px 10px;
        font-size: 11px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .toolbar-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    
    .cards-wrapper {
        max-height: 600px;
        overflow-y: auto;
        padding: 10px;
    }
    
    .data-card {
        margin-bottom: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        background: var(--vscode-editor-background);
        transition: all 0.2s ease;
    }
    
    .data-card:hover {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    .card-header {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--vscode-input-background);
        border-bottom: 1px solid transparent;
        transition: all 0.2s ease;
        gap: 10px;
    }
    
    .card-header:hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .card-toggle {
        font-size: 10px;
        transition: transform 0.2s ease;
        display: inline-block;
        min-width: 15px;
        flex-shrink: 0;
    }
    
    .data-card:not(.collapsed) .card-toggle {
        transform: rotate(90deg);
    }
    
    .card-number {
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-textLink-foreground);
        min-width: 60px;
        flex-shrink: 0;
    }
    
    .card-preview-scroll {
        flex: 1;
        display: flex;
        gap: 20px;
        overflow-x: auto;
        overflow-y: hidden;
        white-space: nowrap;
        padding: 4px 0;
        scrollbar-width: thin;
        scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
    }
    
    .card-preview-scroll::-webkit-scrollbar {
        height: 6px;
    }
    
    .card-preview-scroll::-webkit-scrollbar-track {
        background: transparent;
    }
    
    .card-preview-scroll::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
    }
    
    .card-preview-scroll::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
    }
    
    .preview-item {
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        padding: 2px 8px;
        background: var(--vscode-editor-background);
        border-radius: 3px;
        border: 1px solid var(--vscode-panel-border);
        flex-shrink: 0;
    }
    
    .preview-item strong {
        color: var(--vscode-textLink-foreground);
        margin-right: 4px;
    }
    
    .card-actions {
        flex-shrink: 0;
    }
    
    .card-action-btn {
        padding: 3px 8px;
        font-size: 10px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 3px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;
    }
    
    .card-header:hover .card-action-btn {
        opacity: 1;
    }
    
    .card-action-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    
    .card-body {
        display: none;
        padding: 12px;
        max-height: 400px;
        overflow-y: auto;
        border-top: 1px solid var(--vscode-panel-border);
    }
    
    .data-card:not(.collapsed) .card-body {
        display: block;
    }
    
    .card-field {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .card-field:last-child {
        border-bottom: none;
    }
    
    .field-label {
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-textLink-foreground);
        word-break: break-word;
    }
    
    .field-value {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
        font-size: 12px;
        word-break: break-all;
        position: relative;
        padding-right: 30px;
    }
    
    .field-copy-btn {
        position: absolute;
        right: 0;
        top: 0;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 3px;
        padding: 2px 6px;
        font-size: 10px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;
    }
    
    .field-value:hover .field-copy-btn {
        opacity: 1;
    }
    
    .field-copy-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    
    .cards-footer {
        padding: 8px 12px;
        background: var(--vscode-input-background);
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
    }
</style>

<div class="pyspark-cards-container main-collapsed" id="${uniqueId}">
    <div class="cards-toolbar" onclick="toggleMainContainer('${uniqueId}')">
        <div class="cards-info">
            <span class="main-toggle">▶</span>
            <span><strong>${rows.length}</strong>${isTruncated ? ` of ${actualRowCount}` : ''} rows × <strong>${headers.length}</strong> columns${isTruncated ? ' <span style="color: var(--vscode-errorForeground);">(showing first 10 for performance)</span>' : ''}</span>
        </div>
        <div class="cards-actions" onclick="event.stopPropagation()">
            <button class="toolbar-btn" onclick="expandAllCards('${uniqueId}')">Expand All Rows</button>
            <button class="toolbar-btn" onclick="collapseAllCards('${uniqueId}')">Collapse All Rows</button>
            <button class="toolbar-btn" onclick="copyAllData('${uniqueId}')">Copy All CSV</button>
        </div>
    </div>
    
    <div class="cards-wrapper">
        ${cardsHtml}
    </div>
    
    <div class="cards-footer">
        Scroll horizontally to see all columns • Click any row to expand for vertical view • Use copy buttons for data
    </div>
</div>

<script>
(function() {
    var uniqueId = '${uniqueId}';
    var tableData = ${JSON.stringify({ headers, rows })};
    
    window.toggleMainContainer = function(containerId) {
        var container = document.getElementById(containerId);
        if (container) {
            container.classList.toggle('main-collapsed');
        }
    };
    
    window.toggleCard = function(cardId) {
        var card = document.getElementById(cardId);
        if (card) {
            card.classList.toggle('collapsed');
        }
    };
    
    window.expandAllCards = function(containerId) {
        var container = document.getElementById(containerId);
        var cards = container.querySelectorAll('.data-card');
        cards.forEach(function(card) {
            card.classList.remove('collapsed');
        });
    };
    
    window.collapseAllCards = function(containerId) {
        var container = document.getElementById(containerId);
        var cards = container.querySelectorAll('.data-card');
        cards.forEach(function(card) {
            card.classList.add('collapsed');
        });
    };
    
    window.copyRow = function(cardId) {
        var card = document.getElementById(cardId);
        var rowIdx = parseInt(cardId.split('-row-')[1]);
        var row = tableData.rows[rowIdx];
        
        var text = tableData.headers.map(function(h, i) {
            return h + ': ' + (row[i] || '');
        }).join('\\n');
        
        copyToClipboard(text);
    };
    
    window.copyAllData = function(containerId) {
        var csv = tableData.headers.join(',') + '\\n';
        csv += tableData.rows.map(function(row) {
            return row.map(function(cell) {
                var s = String(cell || '');
                if (s.includes(',') || s.includes('"') || s.includes('\\n')) {
                    return '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
            }).join(',');
        }).join('\\n');
        
        copyToClipboard(csv);
    };
    
    function copyToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(function() {
                console.log('Copied to clipboard');
            }).catch(function(err) {
                console.error('Copy failed:', err);
            });
        } else {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;top:0;left:0;';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Copy failed:', err);
            }
            document.body.removeChild(textarea);
        }
    }
    
    // Handle field copy buttons
    var container = document.getElementById(uniqueId);
    container.addEventListener('click', function(e) {
        if (e.target.classList.contains('field-copy-btn')) {
            var value = e.target.getAttribute('data-value');
            copyToClipboard(value);
        }
    });
})();
</script>`;

    return html;
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
 * Format table data for notebook output (returns NotebookCellOutputItem)
 */
export function formatTableOutput(
    data: string,
    tableId: string = 'table'
): vscode.NotebookCellOutputItem | null {
    const tableData = parseTableData(data);
    
    if (!tableData) {
        return null;
    }
    
    const html = formatTableAsHTML(tableData, tableId);
    const encoder = new TextEncoder();
    
    return new vscode.NotebookCellOutputItem(
        encoder.encode(html),
        'text/html'
    );
}

/**
 * Format DataFrame schema using the same card-based UI as PySpark tables
 */
export function formatDataFrameSchemaAsCard(data: string): string | null {
    const tableData = parseDataFrameSchema(data);
    if (!tableData) {
        return null;
    }

    const { headers, rows } = tableData;
    const uniqueId = `df-schema-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create individual cards for each column (similar to data rows)
    const columnCards = rows.map(([colName, colType], idx) => {
        return `
            <div class="data-card collapsed" id="${uniqueId}-col-${idx}">
                <div class="card-header" onclick="toggleSchemaCard('${uniqueId}-col-${idx}')">
                    <span class="card-toggle">▶</span>
                    <span class="card-number">Column ${idx + 1}</span>
                    <div class="card-preview-scroll">
                        <span class="preview-item">
                            <strong>Name:</strong> ${escapeHtml(colName)}
                        </span>
                        <span class="preview-item">
                            <strong>Type:</strong> ${escapeHtml(colType)}
                        </span>
                    </div>
                </div>
                <div class="card-body">
                    <div class="card-field">
                        <div class="field-label">Column Name</div>
                        <div class="field-value" title="${escapeHtml(colName)}">
                            ${escapeHtml(colName)}
                            <button class="field-copy-btn" data-value="${escapeHtml(colName)}" title="Copy value">📋</button>
                        </div>
                    </div>
                    <div class="card-field">
                        <div class="field-label">Data Type</div>
                        <div class="field-value" title="${escapeHtml(colType)}">
                            ${escapeHtml(colType)}
                            <button class="field-copy-btn" data-value="${escapeHtml(colType)}" title="Copy value">📋</button>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    const html = `
<style>
    .pyspark-cards-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        margin: 10px 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--vscode-panel-border);
    }
    
    .pyspark-cards-container.main-collapsed .cards-wrapper {
        display: none;
    }
    
    .pyspark-cards-container.main-collapsed .cards-footer {
        display: none;
    }
    
    .pyspark-cards-container.main-collapsed .cards-toolbar {
        border-bottom: none;
    }
    
    .cards-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: var(--vscode-input-background);
        border-bottom: 2px solid var(--vscode-panel-border);
        cursor: pointer;
        user-select: none;
    }
    
    .cards-toolbar:hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .cards-info {
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .main-toggle {
        font-size: 10px;
        transition: transform 0.2s ease;
        display: inline-block;
        flex-shrink: 0;
    }
    
    .pyspark-cards-container:not(.main-collapsed) .main-toggle {
        transform: rotate(90deg);
    }
    
    .cards-info strong {
        color: var(--vscode-textLink-foreground);
        font-weight: 600;
    }
    
    .cards-actions {
        display: flex;
        gap: 8px;
    }
    
    .toolbar-btn {
        padding: 4px 10px;
        font-size: 11px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .toolbar-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    
    .cards-wrapper {
        max-height: 600px;
        overflow-y: auto;
        padding: 10px;
    }
    
    .data-card {
        margin-bottom: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        background: var(--vscode-editor-background);
        transition: all 0.2s ease;
    }
    
    .data-card:hover {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    .card-header {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--vscode-input-background);
        border-bottom: 1px solid transparent;
        transition: all 0.2s ease;
        gap: 10px;
    }
    
    .card-header:hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .card-toggle {
        font-size: 10px;
        transition: transform 0.2s ease;
        display: inline-block;
        min-width: 15px;
        flex-shrink: 0;
    }
    
    .data-card:not(.collapsed) .card-toggle {
        transform: rotate(90deg);
    }
    
    .card-number {
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-textLink-foreground);
        min-width: 80px;
        flex-shrink: 0;
    }
    
    .card-preview-scroll {
        flex: 1;
        display: flex;
        gap: 20px;
        overflow-x: auto;
        overflow-y: hidden;
        white-space: nowrap;
        padding: 4px 0;
        scrollbar-width: thin;
        scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
    }
    
    .card-preview-scroll::-webkit-scrollbar {
        height: 6px;
    }
    
    .card-preview-scroll::-webkit-scrollbar-track {
        background: transparent;
    }
    
    .card-preview-scroll::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
    }
    
    .card-preview-scroll::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
    }
    
    .preview-item {
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        padding: 2px 8px;
        background: var(--vscode-editor-background);
        border-radius: 3px;
        border: 1px solid var(--vscode-panel-border);
        flex-shrink: 0;
    }
    
    .preview-item strong {
        color: var(--vscode-textLink-foreground);
        margin-right: 4px;
    }
    
    .card-body {
        display: none;
        padding: 12px;
        max-height: 400px;
        overflow-y: auto;
        border-top: 1px solid var(--vscode-panel-border);
    }
    
    .data-card:not(.collapsed) .card-body {
        display: block;
    }
    
    .card-field {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .card-field:last-child {
        border-bottom: none;
    }
    
    .field-label {
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-textLink-foreground);
        word-break: break-word;
    }
    
    .field-value {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
        font-size: 12px;
        word-break: break-all;
        position: relative;
        padding-right: 30px;
    }
    
    .field-copy-btn {
        position: absolute;
        right: 0;
        top: 0;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 3px;
        padding: 2px 6px;
        font-size: 10px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;
    }
    
    .field-value:hover .field-copy-btn {
        opacity: 1;
    }
    
    .field-copy-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    
    .cards-footer {
        padding: 8px 12px;
        background: var(--vscode-input-background);
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
    }
</style>

<div class="pyspark-cards-container" id="${uniqueId}">
    <div class="cards-toolbar">
        <div class="cards-info">
            📊 <strong>DataFrame Schema</strong> • ${rows.length} ${rows.length === 1 ? 'column' : 'columns'}
        </div>
        <div class="cards-actions">
            <button class="toolbar-btn" onclick="expandAllSchemaCards('${uniqueId}')">Expand All</button>
            <button class="toolbar-btn" onclick="collapseAllSchemaCards('${uniqueId}')">Collapse All</button>
        </div>
    </div>
    
    <div class="cards-wrapper">
        ${columnCards}
    </div>
    
    <div class="cards-footer">
        Click any column to expand for details
    </div>
</div>

<script>
(function() {
    var uniqueId = '${uniqueId}';
    
    window.toggleSchemaCard = function(cardId) {
        var card = document.getElementById(cardId);
        if (card) {
            card.classList.toggle('collapsed');
        }
    };
    
    window.expandAllSchemaCards = function(containerId) {
        var container = document.getElementById(containerId);
        var cards = container.querySelectorAll('.data-card');
        cards.forEach(function(card) {
            card.classList.remove('collapsed');
        });
    };
    
    window.collapseAllSchemaCards = function(containerId) {
        var container = document.getElementById(containerId);
        var cards = container.querySelectorAll('.data-card');
        cards.forEach(function(card) {
            card.classList.add('collapsed');
        });
    };
    
    function copyToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(function() {
                console.log('Copied to clipboard');
            }).catch(function(err) {
                console.error('Copy failed:', err);
            });
        } else {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;top:0;left:0;';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Copy failed:', err);
            }
            document.body.removeChild(textarea);
        }
    }
    
    // Handle field copy buttons
    var container = document.getElementById(uniqueId);
    container.addEventListener('click', function(e) {
        if (e.target.classList.contains('field-copy-btn')) {
            var value = e.target.getAttribute('data-value');
            copyToClipboard(value);
        }
    });
})();
</script>`;

    return html;
}

/**
 * Format table data and return HTML string only (for combining multiple tables).
 * For Python Spark DataFrames with many columns, uses card view instead of table.
 */
export function formatTableOutputAsHtml(
    data: string,
    tableId: string = 'table'
): string | null {
    // Priority 1: Single Row object - treat as 1-row collection
    if (isSinglePySparkRow(data)) {
        // Wrap in array format so it uses the same card view
        const singleRowData = parseSingleRowToTableData(data);
        if (singleRowData) {
            return formatPySparkAsCards(data, singleRowData);
        }
        return null;
    }
    
    // Priority 2: Check if it's a PySpark Row collection (print(df.collect()))
    if (isPySparkRowCollection(data)) {
        const tableData = parsePySparkRowCollection(data);
        if (tableData) {
            // Use card view for Row collections
            return formatPySparkAsCards(data, tableData);
        }
        return null;
    }
    
    // Priority 3: Check if it's a Python Spark DataFrame table (.show())
    if (isPythonSparkDataFrame(data)) {
        // Use card view for PySpark results (better for wide tables)
        return formatPySparkAsCards(data);
    }
    
    // Priority 4: Check if it's a DataFrame schema (print(df))
    if (isDataFrameSchema(data)) {
        // Use compact card for schema display
        return formatDataFrameSchemaAsCard(data);
    }
    
    // Priority 5: Standard table format for tab-separated data
    let tableData = parseTableData(data);
    if (!tableData) {
        return null;
    }
    return formatTableAsHTML(tableData, tableId);
}

/**
 * Parse single Row into TableData format
 */
function parseSingleRowToTableData(data: string): TableData | null {
    const trimmed = data.trim();
    const rowMatch = trimmed.match(/^Row\(([\s\S]*)\)$/);
    if (!rowMatch) return null;
    
    const fieldsStr = rowMatch[1];
    const fields = parseRowFields(fieldsStr);
    
    if (fields.length === 0) return null;
    
    const headers = fields.map(([key]) => key);
    const row = fields.map(([, value]) => value);
    
    return { headers, rows: [row] };
}