import { Diagnostic } from 'vscode-languageserver';

export const DIAGNOSTICS_DOCUMENTATION_URL =
    'https://github.com/jbearak/sight/blob/main/docs/diagnostics.md';

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
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
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
