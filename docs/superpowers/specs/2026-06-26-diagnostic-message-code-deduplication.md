# Spec: Reword diagnostics whose message repeats the stable rule id

Issue: #206 — "Reword diagnostics whose message repeats the stable rule id"
Raven precedent: jbearak/raven#526
Date: 2026-06-26

## Problem

Sight renders diagnostics as `message [code]` in `sight check` text output
(`src/cli/shared.ts:235`) and in any surface that shows both the message and the
code. Several analyzer messages restate their stable rule id in prose:

- `Undefined local macro: \`x'` with code `UNDEFINED_MACRO`
- `Undefined global macro: $x` with code `UNDEFINED_MACRO`
- `Potentially undefined variable: x` with code `UNDEFINED_VARIABLE`

In text output these read as `Undefined local macro: \`x' [UNDEFINED_MACRO]` —
the words "Undefined ... macro" duplicate the code, which is the suppression
handle. The human message should add context (what is not defined) and let the
code carry the rule classification.

Raven's fix kept the `[rule-id]` suffix but reworded prose that merely repeated
the id: `Undefined variable: x [undefined-variable]` became
`x is not defined [undefined-variable]`.

## Goal / non-goals

Goal: reword the genuinely duplicative human messages while keeping diagnostic
`code` values byte-for-byte stable, and first move any production logic that
recovers data from message *prose* onto structured diagnostic data so the
rewording cannot break behavior.

Non-goals:
- Removing or renumbering any `StataDiagnosticCode` or `SIGHT_*` code.
- Removing the `[code]` suffix from text output.
- Rewording messages that already add context beyond their code (see Audit).
- Touching the LSP wire behavior other than message text (and a new optional
  `data` payload, which clients ignore by default).

## Audit of duplication (acceptance criterion 1)

Audited every diagnostic-producing site (analyzer, parser, lexer, providers,
`src/cli/source-files.ts`, directive/forward-scope resolvers). Classification:
does the prose merely restate the code (REWORD), or does it add context (KEEP)?

### REWORD — prose merely restates the code

| Code | Current message | Sites |
| --- | --- | --- |
| `UNDEFINED_MACRO` | `Undefined ${scope} macro: \`x'` / `$x` | analyzer/index.ts:2344, 2373, 2678, 2713 |
| `UNDEFINED_VARIABLE` | `Potentially undefined variable: x` | analyzer/index.ts:2408 |

These four `UNDEFINED_MACRO` sites and one `UNDEFINED_VARIABLE` site are the
only messages where the prose is a near-verbatim expansion of the code. They are
also the only undefined-symbol messages that downstream production code parses
(see Migration). This is the core of the issue.

### KEEP — prose adds context the code does not carry

The enumerated starting set also names "parser syntax errors" and "file-level
`SIGHT_*` check diagnostics". The audit finds these add context and are NOT
duplicative; they are the human-readable expansion of a terse identifier, not a
restatement of it:

- Parser (`src/parser/index.ts`): e.g. `BRACE_ELSE_SAME_LINE` →
  "else must appear on a separate line from close brace"; `OPEN_BRACE_ALONE` →
  "open brace must be on the same line as the condition";
  `CODE_AFTER_OPEN_BRACE` → "code after open brace may be silently ignored"
  (explains Stata runtime behavior). These describe the *rule* the code merely
  names; rewording would lose information, not remove duplication.
- File-level checks (`src/cli/source-files.ts`): `SIGHT_FILE_TOO_LARGE` carries
  actual vs configured byte counts; `SIGHT_FILE_NOT_INDEXED` explains the cause
  and remediation; `SIGHT_INVALID_ENCODING` gives the byte offset;
  `SIGHT_UNREADABLE` gives the errno detail. All add context.
- Lexer, indentation (5xxx), operator (6xxx) diagnostics: out of the issue's
  enumerated starting set; most already include suggestions/examples. Not
  reworded in this change.
- `INVALID_MACRO_CHAR` ("Invalid character in macro name"): borderline, but the
  message names *where* the problem is (in a macro name) and the code is an
  identifier, not prose the user reads alone. Left unchanged to keep scope tight
  and avoid churn; can be revisited if reviewers disagree.

### Scope decision (explicit, so reviewers need not re-raise)

Issue #206's acceptance criterion 1 names a *starting set*: `UNDEFINED_MACRO`,
`UNDEFINED_VARIABLE`, parser syntax errors, and file-level `SIGHT_*`. Within
that set, only `UNDEFINED_MACRO` and `UNDEFINED_VARIABLE` have prose that merely
restates the code, so rewording is confined to those two. The other named
families (parser, `SIGHT_*`) were audited (above) and deliberately kept because
their prose adds context.

Codes outside the named starting set were also checked and are explicitly NOT
reworded in this change, each for a stated reason:

- `MISSING_VARIABLE_NAME` (analyzer/index.ts:1462): "Missing variable name after
  storage type `x'" — "after storage type `x'" adds context (the trigger), so
  not pure duplication. Out of the issue's named set; left unchanged.
