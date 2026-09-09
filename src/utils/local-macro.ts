// macval() expands a local without recursively expanding its contents.
// Only unwrap literal names. Dynamic names retain the existing nested-macro
// handling, and malformed calls must still reach character validation.
const MACVAL_LITERAL_PATTERN = /^macval\(([A-Za-z0-9_]+)\)$/;

export function unwrap_macval(content: string): string {
    return MACVAL_LITERAL_PATTERN.exec(content)?.[1] ?? content;
}
