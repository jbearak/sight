# Out-of-scope diagnostic cleanup

**Status:** design
**Date:** 2026-04-22
**Scope:** Remove the misnamed `crossFile.diagnostics.outOfScope` severity setting, fix the `off`-branch divergence between the backward and forward rewrite paths, make the rewrite fire for the variable-diagnostic path, give same-file forward references the same specific message that cross-file forward references already get, and ensure `@lsp-ignore` suppression covers out-of-scope rewrites.

## Problem

`OUT_OF_SCOPE_SYMBOL` is not an independent diagnostic source. It is a rewrite of an existing `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE` diagnostic into a more informative message, emitted when the scope resolver can prove the symbol exists but is unreachable at the reference site. The current shape of this feature has five problems:

1. **The setting is shaped wrong.** `sight.crossFile.diagnostics.outOfScope: error | warning | information | off` is modeled as a severity, but the rewrite is not a source — turning it `off` should not silence a diagnostic the user otherwise wants, and setting it independently of the base undefined-symbol severity invites incoherent combinations (e.g., base `off` + out-of-scope `error`).

2. **The backward and forward paths diverge on `off`.** In `src/providers/diagnostics.ts:281-286`, `outOfScope = off` suppresses the rewrite entirely on the backward/directive path, losing any diagnostic. In the forward-call path (`tests/property/forward-call-out-of-scope-oracle.prop.test.ts:495`), the same value falls back to plain `UNDEFINED_MACRO`. Same setting, different behavior.

3. **The rewrite is dead code for variables.** `OutOfScopeSymbol` and `filter_by_call_site` carry variables through (`src/scope-resolver/index.ts:2029-2058`), but `extract_symbol_name_from_diagnostic` (`src/providers/diagnostics.ts:880-894`) only parses macro formats. When the base diagnostic message is `Potentially undefined variable: foo`, no name is extracted and the rewrite never triggers. In addition, `extract_macro_scope_from_diagnostic` (`src/providers/diagnostics.ts:1196-1216`) only returns `'local'` or `'global'`, and `out_of_scope_type_matches_reference` falls back to `true` when the reference kind is `null` — so even if extraction succeeded for a variable, kind matching would be lossy.

4. **Same-file forward references get a generic message.** The analyzer knows, via the preorder-traversal index and `is_macro_defined(..., token_line)`, that `` `foo' `` on line 5 refers to a macro defined on line 10. It still emits the generic `` Undefined local macro: `foo' ``. Cross-file forward references get a specific "defined in X but after the call site" message. The UX is asymmetric for no reason.

5. **`@lsp-ignore` does not suppress out-of-scope rewrites.** The suppression helper (`src/providers/diagnostics.ts:642-665`) runs inside `convert_semantic_diagnostic` and is only invoked for diagnostics with code `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE`. The current rewrite emit sites (lines ~298-305 and ~381-388) push fully-formed LSP diagnostics directly, bypassing the suppression check. This is a latent bug.

