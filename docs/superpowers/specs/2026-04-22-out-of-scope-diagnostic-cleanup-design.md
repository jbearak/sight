# Out-of-scope diagnostic cleanup

**Status:** design
**Date:** 2026-04-22
**Scope:** Delete the misnamed `crossFile.diagnostics.outOfScope` severity setting, fix the `off`-branch divergence between the backward and forward rewrite paths, make the rewrite fire for variables, and give same-file forward references the same specific message that cross-file forward references already get.

## Problem

`OUT_OF_SCOPE_SYMBOL` is not an independent diagnostic source. It is a rewrite of an existing `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE` diagnostic into a more informative message, emitted when the scope resolver can prove the symbol exists but is unreachable at the reference site. The current shape of this feature has four problems:

1. **The setting is shaped wrong.** `sight.crossFile.diagnostics.outOfScope: error | warning | information | off` is modeled as a severity, but the rewrite is not a source — turning it `off` should not silence a diagnostic the user otherwise wants, and setting it independently of the base undefined-symbol severity invites incoherent combinations (e.g., base `off` + out-of-scope `error`).

2. **The backward and forward paths diverge on `off`.** In `src/providers/diagnostics.ts:281-286`, `outOfScope = off` suppresses the rewrite entirely on the backward/directive path, losing any diagnostic. In the forward-call path (`tests/property/forward-call-out-of-scope-oracle.prop.test.ts:495`), the same value falls back to plain `UNDEFINED_MACRO`. Same setting, different behavior.

3. **The rewrite is dead code for variables.** `OutOfScopeSymbol` and `filter_by_call_site` carry variables through (`src/scope-resolver/index.ts:2029-2058`), but `extract_symbol_name_from_diagnostic` (`src/providers/diagnostics.ts:880-894`) only parses macro formats. When the base diagnostic message is `Potentially undefined variable: foo`, no name is extracted and the rewrite never triggers.

4. **Same-file forward references get a generic message.** The analyzer knows, via the preorder-traversal index and `is_macro_defined(..., token_line)`, that `` `foo' `` on line 5 refers to a macro defined on line 10. It still emits the generic `` Undefined local macro: `foo' ``. Cross-file forward references get a specific "defined in X but after the call site" message. The UX is asymmetric for no reason.

