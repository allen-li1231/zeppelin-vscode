import * as vscode from 'vscode';
import { TextEncoder } from 'util';
import { parseTableData, formatTableAsHTML } from './tableData';
import {
    isSinglePySparkRow, parseSingleRowToTableData, isPySparkRowCollection,
    parsePySparkRowCollection, isPythonSparkDataFrame, formatPySparkAsCards,
    isDataFrameSchema, formatDataFrameSchemaAsCard,
} from './pyspark';

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
