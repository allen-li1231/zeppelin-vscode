import type { TableData } from './tableData';
import { escapeHtml, escapeHtmlAttr } from './escape';
import { TABLE_STYLES, renderCardScript } from './assets';
import { logger } from '../logger';

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
${TABLE_STYLES}

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

${renderCardScript(uniqueId)}`;

    return html;
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
        logger.error('Failed to parse PySpark Row collection:', error);
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

    if (lines.length < 4) {
        
        return null;
    }

    // Find first separator line (skip any metadata at top)
    let firstSeparatorIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        const trimmedLine = line?.trim();

        if (trimmedLine && trimmedLine.match(/^\+[-+]+\+$/)) {
            firstSeparatorIdx = i;
            
            break;
        }
    }

    if (firstSeparatorIdx === -1 || firstSeparatorIdx + 2 >= lines.length) {
        
        return null;
    }

    // Header should be right after first separator
    const headerLineIdx = firstSeparatorIdx + 1;
    const headerLine = lines[headerLineIdx];

    if (!headerLine || !headerLine.includes('|')) {
        
        return null;
    }

    // Count pipes in header
    const pipeCount = (headerLine.match(/\|/g) || []).length;

    // Simple approach: split by | and filter empty
    const rawHeaders = headerLine.split('|');

    const headers = rawHeaders
        .slice(1, -1) // Remove first and last empty elements
        .map(h => h.trim())
        .filter(h => h.length > 0);

    if (headers.length === 0) {
        
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

    if (rows.length === 0) {
        
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
${TABLE_STYLES}

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

${renderCardScript(uniqueId, { headers, rows })}`;

    return html;
}

/**
 * Parse single Row into TableData format
 */
export function parseSingleRowToTableData(data: string): TableData | null {
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
