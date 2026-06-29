import { Diagnostic } from 'vscode-languageserver';

export const DIAGNOSTICS_DOCUMENTATION_URL =
    'https://github.com/jbearak/sight/blob/main/docs/diagnostics.md';

// Diagnostic codes come from a small fixed set of enum members, so the
// slug for a given code never changes. Memoize to avoid re-running the
// regex passes on every published diagnostic (can be thousands per run).
const anchor_cache = new Map<string, string>();

export function diagnostic_code_anchor(
    code: Diagnostic['code']
): string | null {
    if (code === undefined || code === null) {
        return null;
    }
    const value = String(code).trim();
    if (value.length === 0) {
        return null;
    }
    const cached = anchor_cache.get(value);
    if (cached !== undefined) {
        return cached;
    }
    const anchor = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    anchor_cache.set(value, anchor);
    return anchor;
}

export function diagnostic_code_description(
    code: Diagnostic['code']
): Diagnostic['codeDescription'] | undefined {
    const anchor = diagnostic_code_anchor(code);
    if (!anchor) {
        return undefined;
    }
    return {
        href: `${DIAGNOSTICS_DOCUMENTATION_URL}#${anchor}`,
    };
}

export function diagnostic_code_description_fields(
    code: Diagnostic['code']
): { codeDescription?: Diagnostic['codeDescription'] } {
    const codeDescription = diagnostic_code_description(code);
    return codeDescription ? { codeDescription } : {};
}
