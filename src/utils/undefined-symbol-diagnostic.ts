// Helpers for undefined-symbol diagnostics (UNDEFINED_MACRO / UNDEFINED_VARIABLE):
// their human-facing wording and the structured `data` payload that carries the
// referenced symbol downstream.
//
// The diagnostic `code` is the stable suppression handle and already classifies
// the rule, so the message no longer restates it ("Undefined local macro: ...").
// Instead it states the subject and predicate; surfaces that render
// `message [code]` (e.g. `sight check`) no longer read as duplicate information.
// The macro sigils (`` `x' `` local, `$x` global) already convey macro-ness and
// scope, so they carry that meaning without the word "macro". See docs/
// superpowers/specs/2026-06-26-diagnostic-message-code-deduplication.md.

import { UndefinedSymbolDiagnosticData } from '../types';

export function format_undefined_macro_message(
    scope: 'local' | 'global',
    name: string
): string {
    const display = scope === 'local' ? `\`${name}'` : `$${name}`;
    return `${display} is not defined`;
}

// Variables keep an epistemic hedge ("may") because Sight cannot see dataset
// columns; this is why the diagnostic is reported at `information` severity. The
// word "variable" is dropped as duplicative of the UNDEFINED_VARIABLE code.
export function format_undefined_variable_message(name: string): string {
    return `${name} may not be defined`;
}

// Fields to spread onto an LSP Diagnostic so it carries the analyzer's
// structured symbol_name/reference_kind on `data`. Returns {} (omitting the
// `data` key entirely) for diagnostics with no such payload, e.g. lexer,
// parser, and out-of-scope-rewrite diagnostics. Centralizing this keeps the
// payload shape in one place: every analyzer→LSP conversion (production and the
// test harnesses that mirror it) spreads the same fields.
export function undefined_symbol_data_fields(
    diagnostic: {
        symbol_name?: string;
        reference_kind?: 'local' | 'global' | 'variable';
        scope_isolation?: { defined_in_programs: string[] };
    }
): { data: UndefinedSymbolDiagnosticData } | Record<string, never> {
    if (
        diagnostic.symbol_name === undefined
        && diagnostic.reference_kind === undefined
    ) {
        return {};
    }
    return {
        data: {
            symbol_name: diagnostic.symbol_name,
            reference_kind: diagnostic.reference_kind,
            ...(diagnostic.scope_isolation !== undefined
                ? { scope_isolation: diagnostic.scope_isolation }
                : {}),
        },
    };
}
