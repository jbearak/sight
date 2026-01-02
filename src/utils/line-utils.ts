import { Position } from 'vscode-languageserver';

/**
 * Document-like object with content and optional line_offsets.
 * Used by utility functions to support both full DocumentState and minimal test objects.
 */
export interface DocumentLike {
    content: string;
    line_offsets?: number[];
}

/**
 * Get the character offset where a line begins.
 * Uses line_offsets for O(1) lookup when available.
 * 
 * @param doc - Document state (must have content, may have line_offsets)
 * @param line_number - Zero-based line number
 * @returns Character offset, or 0 if line_number is 0 and line_offsets unavailable
 */
export function get_line_start_offset(
    doc: DocumentLike,
    line_number: number
): number {
    if (doc.line_offsets && line_number < doc.line_offsets.length) {
        return doc.line_offsets[line_number];
    }
    // Fallback: use indexOf to find newlines
    if (line_number === 0) return 0;
    let offset = 0;
    for (let i = 0; i < line_number; i++) {
        const next_newline = doc.content.indexOf('\n', offset);
        if (next_newline === -1) {
            return doc.content.length; // Line doesn't exist
        }
        offset = next_newline + 1;
    }
    return offset;
}

/**
 * Get the text of a single line (without newline).
 * Uses line_offsets for O(1) start position lookup.
 * 
 * @param doc - Document state
 * @param line_number - Zero-based line number
 * @returns Line text, or empty string if line doesn't exist
 */
export function get_line_text(
    doc: DocumentLike,
    line_number: number
): string {
    const start = get_line_start_offset(doc, line_number);
    if (start >= doc.content.length) return '';
    
    const end = doc.content.indexOf('\n', start);
    return end === -1 
        ? doc.content.substring(start)  // Last line
        : doc.content.substring(start, end);
}

/**
 * Get the character at a specific position.
 * Uses line_offsets for O(1) lookup.
 * 
 * @param doc - Document state
 * @param position - LSP position (line, character)
 * @returns Character at position, or null if out of bounds
 */
export function get_char_at_position(
    doc: DocumentLike,
    position: Position
): string | null {
    const line_start = get_line_start_offset(doc, position.line);
    const char_index = line_start + position.character;
    if (char_index < 0 || char_index >= doc.content.length) {
        return null;
    }
    return doc.content[char_index];
}

/**
 * Compute line_offsets array from content.
 * Each entry line_offsets[n] contains the character offset where line n begins.
 * 
 * @param content - Document content string
 * @returns Array of line start offsets
 */
export function compute_line_offsets(content: string): number[] {
    const the_offsets: number[] = [0];
    let offset = 0;
    while (true) {
        const next_newline = content.indexOf('\n', offset);
        if (next_newline === -1) break;
        the_offsets.push(next_newline + 1);
        offset = next_newline + 1;
    }
    return the_offsets;
}

/**
 * Get the number of lines in a document.
 * Uses line_offsets for O(1) lookup when available and valid.
 * 
 * @param doc - Document state
 * @returns Number of lines in the document
 */
export function get_line_count(doc: DocumentLike): number {
    // Use line_offsets only if it's a non-empty array (properly computed)
    if (doc.line_offsets && doc.line_offsets.length > 0) {
        return doc.line_offsets.length;
    }
    // Fallback: count newlines using indexOf
    let count = 1;
    let offset = 0;
    while (true) {
        const next_newline = doc.content.indexOf('\n', offset);
        if (next_newline === -1) break;
        count++;
        offset = next_newline + 1;
    }
    return count;
}
