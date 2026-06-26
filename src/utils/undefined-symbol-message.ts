// Human-facing wording for undefined-symbol diagnostics.
//
// The diagnostic `code` (UNDEFINED_MACRO / UNDEFINED_VARIABLE) is the stable
// suppression handle and already classifies the rule, so the message no longer
// restates it ("Undefined local macro: ..."). Instead it states the subject and
// predicate; surfaces that render `message [code]` (e.g. `sight check`) no
// longer read as duplicate information. The macro sigils (`` `x' `` local,
// `$x` global) already convey macro-ness and scope, so they carry that meaning
// without the word "macro". See docs/superpowers/specs/
// 2026-06-26-diagnostic-message-code-deduplication.md.

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
