/** Server-side HTML escaping shared by all formatters. */

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
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
export function escapeHtmlAttr(text: string): string {
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
 * Serialize a value to a JS literal that is safe to embed inside an inline
 * <script> block. JSON.stringify alone is NOT safe here: it does not escape
 * "<", so a payload containing "</script>" would terminate the script element
 * early (breaking the output and allowing HTML injection). We additionally
 * escape "<" and the U+2028/U+2029 separators (valid in JS strings but illegal
 * as raw line terminators in some parsers).
 */
export function jsonForInlineScript(value: unknown): string {
    return JSON.stringify(value ?? null)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * Escape text for embedding in a textarea (less strict than full HTML escaping)
 */
export function escapeHtmlForTextarea(text: string): string {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
