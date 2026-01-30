import * as vscode from 'vscode';
import { TextEncoder } from 'util';

export interface TextFormatOptions {
    showWhitespace?: boolean;
    maxLines?: number;
    collapsible?: boolean;
    wordWrap?: boolean;
}

/**
 * Format text output with whitespace visualization and expansion capabilities
 */
export function formatTextOutput(
    text: string,
    options: TextFormatOptions = {}
): vscode.NotebookCellOutputItem {
    const {
        showWhitespace = false,  // Changed default to false for cleaner initial view
        maxLines = 50,
        collapsible = true,
        wordWrap = true  // Default to true for better readability of long lines
    } = options;

    // Pre-format SQL DDL statements for better readability
    let formattedText = text;
    if (isSQLDDL(text)) {
        formattedText = formatSQLDDL(text);
    }

    const lines = formattedText.split('\n');
    const isLongOutput = lines.length > maxLines;
    const uniqueId = `text-output-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Generate HTML with whitespace visualization
    const html = `
<style>
    .zeppelin-text-container {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        margin: 8px 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--vscode-panel-border);
    }
    
    .zeppelin-text-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 12px;
        background: var(--vscode-input-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        gap: 8px;
        flex-wrap: wrap;
    }
    
    .zeppelin-text-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .zeppelin-text-stats {
        display: flex;
        gap: 8px;
    }
    
    .zeppelin-text-stat {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    
    .zeppelin-text-stat-value {
        font-weight: 600;
        color: var(--vscode-textLink-foreground);
    }
    
    .zeppelin-text-actions {
        display: flex;
        gap: 6px;
    }
    
    .zeppelin-text-btn {
        padding: 3px 8px;
        font-size: 11px;
        background: transparent;
        color: var(--vscode-button-foreground);
        border: 1px solid var(--vscode-button-border);
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 3px;
    }
    
    .zeppelin-text-btn:hover {
        background: var(--vscode-button-hoverBackground);
        border-color: var(--vscode-button-hoverBackground);
    }
    
    .zeppelin-text-btn.active {
        background: var(--vscode-button-background);
        border-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    
    .zeppelin-text-btn.success {
        background: #28a745;
        color: white;
        border-color: #28a745;
    }
    
    .zeppelin-text-content {
        padding: 12px;
        overflow-x: auto;
        overflow-y: auto;
        max-height: 500px;
        font-size: 13px;
        line-height: 1.6;
        white-space: pre;
        tab-size: 4;
        word-break: break-word;
    }
    
    .zeppelin-text-content.word-wrap {
        white-space: pre-wrap;
        overflow-x: hidden;
    }
    
    .zeppelin-text-content.collapsed {
        max-height: 300px;
    }
    
    .zeppelin-text-content.show-whitespace {
        white-space: pre;
    }
    
    /* Whitespace visualization */
    .zeppelin-text-content.show-whitespace .ws-newline {
        color: var(--vscode-editorWhitespace-foreground, rgba(128, 128, 128, 0.4));
        user-select: none;
    }
    
    .zeppelin-text-content.show-whitespace .ws-tab {
        color: var(--vscode-editorWhitespace-foreground, rgba(128, 128, 128, 0.4));
        user-select: none;
    }
    
    .zeppelin-text-content.show-whitespace .ws-space {
        color: var(--vscode-editorWhitespace-foreground, rgba(128, 128, 128, 0.4));
        user-select: none;
    }
    
    .zeppelin-text-line {
        display: block;
        min-height: 1.6em;
    }
    
    .zeppelin-text-line:hover {
        background: var(--vscode-list-hoverBackground);
    }
    
    .zeppelin-text-line-number {
        display: inline-block;
        width: 50px;
        padding-right: 12px;
        margin-right: 8px;
        text-align: right;
        color: var(--vscode-editorLineNumber-foreground);
        user-select: none;
        border-right: 1px solid var(--vscode-panel-border);
    }
    
    .zeppelin-text-footer {
        padding: 4px 12px;
        background: var(--vscode-input-background);
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
    }
    
    .zeppelin-text-expand-msg {
        display: none;
        padding: 8px;
        text-align: center;
        background: var(--vscode-inputValidation-infoBackground);
        color: var(--vscode-inputValidation-infoForeground);
        border: 1px solid var(--vscode-inputValidation-infoBorder);
        margin: 8px;
        border-radius: 3px;
        font-size: 11px;
    }
    
    .zeppelin-text-expand-msg.visible {
        display: block;
    }
</style>

<div class="zeppelin-text-container" id="${uniqueId}">
    <div class="zeppelin-text-toolbar">
        <div class="zeppelin-text-info">
            <div class="zeppelin-text-stats">
                <div class="zeppelin-text-stat">
                    <span>Lines:</span>
                    <span class="zeppelin-text-stat-value">${lines.length}</span>
                </div>
                <div class="zeppelin-text-stat">
                    <span>Chars:</span>
                    <span class="zeppelin-text-stat-value">${text.length}</span>
                </div>
            </div>
        </div>
        <div class="zeppelin-text-actions">
            <button class="zeppelin-text-btn ${showWhitespace ? 'active' : ''}" id="toggle-ws-${uniqueId}" title="Toggle whitespace visualization">
                <span>⌇</span>
                <span>Whitespace</span>
            </button>
            <button class="zeppelin-text-btn ${wordWrap ? 'active' : ''}" id="toggle-wrap-${uniqueId}" title="Toggle word wrap">
                <span>⏎</span>
                <span>Wrap</span>
            </button>
            <button class="zeppelin-text-btn ${lines.length <= 10 ? 'active' : ''}" id="toggle-lines-${uniqueId}" title="Toggle line numbers">
                <span>#</span>
                <span>Lines</span>
            </button>
            ${isLongOutput && collapsible ? `
            <button class="zeppelin-text-btn" id="toggle-expand-${uniqueId}" title="Expand/Collapse">
                <span>⇕</span>
                <span>Expand</span>
            </button>
            ` : ''}
            <button class="zeppelin-text-btn" id="copy-btn-${uniqueId}" title="Copy to clipboard">
                <span>⎘</span>
                <span>Copy</span>
            </button>
        </div>
    </div>
    
    ${isLongOutput && collapsible ? `
    <div class="zeppelin-text-expand-msg" id="expand-msg-${uniqueId}">
        Output truncated (showing first ${maxLines} of ${lines.length} lines). Click "Expand" to view all.
    </div>
    ` : ''}
    
    <div class="zeppelin-text-content ${showWhitespace ? 'show-whitespace' : ''} ${wordWrap ? 'word-wrap' : ''} ${isLongOutput && collapsible ? 'collapsed' : ''}" id="content-${uniqueId}">
${formatTextLines(lines, showWhitespace, isLongOutput && collapsible ? maxLines : undefined)}
    </div>
    
    <div class="zeppelin-text-footer">
        Whitespace: visualize tabs/newlines • Wrap: word wrap long lines • Lines: toggle line numbers • Copy: copy to clipboard
    </div>
</div>

<script>
(function() {
    var uniqueId = '${uniqueId}';
    var originalText = ${JSON.stringify(formattedText)};
    var lines = originalText.split('\\n');
    var isLongOutput = ${isLongOutput};
    var maxLines = ${maxLines};
    
    var content = document.getElementById('content-' + uniqueId);
    var toggleWsBtn = document.getElementById('toggle-ws-' + uniqueId);
    var toggleWrapBtn = document.getElementById('toggle-wrap-' + uniqueId);
    var toggleLinesBtn = document.getElementById('toggle-lines-' + uniqueId);
    var toggleExpandBtn = document.getElementById('toggle-expand-' + uniqueId);
    var copyBtn = document.getElementById('copy-btn-' + uniqueId);
    var expandMsg = document.getElementById('expand-msg-' + uniqueId);
    
    var state = {
        showWhitespace: ${showWhitespace},
        showLineNumbers: ${lines.length <= 10},
        wordWrap: ${wordWrap},
        expanded: false
    };
    
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function formatTextLines(lines, showWs, showLineNums, maxLines) {
        var linesToShow = maxLines ? lines.slice(0, maxLines) : lines;
        var html = '';
        
        for (var i = 0; i < linesToShow.length; i++) {
            var line = lines[i];
            var lineNum = i + 1;
            var formattedLine = line;
            
            if (showWs) {
                // Visualize tabs
                formattedLine = formattedLine.replace(/\\t/g, '<span class="ws-tab">→   </span>');
                // Visualize multiple spaces (2 or more)
                formattedLine = formattedLine.replace(/  /g, '<span class="ws-space">·</span> ');
            }
            
            formattedLine = escapeHtml(line);
            if (showWs) {
                formattedLine = formattedLine.replace(/\\t/g, '<span class="ws-tab">→   </span>');
                formattedLine = formattedLine.replace(/  /g, '<span class="ws-space">·</span> ');
            }
            
            html += '<span class="zeppelin-text-line">';
            if (showLineNums) {
                html += '<span class="zeppelin-text-line-number">' + lineNum + '</span>';
            }
            html += formattedLine;
            if (showWs && i < linesToShow.length - 1) {
                html += '<span class="ws-newline">↵</span>';
            }
            html += '</span>\\n';
        }
        
        return html;
    }
    
    function updateContent() {
        var linesToShow = (isLongOutput && !state.expanded) ? lines.slice(0, maxLines) : lines;
        content.innerHTML = formatTextLines(linesToShow, state.showWhitespace, state.showLineNumbers);
        
        if (expandMsg) {
            if (!state.expanded && isLongOutput) {
                expandMsg.classList.add('visible');
            } else {
                expandMsg.classList.remove('visible');
            }
        }
    }
    
    // Toggle whitespace
    if (toggleWsBtn) {
        toggleWsBtn.addEventListener('click', function() {
            state.showWhitespace = !state.showWhitespace;
            if (state.showWhitespace) {
                content.classList.add('show-whitespace');
                toggleWsBtn.classList.add('active');
            } else {
                content.classList.remove('show-whitespace');
                toggleWsBtn.classList.remove('active');
            }
            updateContent();
        });
    }
    
    // Toggle word wrap
    if (toggleWrapBtn) {
        toggleWrapBtn.addEventListener('click', function() {
            state.wordWrap = !state.wordWrap;
            if (state.wordWrap) {
                content.classList.add('word-wrap');
                toggleWrapBtn.classList.add('active');
            } else {
                content.classList.remove('word-wrap');
                toggleWrapBtn.classList.remove('active');
            }
        });
    }
    
    // Toggle line numbers
    if (toggleLinesBtn) {
        toggleLinesBtn.addEventListener('click', function() {
            state.showLineNumbers = !state.showLineNumbers;
            if (state.showLineNumbers) {
                toggleLinesBtn.classList.add('active');
            } else {
                toggleLinesBtn.classList.remove('active');
            }
            updateContent();
        });
    }
    
    // Toggle expand/collapse
    if (toggleExpandBtn) {
        toggleExpandBtn.addEventListener('click', function() {
            state.expanded = !state.expanded;
            if (state.expanded) {
                content.classList.remove('collapsed');
                toggleExpandBtn.innerHTML = '<span>⇕</span><span>Collapse</span>';
            } else {
                content.classList.add('collapsed');
                toggleExpandBtn.innerHTML = '<span>⇕</span><span>Expand</span>';
            }
            updateContent();
        });
    }
    
    // Copy to clipboard
    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            var originalHTML = copyBtn.innerHTML;
            var originalClass = copyBtn.className;
            
            function showSuccess() {
                copyBtn.className = 'zeppelin-text-btn success';
                copyBtn.innerHTML = '<span>✓</span><span>Copied!</span>';
                setTimeout(function() {
                    copyBtn.className = originalClass;
                    copyBtn.innerHTML = originalHTML;
                }, 1500);
            }
            
            function showError() {
                copyBtn.innerHTML = '<span>✗</span><span>Failed</span>';
                setTimeout(function() {
                    copyBtn.innerHTML = originalHTML;
                }, 1500);
            }
            
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(originalText)
                    .then(showSuccess)
                    .catch(showError);
            } else {
                // Fallback
                var textarea = document.createElement('textarea');
                textarea.value = originalText;
                textarea.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                
                try {
                    var success = document.execCommand('copy');
                    if (success) showSuccess();
                    else showError();
                } catch (err) {
                    showError();
                }
                
                document.body.removeChild(textarea);
            }
        });
    }
})();
</script>
`;

    const encoder = new TextEncoder();
    return new vscode.NotebookCellOutputItem(
        encoder.encode(html),
        'text/html'
    );
}

/**
 * Format text lines with optional whitespace visualization and line numbers
 */
function formatTextLines(
    lines: string[],
    showWhitespace: boolean,
    maxLines?: number
): string {
    const linesToShow = maxLines ? lines.slice(0, maxLines) : lines;
    const showLineNumbers = lines.length <= 10;
    
    return linesToShow.map((line, i) => {
        const lineNum = i + 1;
        let formattedLine = escapeHtml(line);
        
        if (showWhitespace) {
            // Visualize tabs
            formattedLine = formattedLine.replace(/\t/g, '<span class="ws-tab">→   </span>');
            // Visualize multiple spaces (2 or more)
            formattedLine = formattedLine.replace(/  /g, '<span class="ws-space">·</span> ');
        }
        
        let html = '<span class="zeppelin-text-line">';
        if (showLineNumbers) {
            html += `<span class="zeppelin-text-line-number">${lineNum}</span>`;
        }
        html += formattedLine;
        if (showWhitespace && i < linesToShow.length - 1) {
            html += '<span class="ws-newline">↵</span>';
        }
        html += '</span>';
        
        return html;
    }).join('\n');
}

/**
 * Escape HTML special characters
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
 * Check if text is a SQL DDL statement (CREATE TABLE, ALTER TABLE, etc.)
 */
function isSQLDDL(text: string): boolean {
    if (!text || typeof text !== 'string') {
        return false;
    }
    
    const trimmed = text.trim().toUpperCase();
    return trimmed.startsWith('CREATE TABLE') || 
           trimmed.startsWith('CREATE EXTERNAL TABLE') ||
           trimmed.startsWith('ALTER TABLE') ||
           trimmed.startsWith('CREATE VIEW') ||
           trimmed.startsWith('SHOW CREATE TABLE');
}

/**
 * Format SQL DDL statement with proper line breaks
 */
function formatSQLDDL(text: string): string {
    if (!text) return text;
    
    let formatted = text;
    
    // Add newlines after key SQL keywords for better readability
    formatted = formatted
        // Column definitions - add newline after comma
        .replace(/,\s*(\w+\s+(STRING|INT|BIGINT|DOUBLE|DECIMAL|DATE|TIMESTAMP|BOOLEAN|ARRAY|MAP|STRUCT))/gi, ',\n  $1')
        // Main clauses
        .replace(/(\s+)(USING|PARTITIONED BY|LOCATION|WITH ROW FILTER|TBLPROPERTIES)/gi, '\n$2')
        // Properties
        .replace(/(',\s*)(')/g, '$1\n  $2')
        // Opening parenthesis for columns
        .replace(/(\w+)\s*\(/g, '$1 (\n  ')
        // Closing parenthesis for columns
        .replace(/\)\s*(USING|PARTITIONED)/gi, '\n)\n$1');
    
    return formatted;
}

/**
 * Check if text output would benefit from enhanced formatting
 * (e.g., has multiple lines, tabs, or is long)
 */
export function shouldUseEnhancedTextFormat(text: string): boolean {
    if (!text || typeof text !== 'string') {
        return false;
    }
    
    // Always use enhanced format for outputs that need better visualization
    const lines = text.split('\n');
    const hasTabs = text.includes('\t');
    const isMultiline = lines.length > 1;
    const isLong = text.length > 100; // Lowered from 200 to 100 for better coverage
    const hasLongLine = lines.some(line => line.length > 80); // Check for long lines
    const isSQLStatement = isSQLDDL(text); // Check if it's a SQL DDL statement
    
    return hasTabs || isMultiline || isLong || hasLongLine || isSQLStatement;
}
