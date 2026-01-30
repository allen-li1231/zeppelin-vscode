import * as vscode from 'vscode';
import { TextEncoder } from 'util';

export interface TableData {
    headers: string[];
    rows: string[][];
}

/**
 * Parse Zeppelin table format (both %table and direct TABLE type) from text output
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
        padding: 12px 16px !important;
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
        Hover over any cell to see copy button (📋) • Click cell to expand/collapse • Click copy button to copy individual cell value
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
 * Check if text contains table data (either %table format or tab-separated data)
 */
export function isTableData(data: string): boolean {
    if (!data || typeof data !== 'string') {
        return false;
    }
    
    const trimmed = data.trim();
    
    // Check for %table prefix
    if (trimmed.startsWith('%table')) {
        return true;
    }
    
    // Check if it looks like tab-separated table data
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
 * Format table data for notebook output
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