A separate issue (#148) tracks the larger question of unifying same-file and cross-file enrichment into a single provider-side pipeline. A separate issue (#147) tracks true position-aware forward-reference analysis for variables. This spec handles only the cleanup, parity, and correctness work.

## Goals

- Delete `sight.crossFile.diagnostics.outOfScope` outright. Severity of every `OUT_OF_SCOPE_SYMBOL` rewrite is derived from the base `undefinedMacro` / `undefinedVariable` severity setting.
- Collapse the backward and forward rewrite branches in `src/providers/diagnostics.ts` to the same shape.
- Do all rewrites in the provider. The analyzer continues to emit `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE` unchanged. Any current or future analyzer emission site for undefined symbols picks up the rewrite for free.
- Add same-file forward-reference rewriting to the provider: when an undefined-macro / undefined-global reference has a matching later definition in the current document, emit `OUT_OF_SCOPE_SYMBOL` with `used before it is defined (line N)`.
- Teach `extract_symbol_name_from_diagnostic` to parse `Potentially undefined variable: <name>` so the variable-diagnostic path can feed the rewrite.
- Add proper reference-kind classification (`local | global | variable | null`) and tighten `out_of_scope_type_matches_reference` so a variable reference only matches a variable out-of-scope entry (and similarly for macros). Scalars, matrices, and programs are deliberately excluded from variable-kind matching — see "Bare-identifier scoping" below.
- Introduce a shared message helper in a neutral module (`src/utils/out-of-scope-message.ts`) that formats the message for any supported symbol kind and reason.
- Ensure every rewrite goes through the existing `should_suppress_undefined_symbol` check so `@lsp-ignore` / `@lsp-ignore-next` are honored uniformly.

## Non-goals

- Position-aware same-file forward-reference analysis for variables (see #147). The variable path only gains out-of-scope rewriting for diagnostics the analyzer already emits; it does not gain new forward-reference detection inside a single file.
- Unifying same-file and cross-file enrichment into a general provider-side pipeline (see #148).
- Scalar-aware analysis. Bare identifiers in expression contexts that act as scalars (e.g., `display x + 1` where `x` is a `scalar`) are not diagnosed today and remain un-diagnosed by this spec. A separate, opt-in strictness mode for scalar-like references is tracked in #149 and is explicitly non-blocking for this work.
- Changing defaults for `sight.diagnostics.severity.undefinedMacro` or `undefinedVariable`. Both stay where they are. Stata is dynamic; the Pylance/Ruff model (warning by default, opt-in strict) fits better than the TypeScript model.
- Any change to hover or completion out-of-scope behavior.
- Migration support for the removed setting — see the next section.

## Design

### Configuration

- Delete `sight.crossFile.diagnostics.outOfScope` from the user-facing schema.
- Delete `CrossFileConfig.diagnostics.out_of_scope` from `src/types/index.ts:710`.
- Remove the default from `src/server-handlers.ts:134`.
- Remove any mapping of the key from `src/utils/workspace-config.ts`.
- Remove any validation branch for the key from `src/utils/config-validator.ts`.
- Remove references from `docs/configuration.md` and `docs/cross-file.md`.

**No deprecation support.** The key is removed; there is no alias, no warning, no logging. If a user config still contains the old key, the validator's existing handling of unrecognized keys applies (typically a silent no-op; confirm during implementation). This is a deliberate simplification: the setting is narrow, the project is early, and migration machinery is not worth the code.

The sibling keys `crossFile.diagnostics.missing_file` and `crossFile.diagnostics.max_depth` stay — those really are independent diagnostic sources.

### Rewrite belongs entirely to the provider

The analyzer is not changed by this spec. It continues to emit `UNDEFINED_MACRO` and `UNDEFINED_VARIABLE` with the same wording and severity it does today (`src/analyzer/index.ts:2634`, `2669`, `2364`). All three rewrite forms live in `src/providers/diagnostics.ts`:

1. **Cross-file backward / directive** — matched against `resolved_scope.out_of_scope_symbols` (existing path at ~260-306).
2. **Cross-file forward-call** — matched against the forward-call walk (existing path at ~310-389).
3. **Same-file forward reference** — matched against `document.symbols.localMacros` / `document.symbols.globalMacros` with a later `location.range.start.line` than the reference line (new branch, integrated into the same diagnostic iteration).

Putting the rewrite in the provider guarantees that any undefined-symbol diagnostic — regardless of which analyzer path (token-based today, AST-based in the future) produced it — can be rewritten consistently. It also avoids introducing a third emitter of `OUT_OF_SCOPE_SYMBOL` and keeps the diagnostic-code discipline clean (the analyzer emits source codes only; rewrites belong downstream).

### Unified control flow

For each semantic diagnostic with code `UNDEFINED_MACRO` or `UNDEFINED_VARIABLE`:

```
1. ref_kind = classify_reference_kind(diag)          // 'local' | 'global' | 'variable' | null
2. name     = extract_symbol_name_from_diagnostic(diag)
   if !name: convert and emit the base diagnostic unchanged; continue.

3. match = find_out_of_scope_match(
       diag, name, ref_kind,
       resolved_scope,          // for cross-file backward matches
       forward_call_sites,      // for cross-file forward matches
       document.symbols         // for same-file forward matches
   )
   if !match: convert and emit the base diagnostic unchanged; continue.

4. Build a synthetic SemanticDiagnostic for the rewrite:
       message  = format_out_of_scope_message(name, match.kind, match.reason)
       range    = diag.range
       code     = OUT_OF_SCOPE_SYMBOL
       severity = diag.severity                      // analyzer-produced, e.g. 'warning'
   Feed it through convert_semantic_diagnostic, which:
       - runs should_suppress_undefined_symbol (extended to cover OUT_OF_SCOPE_SYMBOL)
       - maps severity using the *base* code (see below)
   If the converter returns null (suppressed or disabled), drop the diagnostic
   entirely — do not fall back to the base diagnostic.
```

`find_out_of_scope_match` prefers matches in this order, with the first winning:

1. Same-file later definition (kind must match `ref_kind`).
2. Cross-file backward (call-site-filtered `out_of_scope_symbols`, kind must match).
3. Cross-file forward-call excluded-by-later-redef (kind must match).

Same-file preference preserves the existing short-circuit intent at diagnostics.ts:358-380 (prefer the more local explanation).

### Severity inheritance (including `hint`)

`convert_semantic_diagnostic` currently maps `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE` severity by reading `config.diagnostics.severity.undefinedMacro` / `undefinedVariable`. It supports all four values: `'error' | 'warning' | 'information' | 'hint'` (plus `'off'`, which returns `null` to suppress).

For `OUT_OF_SCOPE_SYMBOL`, the converter must look up the severity of the **base code the rewrite stands in for**:

- `ref_kind === 'local' | 'global'` → use `undefinedMacro`.
- `ref_kind === 'variable'` → use `undefinedVariable`.

Because this code path needs to know the base code, the simplest wiring is to plumb a `base_code` field on the synthetic semantic diagnostic (optional, used only for rewrites) and have `convert_semantic_diagnostic` treat `code === OUT_OF_SCOPE_SYMBOL` as "read severity from `base_code`". All four values — including `'hint'` — flow through unchanged. `'off'` suppresses the rewrite completely.

```ts
type SemanticDiagnostic = {
    message: string;
    range: Range;
    code: StataDiagnosticCode;
    severity: 'error' | 'warning' | 'information' | 'hint';
    base_code?: StataDiagnosticCode; // set iff code === OUT_OF_SCOPE_SYMBOL
};
```

The `base_code` field stays internal (not part of the LSP Diagnostic shape). Every rewrite site sets it.

### `@lsp-ignore` suppression

`should_suppress_undefined_symbol` already inspects the range, not the code. Extend the gating check in `convert_semantic_diagnostic` at line 683-684 so it also applies when `diagnostic.code === OUT_OF_SCOPE_SYMBOL`:

```ts
if (document &&
    (diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO ||
     diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE ||
     diagnostic.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL)) {
    if (this.should_suppress_undefined_symbol(document, diagnostic.range)) {
        return null;
    }
}
```

Behavior:
- `@lsp-ignore` on the reference line suppresses the rewrite (just like it suppresses the base diagnostic).
- `@lsp-ignore-next` on the previous line does the same.
- `diagnostics.severity.undefinedMacro = 'off'` suppresses both the base diagnostic and the macro-form rewrite (because the converter returns `null` for `'off'`).
- `diagnostics.severity.undefinedVariable = 'off'` does the same for the variable-form rewrite.
- The removed `crossFile.diagnostics.outOfScope` no longer participates; its absence does not introduce any new suppression case.

### Bare-identifier scoping

The scope resolver's `OutOfScopeSymbol.type` is a broad union: `'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix'`. It is tempting to let an undefined-variable reference rewrite against any of these, since a bare identifier in Stata source code could, in principle, be any of them. This spec intentionally does not do that. The scope of the variable-diagnostic rewrite is narrow: **a variable-kind reference matches only a variable out-of-scope entry.**

Justification:

- **Matrices.** Matrix references in Stata are almost always mediated by matrix syntax (`matrix rowname`, `matrix list`, `mat x = ...`) or the `matrix()` function, not by bare identifiers in varlist positions. Matching `Potentially undefined variable: foo` against an out-of-scope matrix named `foo` would produce a misleading diagnostic telling the user a matrix is "out of scope" when their code actually meant a dataset variable.
- **Programs.** Program references appear in command position, not varlist position. The analyzer emits `UNDEFINED_VARIABLE` only from varlist-position checks (`src/analyzer/index.ts:2356-2371`); a program of the same name is never the intended target.
- **Scalars.** Scalar references in Stata are typically written as `scalar x` or `scalar(x)` in expression contexts, not as bare varlist identifiers. Matching `variable → scalar` could be useful in expression-position ambiguities, but the analyzer does not currently distinguish expression-position from varlist-position identifiers — the `UNDEFINED_VARIABLE` diagnostic is only emitted from varlist positions, so broadening the matcher without a classifier improvement would produce false positives in varlist contexts. The right path is to add an opt-in strictness mode (tracked in #149) that first teaches the analyzer to detect scalar-like positions, then widens the matcher in concert.

In short: this spec keeps matching symmetric and conservative — `local ↔ local`, `global ↔ global`, `variable ↔ variable`. Anything broader is #149.

### Reference-kind classification

Replace the narrow `extract_macro_scope_from_diagnostic` with a broader classifier that returns `'local' | 'global' | 'variable' | null`:

```ts
private classify_reference_kind(
    diagnostic: { message: string; code: number }
): 'local' | 'global' | 'variable' | null {
    if (diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
        return 'variable';
    }
    if (diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO) {
        if (/`[^']+'/.test(diagnostic.message)) return 'local';
        if (/\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/.test(diagnostic.message)) return 'global';
    }
    return null;
}
```

`out_of_scope_type_matches_reference` (diagnostics.ts:1230-1250) is tightened to require exact equality between reference kind and the out-of-scope symbol type — no lossy fallback:

```ts
private out_of_scope_type_matches_reference(
    out_of_scope_type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix',
    reference_kind: 'local' | 'global' | 'variable' | null
): boolean {
    if (reference_kind === null) return false;
    return reference_kind === out_of_scope_type;
}
```

Consequences:
- A local-macro reference only matches an out-of-scope `local`.
- A global-macro reference only matches an out-of-scope `global`.
- A variable-diagnostic reference only matches an out-of-scope `variable`. Out-of-scope `scalar`, `matrix`, and `program` entries are never matched by the variable-diagnostic path and remain reachable via hover / completion out-of-scope display (unchanged). See "Bare-identifier scoping" above for the rationale and #149 for the future scalar-aware mode.
- Unknown reference kinds do not match anything. This is stricter than today's fallback; during implementation, add a focused regression test if any existing fixture exercises the `null` branch (none is expected).

### Variable name extraction

Add one match to `extract_symbol_name_from_diagnostic` (diagnostics.ts:880-894):

```ts
if (diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
    const variable_match = diagnostic.message.match(
        /^Potentially undefined variable: ([a-zA-Z_][a-zA-Z0-9_]*)$/
    );
    if (variable_match) return variable_match[1];
    return null;
}
```

The function can early-return on code to avoid accidentally matching macro-format patterns against variable messages.

### Shared message helper

New module: `src/utils/out-of-scope-message.ts`. Placed under `src/utils/` rather than `src/providers/` so the analyzer, any future diagnostic emitter, or tests can import it without coupling to provider internals.

```ts
export type OutOfScopeSymbolKind = 'local' | 'global' | 'variable';

export type OutOfScopeReason =
    | { kind: 'after_call_site'; call_site_line_0: number; source_file: string }
    | { kind: 'inheritance_excludes_locals'; source_file: string }
    | { kind: 'same_file_forward'; defined_line_0: number };

export function format_out_of_scope_message(
    symbol_name: string,
    symbol_kind: OutOfScopeSymbolKind,
    reason: OutOfScopeReason
): string;
```

The helper's `OutOfScopeSymbolKind` union is deliberately narrower than `OutOfScopeSymbol.type`. Because the strict kind matcher rejects every match except `local ↔ local`, `global ↔ global`, and `variable ↔ variable`, the helper is never invoked with `scalar`, `matrix`, or `program` — keeping those out of the union prevents dead formatting code. When #149 adds scalar-aware matching, the helper's union (and matcher) widens in the same change.

**Display-name formatting** (from `symbol_name` + `symbol_kind`):

- `local` → `` `foo' ``
- `global` → `$foo`
- `variable` → `foo` (bare; no decoration)

**Line-number contract.** The helper accepts **0-indexed** line numbers in `call_site_line_0` and `defined_line_0` and converts them to 1-indexed for display. This matches the internal representation used throughout the codebase (`OutOfScopeSymbol.call_site_line` is 0-indexed per scope-resolver comment at line 2027; AST ranges are 0-indexed). Field names carry the `_0` suffix so the contract is visible at call sites. The `+ 1` conversion lives in the helper and nowhere else.

**Message wording** (display name = DN):

- `after_call_site` → `DN is defined in <source_file> but after the call site (line <call_site_line_0 + 1>)`
- `inheritance_excludes_locals` → `DN is defined in <source_file> but local macros are not inherited via do/run (use include or @lsp-included-by)`
- `same_file_forward` → `DN is used before it is defined (line <defined_line_0 + 1>)`

Unit tests cover every `(kind, reason)` combination that actually occurs:
- `local × {after_call_site, inheritance_excludes_locals, same_file_forward}`
- `global × {after_call_site, same_file_forward}`
- `variable × {after_call_site}`

Impossible combinations (e.g., `variable × inheritance_excludes_locals`, which only applies to locals by definition; `variable × same_file_forward`, which depends on analyzer work deferred to #147) are simply never constructed; the helper does not need to reject them. Kinds outside the narrowed union (`scalar`, `matrix`, `program`) are enforced by TypeScript rather than by tests.

### Code deletions

- The four reads of `config.cross_file?.diagnostics?.out_of_scope` in `src/providers/diagnostics.ts`.
- `cross_file_severity_to_lsp` (diagnostics.ts:858-871) — no remaining callers once the reads above are gone.
- Any symbol exports and doc references to the removed config key.

## Testing

### Unit tests

- **Message helper** (`tests/unit/out-of-scope-message.test.ts`, new) — cover every `(kind, reason)` combination listed above; assert exact strings, including 1-indexed line numbers derived from 0-indexed inputs.
- **Symbol extractor** (`tests/unit/diagnostics-provider.test.ts`, existing) — add variable-format cases (`Potentially undefined variable: foo` → `foo`) and a case where a macro-format message is not accidentally parsed as a variable. Retain regression coverage for local and global macro formats.
- **Reference-kind classifier** (`tests/unit/diagnostics-provider.test.ts`) — one case per `(code, message shape) → kind` expectation, plus a `null` fallback case for unrecognized shapes.
- **Kind matcher** (`tests/unit/diagnostics-provider.test.ts`) — variable-kind reference only matches variable out-of-scope entries; explicit negative cases for scalar, matrix, program, local, and global. Macro-kind references correspondingly do not match variable entries.
- **Rewrite severity** (`tests/unit/diagnostics-provider.test.ts`) — base `undefinedMacro` at each of `error | warning | information | hint` propagates to the `OUT_OF_SCOPE_SYMBOL` severity; `off` yields `null` (no diagnostic emitted). Same matrix for the variable branch keyed to `undefinedVariable`.
- **`@lsp-ignore` coverage** (`tests/unit/diagnostics-provider.test.ts`) — `@lsp-ignore` and `@lsp-ignore-next` at the reference line both suppress `OUT_OF_SCOPE_SYMBOL` rewrites, for all three rewrite forms (same-file, cross-file backward, cross-file forward).
- **Same-file forward-ref rewrite** (`tests/unit/diagnostics-provider.test.ts`) — macro referenced before it is defined ⇒ `OUT_OF_SCOPE_SYMBOL` with `used before it is defined (line N)` at the correct 1-indexed line; truly undefined macro ⇒ unchanged `UNDEFINED_MACRO` generic message.

### Property tests

- `tests/property/forward-call-out-of-scope-oracle.prop.test.ts` — update the oracle to predict `OUT_OF_SCOPE_SYMBOL` whenever an out-of-scope match exists and the base severity is not `off`. The existing assertion (~line 495) that the forward path falls back to plain `UNDEFINED_MACRO` when `outOfScope = off` deletes; that setting is gone.
- `tests/property/out-of-scope-diagnostic-correctness.prop.test.ts`, `tests/property/out-of-scope-diagnostic-message-fix.prop.test.ts` — drop references to the old setting. Add a parity property: for equivalent same-file, backward, and forward scenarios, the emitted `OUT_OF_SCOPE_SYMBOL` has identical severity (controlled by base) and identical code.
- `tests/property/severity-settings.prop.test.ts` — drop `outOfScope` from the severity matrix. Add properties: (a) `undefinedMacro = off` ⇒ no macro-kind `OUT_OF_SCOPE_SYMBOL`; (b) `undefinedVariable = off` ⇒ no variable-kind `OUT_OF_SCOPE_SYMBOL`; (c) for any non-`off` base severity, the rewrite is emitted at exactly that severity.
- `tests/property/diagnostic-suppression.test.ts` — extend to cover `@lsp-ignore` / `@lsp-ignore-next` suppressing `OUT_OF_SCOPE_SYMBOL` rewrites.

### Integration tests

- `tests/integration/out-of-scope-diagnostic-message-bug.test.ts`, `local-macro-inheritance-bug.test.ts`, `cross-file-awareness.test.ts`, `callee-revalidation.test.ts` — strip any config fixtures setting the removed `crossFile.diagnostics.outOfScope`; adjust expected severities to match the base.
- **New**: same-file forward-reference macro (no cross-file setup) ⇒ asserts `OUT_OF_SCOPE_SYMBOL` with the `used before it is defined` message at the correct line.
- **New**: cross-file out-of-scope variable with `undefinedVariable = 'warning'` ⇒ asserts the variable-form rewrite fires (regression gate for the extractor + classifier changes).
- **New**: `@lsp-ignore` at the reference line suppresses the rewrite for each of the three rewrite forms.

### Documentation

- `docs/configuration.md` — remove the `crossFile.diagnostics.outOfScope` entry entirely. Under `diagnostics.severity.undefinedMacro` / `undefinedVariable`, add a short note: "When the scope resolver can prove a referenced symbol exists but is unreachable (defined later in the same file, defined after the call site in a parent file, or excluded by `do`/`run` inheritance), the diagnostic is replaced with a specific `OUT_OF_SCOPE_SYMBOL` message at the same severity."
- `docs/cross-file.md` — remove the `outOfScope` severity entry. Reframe out-of-scope as "a specific form of the undefined-symbol diagnostic, not a separate source."
- `CLAUDE.md` — no changes required.

## Migration & release notes

- **BREAKING (config).** `sight.crossFile.diagnostics.outOfScope` is removed. No alias, no warning. Users who still have the key in their `.sight.json` will simply find it ignored (the validator's generic unrecognized-key handling applies).
- **BEHAVIOR CHANGE.** Users who had `outOfScope = off` will start seeing the out-of-scope rewrite. Severity now matches their `undefinedMacro` / `undefinedVariable` setting (default `'warning'` for macros, default `'off'` for variables). To silence the rewrite, set the corresponding base setting to `'off'`.
- **BEHAVIOR CHANGE.** Users who had `outOfScope = error` and relied on out-of-scope being more severe than the base will lose that escalation. To keep escalation, raise the base `undefinedMacro` to `'error'`.
- **NEW.** The cross-file out-of-scope rewrite now applies to the undefined-variable diagnostic when `undefinedVariable` is enabled. This does not extend variable analysis itself; it only routes existing undefined-variable diagnostics through the rewrite path when the scope resolver has a matching entry.
- **NEW.** Same-file forward references to macros and globals get a specific `used before it is defined (line N)` diagnostic with code `OUT_OF_SCOPE_SYMBOL`.
- **BUG FIX.** `@lsp-ignore` and `@lsp-ignore-next` now suppress `OUT_OF_SCOPE_SYMBOL` rewrites, matching their existing behavior for `UNDEFINED_MACRO` / `UNDEFINED_VARIABLE`.

## Risks

- **Tightened kind matching.** Changing `out_of_scope_type_matches_reference` from `null → true` to `null → false` could, in theory, stop matching cases where extraction fails. The classifier covers the cases the current analyzer actually produces, so this should be a net improvement; focused tests guard the expected shapes.
- **Variable rewrite blast radius.** The variable rewrite path was previously dead. Wiring it up may expose edge cases in scope-resolver variable handling that were never exercised. Property and integration tests cover the common shapes; watch for reports after release.
- **Diagnostic code drift for consumers.** Same-file forward references previously surfaced as `UNDEFINED_MACRO`; they will now surface as `OUT_OF_SCOPE_SYMBOL` whenever a later definition exists in the same file. Any downstream tool that filters by code must include both codes to see "undefined macro-like" diagnostics.
- **Removed setting with no warning.** Users on older configs who used the setting will see behavior change without any tooling signal beyond release notes. This is accepted explicitly in the migration plan.
