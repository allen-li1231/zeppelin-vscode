import { describe, it, expect } from 'vitest';
import {
    isTableData,
    formatTableOutput,
    formatTableOutputAsHtml,
    isDataFrameSchema,
    isSinglePySparkRow,
    isPySparkRowCollection,
    isPythonSparkDataFrame,
    formatDataFrameSchemaAsCard,
    formatTextOutput,
    shouldUseEnhancedTextFormat,
} from '../../common/formatters';
import {
    escapeHtml,
    escapeHtmlAttr,
    escapeHtmlForTextarea,
} from '../../common/formatters/escape';

// These tests are an independent behavior oracle for the formatters module
// (split/refactored out of PR #33's tableFormatter.ts / textFormatter.ts).
// They lock the detection heuristics and, critically, that cell data is
// HTML-escaped before being embedded in notebook output (no injection).

describe('escape', () => {
    it('escapes HTML metacharacters', () => {
        expect(escapeHtml('<b>a & b</b>')).not.toContain('<b>');
        expect(escapeHtml('<b>')).toContain('&lt;');
        expect(escapeHtml('a & b')).toContain('&amp;');
    });

    it('escapes attribute-breaking quotes', () => {
        const out = escapeHtmlAttr('x" onmouseover="alert(1)');
        expect(out).not.toContain('"');
    });

    it('escapes textarea-closing sequences', () => {
        const out = escapeHtmlForTextarea('</textarea><script>');
        expect(out).not.toContain('</textarea>');
        expect(out).not.toContain('<script>');
    });
});

describe('isTableData', () => {
    it('detects the %table prefix', () => {
        expect(isTableData('%table\ncol1\tcol2\nv1\tv2')).toBe(true);
    });

    it('detects tab-separated multi-line data', () => {
        expect(isTableData('a\tb\tc\nd\te\tf')).toBe(true);
    });

    it('rejects a single line', () => {
        expect(isTableData('one\ttwo\tthree')).toBe(false);
    });

    it('rejects plain text with no tabs', () => {
        expect(isTableData('just some\nplain text')).toBe(false);
    });

    it('rejects empty / non-string input', () => {
        expect(isTableData('')).toBe(false);
        // @ts-expect-error intentional bad input
        expect(isTableData(undefined)).toBe(false);
    });
});

describe('isDataFrameSchema', () => {
    it('detects a single-line DataFrame[...] schema', () => {
        expect(isDataFrameSchema('DataFrame[id: int, name: string]')).toBe(true);
    });

    it('rejects a multi-line value', () => {
        expect(isDataFrameSchema('DataFrame[id: int]\ntrailing')).toBe(false);
    });

    it('rejects non-schema text', () => {
        expect(isDataFrameSchema('not a dataframe')).toBe(false);
    });
});

describe('PySpark Row detection', () => {
    it('detects a single Row(...)', () => {
        expect(isSinglePySparkRow('Row(a=1, b=2)')).toBe(true);
    });

    it('does not treat a Row collection as a single Row', () => {
        expect(isSinglePySparkRow('[Row(a=1), Row(a=2)]')).toBe(false);
    });

    it('detects a Row collection', () => {
        expect(isPySparkRowCollection('[Row(a=1), Row(a=2)]')).toBe(true);
    });

    it('rejects plain text as a Row collection', () => {
        expect(isPySparkRowCollection('hello world')).toBe(false);
    });
});

describe('isPythonSparkDataFrame (df.show() ascii table)', () => {
    const show = [
        '+---+----+',
        '| id|name|',
        '+---+----+',
        '|  1|   a|',
        '+---+----+',
    ].join('\n');

    it('detects a df.show() style table', () => {
        expect(isPythonSparkDataFrame(show)).toBe(true);
    });

    it('rejects ordinary multi-line text', () => {
        expect(isPythonSparkDataFrame('line one\nline two\nline three')).toBe(false);
    });
});

describe('formatTableOutputAsHtml', () => {
    it('renders a table containing the data', () => {
        const html = formatTableOutputAsHtml('a\tb\nc\td', 'tbl-1');
        expect(html).toBeTruthy();
        expect(html).toContain('<table');
    });

    it('HTML-escapes cell content (no injection)', () => {
        const html = formatTableOutputAsHtml('<script>evil</script>\tcol\nx\ty', 'tbl-2') ?? '';
        // the raw script tag must not survive into the rendered output as live markup
        expect(html).not.toContain('<script>evil</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

describe('text formatting', () => {
    it('shouldUseEnhancedTextFormat: true for tabbed / multiline / long text', () => {
        expect(shouldUseEnhancedTextFormat('a\tb')).toBe(true);
        expect(shouldUseEnhancedTextFormat('line1\nline2')).toBe(true);
        expect(shouldUseEnhancedTextFormat('x'.repeat(120))).toBe(true);
    });

    it('shouldUseEnhancedTextFormat: false for short single-line text', () => {
        expect(shouldUseEnhancedTextFormat('ok')).toBe(false);
        expect(shouldUseEnhancedTextFormat('')).toBe(false);
    });

    it('formatTextOutput returns a notebook output item', () => {
        const item = formatTextOutput('hello\nworld');
        expect(item).toBeTruthy();
        expect(item).toHaveProperty('data');
    });
});

describe('formatDataFrameSchemaAsCard', () => {
    it('renders a schema card for a valid schema', () => {
        const card = formatDataFrameSchemaAsCard('DataFrame[id: int, name: string]');
        expect(card).toBeTruthy();
        expect(card).toContain('name');
    });
});

describe('formatTableOutput (NotebookCellOutputItem entrypoint)', () => {
    it('returns an output item for table data', () => {
        const item = formatTableOutput('a\tb\nc\td');
        expect(item).toBeTruthy();
    });
});
