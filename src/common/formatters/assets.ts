import type { TableData } from './tableData';
import { jsonForInlineScript } from './escape';

/** Shared superset, embedded in every isolated table/card output. */
export const TABLE_STYLES = `<style>
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

    /* Schema column labels retain their original width. */
    [id^="df-schema-"] .card-number {
        min-width: 80px;
    }
</style>`;

/** Table handlers execute inside the per-output scope supplied below. */
export const TABLE_SCRIPT = `    
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
    });`;

/** Shared row/schema card handlers, including browser-side clipboard logging. */
export const CARD_SCRIPT = `    
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
    // Schema cards use the same controls under their existing HTML handler names.
    window.toggleSchemaCard = window.toggleCard;
    window.expandAllSchemaCards = window.expandAllCards;
    window.collapseAllSchemaCards = window.collapseAllCards;
`;

/** Bind output-specific data without duplicating the client-side handlers. */
export function renderTableScript(uniqueId: string, csvContent: string): string {
    return `<script>
(function() {
    var uniqueId = ${jsonForInlineScript(uniqueId)};
    var csvContent = ${jsonForInlineScript(csvContent)};
${TABLE_SCRIPT}
})();
</script>`;
}

/** Schema cards need only the shared controls; row cards also supply their data. */
export function renderCardScript(uniqueId: string, tableData?: TableData): string {
    return `<script>
(function() {
    var uniqueId = ${jsonForInlineScript(uniqueId)};
    var tableData = ${jsonForInlineScript(tableData)};
${CARD_SCRIPT}
})();
</script>`;
}
