import { isTableData } from './tableData';
import { formatTableOutputAsHtml } from './tableFormatter';
import {
    isDataFrameSchema,
    formatDataFrameSchemaAsCard,
    isSinglePySparkRow,
    isPySparkRowCollection,
    isPythonSparkDataFrame,
} from './pyspark';

/**
 * Classify a single Zeppelin result message and, if it is a recognized
 * structured result (tab-separated table, PySpark DataFrame/Row, or a
 * DataFrame schema), render it to a self-contained HTML string.
 *
 * Returns null when the message is NOT a recognized structured result, so the
 * caller can fall back to plain-text rendering. This is deliberately a
 * per-message (whole-message) classification: we do not attempt to split a
 * single message into mixed table+text segments, which is brittle and prone
 * to mis-detecting ordinary text as a table.
 */
export function renderStructuredResultAsHtml(
    type: string | undefined,
    data: string | undefined,
    outputId: string
): string | null {
    if (!data || !data.trim()) {
        return null;
    }

    const isTable =
        type === 'TABLE'
        || isTableData(data)
        || isPythonSparkDataFrame(data)
        || isPySparkRowCollection(data)
        || isSinglePySparkRow(data);

    if (isTable) {
        // formatTableOutputAsHtml returns null if the data does not actually
        // parse as a table — fall through to the schema check / text.
        const html = formatTableOutputAsHtml(data, outputId);
        if (html) {
            return html;
        }
    }

    if (isDataFrameSchema(data)) {
        const card = formatDataFrameSchemaAsCard(data);
        if (card) {
            return card;
        }
    }

    return null;
}
