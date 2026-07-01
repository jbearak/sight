import { DiagnosticSeverity } from 'vscode-languageserver/node';

/**
 * Map a configured diagnostic severity string to the LSP DiagnosticSeverity
 * enum. Shared by the token-stream diagnostic analyzers so the mapping lives
 * in one place. Callers must filter out the `'off'` case before calling.
 */
export function resolve_diagnostic_severity(
    my_config_severity: 'error' | 'warning' | 'information' | 'hint'
): DiagnosticSeverity {
    switch (my_config_severity) {
        case 'error': return DiagnosticSeverity.Error;
        case 'warning': return DiagnosticSeverity.Warning;
        case 'information': return DiagnosticSeverity.Information;
        case 'hint': return DiagnosticSeverity.Hint;
    }
}
