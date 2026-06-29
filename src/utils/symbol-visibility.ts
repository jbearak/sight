/**
 * Shared helper for the line at which a symbol becomes visible in execution
 * order.
 *
 * Most analyzer symbols set `definition_line` equal to
 * `location.range.start.line`, so this is usually a no-op. Symbols created by
 * directives or future analyzer passes may use a different execution-order line
 * from their navigation location. Cross-file execution-order filters must use
 * this effective line, not just the definition location.
 */
export function effective_definition_line(symbol: {
    definition_line?: number;
    location: { range: { start: { line: number } } };
}): number {
    return symbol.definition_line ?? symbol.location.range.start.line;
}
