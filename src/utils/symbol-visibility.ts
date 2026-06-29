/**
 * Shared helper for the line at which a symbol becomes visible in execution
 * order.
 *
 * For ordinary symbols the analyzer sets `definition_line` equal to
 * `location.range.start.line`, so this is a no-op. Loop-expanded macros are the
 * exception: their `location` points at the in-loop body statement (for
 * go-to-definition), but they only become defined on the line after the loop's
 * closing brace, recorded in `definition_line`. Cross-file execution-order
 * filters must use this effective line, not the definition location.
 */
export function effective_definition_line(symbol: {
    definition_line?: number;
    location: { range: { start: { line: number } } };
}): number {
    return symbol.definition_line ?? symbol.location.range.start.line;
}