A separate issue (#148) tracks the larger question of unifying same-file and cross-file enrichment into a single provider-side pipeline. A separate issue (#147) tracks true position-aware forward-reference analysis for variables. This spec addresses only the cleanup and correctness work.

## Goals

- Delete `sight.crossFile.diagnostics.outOfScope`. Severity of the `OUT_OF_SCOPE_SYMBOL` rewrite is inherited from the base `undefinedMacro` / `undefinedVariable` severity.
- Collapse the backward and forward rewrite branches in `src/providers/diagnostics.ts` to the same shape: when an out-of-scope match is found and the base severity is not `off`, emit the specific message at the base severity. Delete the last reads of `config.cross_file?.diagnostics?.out_of_scope`.
- Teach `extract_symbol_name_from_diagnostic` to parse `Potentially undefined variable: <name>` so the rewrite fires for variables whenever `undefinedVariable` is enabled.
- When the analyzer detects a same-file forward reference to a macro or global, emit `OUT_OF_SCOPE_SYMBOL` with a specific `used before it is defined (line N)` message instead of the generic undefined wording.
- Introduce a shared message helper (`src/providers/out-of-scope-message.ts`) so the analyzer and the provider produce identical wording for the cases they share.

## Non-goals

- Position-aware forward-reference analysis for variables inside a single file (see #147).
- Moving all same-file and cross-file enrichment into a unified provider-side pipeline (see #148).
- Changing the default for `sight.diagnostics.severity.undefinedMacro`. It stays `'warning'`. Stata is a dynamic language and the Pylance/Ruff default (warning, opt-in strict → error) fits better than the TypeScript default (error).
- Changing the default for `sight.diagnostics.severity.undefinedVariable`. It stays `'off'`. Once #147 lands and improves signal quality, revisit.
- Any change to hover or completion out-of-scope behavior. They are independent of this rewrite.

## Design

### Configuration

Delete `sight.crossFile.diagnostics.outOfScope` and the corresponding `CrossFileConfig.diagnostics.out_of_scope` field in `src/types/index.ts:710`. Remove it from the default settings in `src/server-handlers.ts:134` and from the workspace-config mapper (`src/utils/workspace-config.ts`). The sibling keys `missing_file` and `max_depth` stay — those really are independent diagnostic sources.

The config validator (`src/utils/config-validator.ts`) accepts the old `crossFile.diagnostics.outOfScope` key as a deprecated alias for one release. When present, it logs a warning ("`crossFile.diagnostics.outOfScope` is no longer used; severity is now inherited from `diagnostics.severity.undefinedMacro`/`undefinedVariable`") and discards the value.

### Runtime flow

The two rewrite branches in `src/providers/diagnostics.ts` (backward/directive at ~260-306, forward-call at ~310-389) collapse to the same control flow:

```
for each diagnostic with code UNDEFINED_MACRO or UNDEFINED_VARIABLE:
  symbol_name = extract_symbol_name_from_diagnostic(diag)
  if not symbol_name: keep base diagnostic

  match = find_out_of_scope_match(resolved_scope, forward_call_sites, symbol_name, reference_scope)
  if not match: keep base diagnostic

  base_severity = config.diagnostics.severity[diag.code === UNDEFINED_MACRO ? 'undefinedMacro' : 'undefinedVariable']
  if base_severity === 'off': suppress entirely (no base, no rewrite)

  emit OUT_OF_SCOPE_SYMBOL:
    range    = diag.range
    severity = severity_to_lsp(base_severity)
    message  = format_out_of_scope_message(symbol_name, match.reason)
    code     = OUT_OF_SCOPE_SYMBOL
    source   = 'sight'
```

Concretely:

- Every read of `config.cross_file?.diagnostics?.out_of_scope` in `src/providers/diagnostics.ts` (four sites: ~284, ~301, ~356, ~385) deletes.
- `cross_file_severity_to_lsp` at ~858-871 becomes `severity_to_lsp` with input union `'error' | 'warning' | 'information'` (no `'off'` since suppression is handled upstream). If the existing `convert_semantic_diagnostic` path already maps base severities to LSP severities correctly, reuse it instead of keeping two helpers.
- The `is_symbol_defined_in_current_document` short-circuit at ~358-380 stays. Its semantics change slightly: with the analyzer now emitting `OUT_OF_SCOPE_SYMBOL` for same-file forward references (see below), "preserve the analyzer's diagnostic" means preserving a specific same-file forward-ref diagnostic instead of a generic undefined one. That is exactly what we want.
- Match-finding on the backward path continues to use `resolved_scope.out_of_scope_symbols.find(...)`. On the forward path it continues to walk `get_visible_forward_call_sites(...)`. The two remain separate data sources; only the emit stage converges.

### Shared message helper

New module `src/providers/out-of-scope-message.ts`:

```ts
export type OutOfScopeReason =
  | { kind: 'after_call_site'; call_site_line: number; source_file: string }
  | { kind: 'inheritance_excludes_locals'; source_file: string }
  | { kind: 'same_file_forward'; defined_line: number };

export function format_out_of_scope_message(
    symbol_name: string,
    reason: OutOfScopeReason
): string;
```

Wording (all line numbers 1-indexed in the output):

- `after_call_site` → `` `foo' is defined in parent.do but after the call site (line 42) `` (unchanged from today)
- `inheritance_excludes_locals` → `` `foo' is defined in parent.do but local macros are not inherited via do/run (use include or @lsp-included-by) `` (unchanged from today)
- `same_file_forward` → `` `foo' is used before it is defined (line 42) `` (new)

The helper is the single place these strings live. Both `src/providers/diagnostics.ts` (for cross-file cases) and `src/analyzer/index.ts` (for same-file cases) call it. A unit test covers each variant.

### Variable extraction

Add one match to `extract_symbol_name_from_diagnostic` in `src/providers/diagnostics.ts:880-894`:

```ts
const variable_match = diagnostic.message.match(
    /^Potentially undefined variable: ([a-zA-Z_][a-zA-Z0-9_]*)$/
);
if (variable_match) return variable_match[1];
```

Order is irrelevant; the patterns are mutually exclusive. This single change makes the cross-file out-of-scope rewrite fire for variables whenever `undefinedVariable` is enabled. Same-file forward-reference analysis for variables is out of scope (#147).

### Same-file forward references in the analyzer

In `src/analyzer/index.ts:2631-2674`, the undefined-macro and undefined-global branches already call `is_macro_defined(name, scope, symbols, undefined, token_line)`. Today, when that returns `false` at the reference line but the symbol exists in `symbols.localMacros` or `symbols.globalMacros` (defined later in the file), both cases emit the generic undefined diagnostic.

After this change, the branches check for a later same-file definition and emit `OUT_OF_SCOPE_SYMBOL` with the `same_file_forward` message when one exists:

```ts
const token_line = token.range.start.line;
if (macro_name && !this.is_macro_defined(macro_name, 'local', symbols, undefined, token_line)) {
    const same_file_def = symbols.localMacros.get(macro_name);
    if (same_file_def) {
        diagnostics.push({
            message: format_out_of_scope_message(macro_name, {
                kind: 'same_file_forward',
                defined_line: same_file_def.location.range.start.line + 1,
            }),
            range: token.range,
            code: StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
            severity: 'warning',
        });
    } else {
        diagnostics.push({
            message: `Undefined local macro: \`${macro_name}'`,
            range: token.range,
            code: StataDiagnosticCode.UNDEFINED_MACRO,
            severity: 'warning',
        });
    }
}
```

Same structure for the global branch at ~2640-2674, using `symbols.globalMacros` and `$name` wording when no same-file definition exists.

The analyzer continues to emit an internal severity of `'warning'`. The provider's `convert_semantic_diagnostic` path already translates that through `config.diagnostics.severity.undefinedMacro`, so the final LSP severity tracks user configuration. The diagnostic code on the wire is `OUT_OF_SCOPE_SYMBOL` (not `UNDEFINED_MACRO`), which lets the provider's rewrite logic short-circuit when it encounters a same-file forward-ref diagnostic that is already fully formed.

### Provider short-circuit for analyzer-formed OUT_OF_SCOPE_SYMBOL

When the provider iterates over semantic diagnostics and sees an already-formed `OUT_OF_SCOPE_SYMBOL` (i.e., one produced by the analyzer for a same-file forward reference), it passes it through unchanged. The cross-file match-finding only runs for diagnostics with code `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE`. This keeps the two sources from fighting over the same range.

## Testing

### Unit tests

- **Message helper** (`tests/unit/out-of-scope-message.test.ts`, new) — cover all three `OutOfScopeReason` variants; assert exact strings.
- **Symbol extractor** (`tests/unit/diagnostics-provider.test.ts`, existing) — add cases for `Potentially undefined variable: foo`; regression coverage for the macro/global formats.
- **Provider rewrite severity** (`tests/unit/diagnostics-provider.test.ts`, existing) — replace assertions that `OUT_OF_SCOPE_SYMBOL` severity comes from `crossFile.diagnostics.outOfScope` with assertions that it matches the mapped base severity. Add a case: base `off` ⇒ no `OUT_OF_SCOPE_SYMBOL` emitted (and no base diagnostic either).
- **Analyzer same-file forward-ref** (`tests/unit/analyzer/forward-ref.test.ts` or similar, new) — macro defined on line 10 and referenced on line 5 ⇒ `OUT_OF_SCOPE_SYMBOL` with `used before it is defined (line 10)`; macro truly undefined ⇒ unchanged `UNDEFINED_MACRO` generic message; same coverage for globals.
- **Validator deprecation** (`tests/unit/config-validator.test.ts`, existing) — old `crossFile.diagnostics.outOfScope` key logs a warning and is ignored; no crash if it is the only crossFile-diagnostics key present.

### Property tests

- `tests/property/forward-call-out-of-scope-oracle.prop.test.ts` — update the oracle to predict `OUT_OF_SCOPE_SYMBOL` whenever the base would fire and an out-of-scope match exists. The existing assertion at ~line 495 that the forward path falls back to plain `UNDEFINED_MACRO` when `outOfScope = off` deletes; that branch no longer exists.
- `tests/property/out-of-scope-diagnostic-correctness.prop.test.ts` and `tests/property/out-of-scope-diagnostic-message-fix.prop.test.ts` — drop references to the old setting; add a parity property: for equivalent backward and forward out-of-scope scenarios, the emitted `OUT_OF_SCOPE_SYMBOL` has the same severity and code.
- `tests/property/severity-settings.prop.test.ts` — drop `outOfScope` from the severity matrix. Add properties: (a) `undefinedMacro = off` ⇒ no `OUT_OF_SCOPE_SYMBOL` emitted for macros; (b) emitted `OUT_OF_SCOPE_SYMBOL` severity equals mapped `undefinedMacro` / `undefinedVariable` severity.

### Integration tests

- `tests/integration/out-of-scope-diagnostic-message-bug.test.ts`, `local-macro-inheritance-bug.test.ts`, `cross-file-awareness.test.ts`, `callee-revalidation.test.ts` — adjust config fixtures that set `crossFile.diagnostics.outOfScope`; adjust expected severities to track the base.
- **New**: same-file forward-ref macro (no cross-file setup) ⇒ asserts `OUT_OF_SCOPE_SYMBOL` with `used before it is defined` message and correct line number.
- **New**: cross-file out-of-scope variable (with `undefinedVariable='warning'` in test config) ⇒ asserts the rewrite now fires. Regression gate for the variable-extractor change.

### Documentation

- `docs/configuration.md` — remove the `crossFile.diagnostics.outOfScope` entry. Under the `diagnostics.severity.undefinedMacro` / `undefinedVariable` entries, add a short note: "When the scope resolver can prove a referenced symbol exists but is unreachable (defined later in the same file, defined after the call site in a parent file, or excluded by `do`/`run` inheritance), the diagnostic is replaced with a specific `OUT_OF_SCOPE_SYMBOL` message at the same severity."
- `docs/cross-file.md` — remove the `outOfScope` severity column from any configuration tables; reframe out-of-scope as "a specific form of the undefined-symbol diagnostic, not a separate source."
- `CLAUDE.md` — no changes required. The architecture description at the top of the file already describes `OUT_OF_SCOPE_SYMBOL` correctly as a rewrite.

## Migration & release notes

- **BREAKING (config).** `sight.crossFile.diagnostics.outOfScope` is removed. The validator accepts it as a deprecated alias for one release (logs a warning, ignored). After that, it will be rejected as an unknown key.
- **BEHAVIOR CHANGE.** Users who had `outOfScope = off` will start seeing the out-of-scope rewrite. The severity now matches their `undefinedMacro` / `undefinedVariable` setting (default `'warning'` for macros, default `'off'` for variables). To silence the rewrite, set the corresponding base setting to `'off'`.
- **BEHAVIOR CHANGE.** Users who had `outOfScope = error` and rely on escalation above the base will lose that capability. To keep escalation, raise the base `undefinedMacro` to `'error'`.
- **NEW.** The cross-file out-of-scope rewrite now applies to variables when `undefinedVariable` is enabled (previously dead code).
- **NEW.** Same-file forward references to macros and globals get a specific `used before it is defined (line N)` message with diagnostic code `OUT_OF_SCOPE_SYMBOL`.

## Risks

- **Variable rewrite side effects.** The variable rewrite path was previously dead. Wiring it up may expose scope-resolver edge cases for variables not previously stressed (e.g., inheritance rules for variables through `do` chains). Property and integration tests exercise the common paths, but watch for reports after release.
- **Same-file forward-ref false positives.** The analyzer's same-file position tracking is already used for the generic undefined diagnostic, so this change reuses proven logic. The new risk is the diagnostic code change (`UNDEFINED_MACRO` → `OUT_OF_SCOPE_SYMBOL`) — any downstream consumer that filters by code needs to include both.
- **Deprecation-alias window.** If the ignored-alias warning is noisy, users on older configs will see validator spam until they migrate. Acceptable; that is the point.