- `INVALID_MACRO_CHAR` (analyzer/index.ts:2667, 2702): borderline; names *where*
  the problem is. Out of named set; left unchanged.
- `MALFORMED_OPERATOR` / `INVALID_OPERATOR_SEQUENCE`
  (operator-sequence-diagnostics.ts): include a "Did you mean ...?" suggestion —
  context, not duplication. Out of named set (6xxx); left unchanged.
- `UNNECESSARY_INDENTATION` (indentation-diagnostics.ts:152, 589): out of named
  set (5xxx); left unchanged.

If a reviewer wants these folded in, that is a deliberate scope expansion beyond
#206's acceptance criteria, tracked separately — not an omission here.

## Migration: parse `code`/structured data, not prose (acceptance criterion 3)

Before rewording, the production logic that recovers the symbol name and
reference kind from message *prose* must read structured data instead. Today
`src/providers/diagnostics.ts` parses the message text:

- `extract_symbol_name_from_diagnostic` (lines ~1039–1072): regexes the message
  to recover the symbol name (`` `x' `` / `$x` / `'x'` / variable form).
- `classify_reference_kind` (lines ~1360–1387): inspects the message for
  backtick/apostrophe vs `$` to decide `local` vs `global` (variable is keyed
  off the code).

Both are called once per undefined-symbol diagnostic at lines ~286–291, and the
recovered `symbol_name` / `reference_kind` are threaded through suppression,
forward-call visibility, and out-of-scope rewriting
(`create_out_of_scope_rewrite` → `format_out_of_scope_message`). If the message
prose changes, these regexes silently return `null`, which would break
suppression of cross-file symbols and out-of-scope rewrites — a real behavior
regression, not just a cosmetic one. This is exactly the trap the issue warns
about.

### Design: carry symbol name + reference kind as structured fields

`Diagnostic.data` (from `vscode-languageserver-types`) exists and is currently
unused in this repo. But the parsing happens on the analyzer's internal
`SemanticDiagnostic`, before LSP conversion. The cleanest, most local change is
to add structured fields to `SemanticDiagnostic` itself and populate them at the
analyzer construction sites:

```ts
// src/analyzer/index.ts  (and the mirror type in providers/diagnostics.ts)
export interface SemanticDiagnostic {
    message: string;
    range: Range;
    code: StataDiagnosticCode;
    severity: 'error' | 'warning' | 'information' | 'hint';
    // NEW: structured carriers so downstream logic never parses prose.
    symbol_name?: string;                       // e.g. "x"
    reference_kind?: 'local' | 'global' | 'variable';
}
```

Populate at all five sites:
- `UNDEFINED_MACRO` (4 sites): set `symbol_name = name`,
  `reference_kind = scope` (`'local' | 'global'`).
- `UNDEFINED_VARIABLE` (1 site): set `symbol_name = var_node.name`,
  `reference_kind = 'variable'`.

Then in `diagnostics.ts`:
- `extract_symbol_name_from_diagnostic(d)` → return `d.symbol_name ?? null`.
- `classify_reference_kind(d)` → return `d.reference_kind ?? null`.

Keep both functions (callers unchanged) but make them read structured data.
Delete the now-dead regex bodies. The downstream out-of-scope rewrite path is
unaffected because it receives `symbol_name`/`reference_kind` as parameters.

Rationale for structured fields over reusing prose-regex against new prose: the
issue explicitly requires moving the logic *off* message text. A regex against
reworded prose would still be prose-parsing. Structured fields make the data
authoritative at the point of construction.

### `convert_directive_diagnostic` "Cannot read file" check

`convert_directive_diagnostic` branches on
`diagnostic.message.includes('Cannot read file')` to map severity. This is NOT
in the rewording scope (the "Cannot read file: <path>" message adds context —
the path — and is not duplicative of any code; directive diagnostics carry no
`StataDiagnosticCode`). We are not rewording it, so its message-based check
keeps working. We leave it unchanged to keep scope tight, and note it here so a
reviewer knows it was considered, not missed.

## Rewording (acceptance criterion 2)

Centralize message construction in one helper to prevent the four
`UNDEFINED_MACRO` sites from drifting:

```ts
// new helper, e.g. src/utils/undefined-symbol-message.ts
export function format_undefined_macro_message(
    scope: 'local' | 'global',
    name: string
): string {
    const display = scope === 'local' ? `\`${name}'` : `$${name}`;
    return `${display} is not defined`;
}

export function format_undefined_variable_message(name: string): string {
    return `${name} may not be defined`;
}
```

Resulting text output:
- `` `x' is not defined [UNDEFINED_MACRO] `` (local)
- `$x is not defined [UNDEFINED_MACRO]` (global)
- `x may not be defined [UNDEFINED_VARIABLE]`

Wording rationale:
- Macros: the sigil (`` `x' `` for local, `$x` for global) already conveys both
  macro-ness and scope, so "Undefined ... macro" was pure duplication. The
  reworded message states subject + predicate; the code carries the rule. Matches
  Raven's `x is not defined` shape while preserving Stata's macro sigils.
- Variables: keep the epistemic hedge ("may") because Sight cannot see dataset
  columns, which is why this diagnostic is `information` severity and was
  originally phrased "Potentially". "variable" is dropped as duplicative of
  `UNDEFINED_VARIABLE`. (Open question flagged for review: Raven dropped the
  hedge entirely — `x is not defined`. We keep the hedge to match the existing
  lower-confidence severity. If reviewers prefer Raven parity, change to
  `x is not defined`.)

The out-of-scope rewrite messages
(`format_out_of_scope_message`, e.g. `` `x' is defined in parent.do but after
the call site (line 1)``) already add context and are unchanged.

## Tests & docs to update (acceptance criterion 4)

The authoritative blast-radius command (run it and update EVERY match that
asserts on message text, not just the ones listed):

```
grep -rln "Undefined local macro\|Undefined global macro\|Potentially undefined variable" tests/ docs/ README.md client/README.md
```

As of this spec, that command returns 17 test files. They use three assertion
styles; all three break on rewording and must be updated:

Exact-message assertions (pin the new words):
- `tests/unit/diagnostics-provider.test.ts`
- `tests/unit/analyzer/syntax-option-capitalization.test.ts`

Substring assertions `message.includes('Undefined local macro')` /
`.toLowerCase().includes('undefined local macro')` (will silently stop matching):
- `tests/unit/macro-redefinition-scoping.test.ts`
- `tests/unit/string-macro-detection.test.ts`
- `tests/property/workspace-c-local-suppression.prop.test.ts`
- `tests/property/args-macro-scope.prop.test.ts`
- `tests/property/positional-argument-recognition.prop.test.ts`
- `tests/property/genuine-undefined-macro-detection.prop.test.ts`
- `tests/integration/cmd-hover-peek-flicker.test.ts`
- `tests/integration/cross-file-close-flicker.test.ts`
- `tests/integration/cross-file-diagnostic-flicker.test.ts`
- `tests/integration/current-file-forward-call-diagnostics.test.ts`
- `tests/integration/diagnostic-false-positives.test.ts`

Template-built expected messages (update the template to the new format):
- `tests/property/ast-token-diagnostic-consistency.prop.test.ts`
- `tests/property/symbol-name-extraction.prop.test.ts`
- `tests/property/syntax-command-analyzer.prop.test.ts`
- `tests/property/weight-argument-implicit-locals.prop.test.ts`

CAUTION on substring tests: many of these use the message substring as a proxy
for "is this an undefined-macro diagnostic." Prefer rewriting them to assert on
`diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO` (more robust and
aligned with this issue's intent) rather than swapping in the new substring.

Symbol-name extraction property test
(`tests/property/symbol-name-extraction.prop.test.ts`): currently feeds crafted
*messages* into `extract_symbol_name_from_diagnostic`. After migration it must
feed structured `symbol_name`/`reference_kind`. This test is the canonical guard
that the migration is real — update it to exercise structured data, and add a
case asserting that a diagnostic whose message has NO parseable prose still
yields the correct symbol name (proving prose is no longer consulted).

Docs:
- `docs/diagnostics.md`, `docs/examples.md` — update any literal message-text
  example. NOTE: `README.md:53/56`, `client/README.md:27`, and
  `docs/examples.md:10` use "Undefined local macro" as a *feature heading* and
  image alt-text (the diagnostic category), not the literal message string;
  these may stay as feature labels. Verify each by reading context before
  editing.
- Historical design/plan docs under `docs/superpowers/specs/` and
  `docs/superpowers/plans/` that quote the old message (e.g.
  `2026-04-22-out-of-scope-diagnostic-cleanup-design.md`,
  `2026-06-21-sight-check*.md`) are point-in-time records and are left as-is;
  they document past designs, not current behavior.

Assertions that check only `code` (not message) need no change.

## Implementation plan (TDD)

1. Add `symbol_name`/`reference_kind` to both `SemanticDiagnostic` declarations
   (analyzer + provider mirror). Populate at the 5 analyzer sites.
2. Repoint `extract_symbol_name_from_diagnostic` / `classify_reference_kind` to
   read structured fields; delete regex bodies.
3. Update `symbol-name-extraction.prop.test.ts` to structured input + add the
   "reworded prose is ignored" case. Run — confirm migration is behavior-safe
   BEFORE changing any wording.
4. Add the `format_undefined_*` helpers; route all 5 sites through them.
5. Update remaining exact-message tests and docs.
6. `bun run test` (runs typecheck + bun test). Confirm green.

Order matters: steps 1–3 prove the data path is migrated and behavior is
preserved while the prose is still the old prose; only then (steps 4–5) does the
prose change. This isolates "did the migration break behavior" from "did the
rewording break a string assertion".

## Risks

- Property tests that *generate* expected messages via the same template will
  pass trivially if updated to the new template — they verify format
  consistency, not the specific words. The unit tests pin the exact new words.
- Missed string assertion → test failure caught by `bun run test`. Low risk.
- Behavior regression in suppression/out-of-scope rewrite if a site forgets to
  set the structured fields. Mitigated by routing all sites through the helpers
  and by the dedicated structured-input property test.
