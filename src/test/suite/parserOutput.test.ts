import { describe, it, expect } from 'vitest';
import { parseParagraphResultToCellOutput } from '../../common/parser';

const decode = (d: Uint8Array) => new TextDecoder().decode(d);

// Integration tests for the formatter wiring in parseParagraphResultToCellOutput.
// Confirms structured results render as HTML while ordinary text/error/progress
// paths keep their existing behavior (no regression).

describe('parseParagraphResultToCellOutput wiring', () => {
    it('renders a TABLE message as an HTML table', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'SUCCESS', msg: [{ type: 'TABLE', data: 'a\tb\nc\td' }] } as any
        );
        expect(out.length).toBe(1);
        expect(out[0].mime).toBe('text/html');
        expect(decode(out[0].data)).toContain('<table');
    });

    it('keeps short plain text as a text/plain item (unchanged)', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'hello' }] } as any
        );
        expect(out.length).toBe(1);
        expect(out[0].mime).toBe('text/plain');
        expect(decode(out[0].data)).toBe('hello');
    });

    it('routes ERROR code to a stderr item', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'ERROR', msg: [{ type: 'TEXT', data: 'boom' }] } as any
        );
        expect(out.length).toBe(1);
        expect(out[0].mime).toBe('application/vnd.code.notebook.stderr');
        expect(decode(out[0].data)).toBe('boom');
    });

    it('keeps the progress-bar path as plain text (not enhanced)', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'running' }] } as any,
            'PROGRESS 50%'
        );
        expect(out.length).toBe(1);
        expect(out[0].mime).toBe('text/plain');
        expect(decode(out[0].data)).toMatch(/^PROGRESS 50%/);
    });

    it('uses the enhanced text formatter for multi-line text (no progress bar)', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'line1\nline2\nline3' }] } as any
        );
        expect(out.length).toBe(1);
        expect(out[0].mime).toBe('text/html');
    });

    it('renders a DataFrame schema message as an HTML card', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'SUCCESS', msg: [{ type: 'TEXT', data: 'DataFrame[id: int, name: string]' }] } as any
        );
        expect(out.length).toBe(1);
        expect(out[0].mime).toBe('text/html');
        expect(decode(out[0].data)).toContain('name');
    });

    it('passes genuine HTML output through unchanged', () => {
        const out = parseParagraphResultToCellOutput(
            { code: 'SUCCESS', msg: [{ type: 'HTML', data: '<b>hi</b>' }] } as any
        );
        expect(out[0].mime).toBe('text/html');
        expect(decode(out[0].data)).toContain('<b>hi</b>');
    });
});
