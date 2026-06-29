# Static Loop Macro Expansion — Design

**Date:** 2026-06-29
**Status:** Proposed (pre-implementation) — revised after Codex adversarial review (round 1)

## Revision log

- **R1 (Codex adversarial review).** Incorporated blockers/majors:
  name extraction must use **token range-adjacency**, not `WHITESPACE` tokens
  (the lexer skips whitespace in the default `cr` mode,
  `src/lexer/index.ts:405`); `MacroSymbol` needs a **`hasEquals` flag** because
  `process_macro_def` currently drops it, so `local n = 2+2` and `local n 2+2`
  both store `value:"2+2"`; cross-file execution-order filters must use an
  **effective definition line**; nested-loop visibility uses the **outermost
  active loop frame**; iterator bindings are a **save/restore stack** with
  program-scope isolation and `try/finally`; duplicate concrete names **append to
  `additional_definitions`** rather than being dropped; the static env supports a
  **per-tuple overlay** for recursive folding; **quote-aware** list splitting and
  an explicit static rule for `= "literal"`; deterministic cap behavior.

## Problem

In Stata, a `foreach`/`forvalues` loop whose iteration value-set is statically
known often defines a *family* of local (or global) macros whose names are built
by interpolating the loop iterator into a name template. After the loop, those
concrete macros are defined and may be referenced. Sight currently does not
recognize them, so post-loop references produce false "undefined macro"
warnings, and the macros are absent from completion / go-to-definition / hover /
find-references.

Example:

```stata
local suffix foo
foreach i in a b c {            // also: foreach i of local mylist; forvalues i = 1/3
    local `i'                   // -> a, b, c
    local `i'_suffix            // -> a_suffix, b_suffix, c_suffix
    local prefix_`i'            // -> prefix_a, prefix_b, prefix_c
    local prefix_`i'_`suffix'   // -> prefix_a_foo, prefix_b_foo, prefix_c_foo
}
// after the closing brace, all of the above concrete names are DEFINED
display `a_suffix'              // no warning; autocompletes; F12 -> the body line
```

## Locked requirements (decided with the user)

1. **Resolution scope.** Resolve the loop iterator(s) **and** any other local
   macro whose value is statically known (recursive constant-folding). If any
   interpolation slot in a constructed name is dynamic (`=expr`, extended
   function `:`, `tempvar`/`unab`/`args`/etc. placeholders, or an unknown
   macro), **skip just the names that depend on it** — never bail the whole
   loop.
2. **Loop coverage.** `foreach VAR in <list>` (literals and/or local-macro
   refs), `foreach VAR of local <macro>`, `foreach VAR of global <macro>`, and
   `forvalues VAR = <static numeric range>` (`a/b` and `a(step)b`). `of varlist`,
   `of numlist`, and any non-static spec are treated as dynamic.
3. **Full symbols.** Inject concrete `MacroSymbol`s so completion,
   go-to-definition (jump to the body `local` statement), find-references, and
   hover all work.
4. **Visibility.** Defined only on/after the line *after* the loop's closing
   brace. References *inside* the loop body to sibling constructed names are
   **not** suppressed (matches a single static pass; avoids modeling
   per-iteration timing).
5. **Nested loops.** Cartesian product across all enclosing iterator value-sets.
6. **Partial dynamic.** Expand the resolvable items; skip the dynamic ones.

## Key codebase facts (verified)

- `foreach`/`forvalues` parse to `ControlFlowNode { loopVar: string, loopSpec:
  string, body: StataNode[] }`. `loopSpec` is a flat reconstructed string
  (`"in a b c"`, `"of local m"`, `"= 1/3"`); items are **not** structured.
  `node.range.end.line` is the closing-brace line
  (`src/parser/index.ts:1996,2082`).
- The lexer never coalesces a macro ref with adjacent text:
  `local \`i'_suffix` lexes as `WORD("local") WHITESPACE MACRO_REF_LOCAL("\`i'")
  WORD("_suffix")`; `local prefix_\`i'` as `... WORD("prefix_")
  MACRO_REF_LOCAL("\`i'")`.
- `local NAME value` becomes a `MacroDefNode` only when `NAME` is a bare `WORD`
  (`looksLikeMacroDefinition`, `src/parser/index.ts:2536`). Consequently
  `local \`i'...` is parsed as a generic command and `local prefix_\`i'` yields a
  `MacroDefNode` with a **truncated** `name="prefix_"`. We therefore do **not**
  rely on the AST node shape to recover the name (see Name extraction below).
- `analyze()` keeps the full token array on `this.tokens` for the duration of
  the pass (`src/analyzer/index.ts:208`, cleared at `:254`).
- Traversal (`traverse_ast_preorder`, `:597`) iterates only top-level nodes;
  `process_loop` (`:2151`) and `process_control_flow` (`:2188`) recurse into
  bodies themselves. So a class-level stack pushed/popped around
  `build_symbols(node.body)` is visible to nested `process_loop` calls.
- `is_macro_defined` (`:2421`): for a symbol in `localMacros`/`globalMacros`, the
  forward-reference gate is `definition_index > reference_index` **and**
  `definition_line > reference_line`, each applied only when both operands are
  defined. Leaving `definition_index` **undefined** disables the index gate, so
  the **line gate alone** governs visibility — exactly the `@lsp-local`
  precedent. A `definition_line = closingBraceLine + 1` therefore yields "visible
  only after the `}`" with no other plumbing.
- Reference checking runs in two passes (AST `detect_undefined_references` and
  token `check_token_macro_references`) **after** `build_symbols` completes, so
  any symbols injected during `process_loop` are present when references are
  checked.

## Architecture (Hybrid C)

New directory `src/analyzer/loop-expander/` (sibling to
`src/analyzer/macro-creating-commands.ts`), composed of small, pure,
independently testable modules, plus a thin orchestrator the analyzer calls from
`process_loop`. **No parser, provider, or AST-type changes.**

### Modules

**`static-value-env.ts` — constant-folder.**
`build_static_value_env(symbols: Pick<SymbolTable,'localMacros'|'globalMacros'>,
overlay?: Map<string,string>): StaticValueEnv` returning `{ resolve_local(name),
resolve_global(name) }` where each yields `string | UNKNOWN`.

- **Per-tuple overlay (R1).** The optional `overlay` maps macro names to concrete
  values for the *current cartesian tuple* (iterator bindings, and any in-body
  macro whose value itself depends on an iterator). `resolve_local` checks the
  overlay first, then the symbol table. The overlay is consulted recursively, so
  `local suffix \`i'` followed by `local x_\`suffix'` folds correctly: `suffix`
  resolves via the symbol table to the *template* `` `i' ``, whose `` `i' `` slot
  then resolves from the overlay to the current tuple value.
- A symbol-table value is statically known iff its `MacroSymbol.value` is present
  and not produced by a dynamic construct, and any macro refs it contains are
  themselves resolvable (recursive, cycle-guarded by a `visited` set + depth cap).
- **Dynamic ⇒ `UNKNOWN`** when: `value === undefined`; `extendedFunction` set
  (`:` syntax); **`hasEquals === true` and the value is not a pure quoted string
  literal** (R1 — an `=expr` such as `local n = 2+2` stores `value:"2+2"` and must
  not be treated as the literal `"2+2"`); the value is a synthetic placeholder
  (`__tempvar_…__`/`__unab_…__`/`__args_…__`/`__gettoken_…__`/`__file_read_…__`).
- **Quoted literals (R1).** A value that is a pure double-quoted (`"…"`) or
  compound (`` `"…"' ``) string literal with no internal macro refs/operators is
  static; strip the outer quotes and return the contents. This makes
  `local mylist = "a b c"` (hasEquals + pure literal) a valid static list while
  `local n = 2+2` stays dynamic.

Pure; no LSP/AST imports. Depends only on `MacroSymbol` (extended with
`hasEquals?: boolean`, see Types).

**`value-set-resolver.ts` — loopSpec → values.**
`resolve_loop_value_set(loopType, loopSpec, env): { kind:'static', values:
string[] } | { kind:'dynamic' }`:
- `in <items>`: split the tail (quote-aware); for each item that is a macro ref,
  fold via `env` and splice the folded, whitespace-split values in place; drop
  items that fold to `UNKNOWN` (partial). Literal items pass through.
- `of local <name>` / `of global <name>`: fold `<name>` via `env` (which strips
  outer quotes for pure literals, R1); if static, split quote-aware; else
  `dynamic`.
- `of varlist …` / `of numlist …` / anything else: `dynamic`.

Quote-aware splitting (R1): treat a double-quoted span as a **single element**
(`foreach i in "a b" c` → `["a b", "c"]`), then strip the quotes from each
element. Elements that are not valid macro-name components still pass through;
they simply won't form valid concrete names downstream.
- `forvalues = <range>`: accept `start/end` (step 1) and `start(step)end`;
  components must be integer literals (or fold to integer literals). Generate the
  integer sequence as strings. Guard with a size cap (see Caps).

**`name-expander.ts` — name template + cartesian expansion.**
- `extract_name_template(statement_start: Position, tokens: Token[]):
  NameTemplate | null`. Locate the `local`/`global` keyword token at/after
  `statement_start`; skip a leading single-line prefix command
  (`capture`/`cap`/`quietly`/`qui`/`noisily`/`noi`) and `++`/`--`; then collect
  the name token run by **source-range adjacency (R1), not whitespace tokens**:
  after allowing the gap between the keyword and the first name token, collect
  consecutive `WORD`/`MACRO_REF_LOCAL`/`MACRO_REF_GLOBAL` tokens **only while each
  token's `range.start` equals the previous token's `range.end` on the same
  line**. Stop on the first source gap, `=`, `:`, comment, or
  `STATEMENT_TERMINATOR`. (In `cr` mode the lexer emits **no** `WHITESPACE`
  tokens, so a space manifests as a range gap, e.g. `local \`i' value` →
  `MACRO_REF_LOCAL("\`i'")` then `WORD("value")` with a gap between → name is
  just `` `i' ``.) The concatenated token values are the raw template; parse into
  `NamePart[]` (`literal` | `local_ref` | `global_ref`). If the run has **no**
  macro-ref slot, return `null` (plain bare name, already handled by
  `process_macro_def`).
- `expand_template(template, bindings: BindingFrame[], env_factory): string[]` —
  compute the cartesian product over only the iterator names the template
  references (resolved against the active `BindingFrame` stack, innermost wins);
  for each tuple, build a per-tuple `overlay` Map and an env via `env_factory`
  (i.e. `build_static_value_env(symbols, overlay)`), then resolve every slot
  recursively; if any slot is `UNKNOWN`, **skip that tuple** (partial dynamic).
  Guard with a per-loop expansion cap; on overflow **skip the whole template
  deterministically** (no partial prefix, R1).

**`index.ts` — orchestrator.**
`expand_loop_body(node, tokens, bindingStack, symbols, uri): ExpandedLoopMacro[]`
where `ExpandedLoopMacro = { name, scope:'local'|'global', sourceRange: Range }`.
It walks `node.body` (descending through non-loop control flow —
`if`/`else`/`while`/`frame`, which matches `process_control_flow` recursion — but
**not** into nested `foreach`/`forvalues`, which are handled by their own
`process_loop`), and for each statement whose leading keyword is `local`/`global`
it extracts a template (range-adjacency) and expands it against the active
`bindingStack` + per-tuple env. Returns the concrete macros (`sourceRange` = the
body statement's range, for go-to-definition).

**Coverage limits (R1, documented).** Statements inside a *block prefix* such as
`quietly { … }` are parsed as `CommandNode.body` and are **not** recursed by the
current analyzer, so constructed names defined only inside such blocks are not
expanded in v1. `by`/`bysort` prefixes are out of scope. These are explicit v1
limitations, not silent gaps.

### Types (`src/types/index.ts`)

- Add `hasEquals?: boolean` to `MacroSymbol` (R1). Set it in `process_macro_def`
  from `MacroDefNode.hasEquals` (the parser already records it at
  `src/parser/index.ts:481`; the analyzer currently discards it at `:894`). The
  constant-folder uses it to distinguish `= <expr>` from a literal/list value.
  Additive and optional, so existing construction sites stay valid; only
  `process_macro_def` needs to populate it.
- `ExpandedLoopMacro`, `NameTemplate`/`NamePart`, `BindingFrame`, and
  `StaticValueEnv` live in the `loop-expander` module(s), not in global types.

### Analyzer integration (`src/analyzer/index.ts`)

**Active loop-frame stack (R1).** Add a class field
`private loop_frames: Array<{ var: string; values: string[]; endLine: number }>
= []`, reset at the top of `analyze()`. This is both the iterator-binding source
and the source of the visibility line. Shadowing is handled naturally because the
expander reads the stack innermost-first; we never `delete` by name.

Rewrite `process_loop`:

```
node_index given
const pre_env = build_static_value_env(symbols)         // before body: list refs see only pre-loop macros
const value_set = resolve_loop_value_set(node.type, node.loopSpec, pre_env)
// existing loopVar registration stays (iterator visible inside body)
const pushed = value_set.kind === 'static'
if (pushed) this.loop_frames.push({ var: node.loopVar, values: value_set.values, endLine: node.range.end.line })
try {
    this.build_symbols(node.body, symbols, current_scope, all_scopes) // nested process_loop sees the frame
    if (pushed) {
        // env rebuilt AFTER body so a slot like `suffix' can resolve to a
        // macro defined earlier in this body; per-tuple overlay added inside expand.
        const expanded = expand_loop_body(node, this.tokens ?? [], this.loop_frames, symbols, this.uri)
        const visibility_line = this.outermost_active_end_line() + 1   // R1: outermost frame, not this one
        for (const m of expanded) this.inject_expanded_macro(m, symbols, current_scope, visibility_line)
    }
} finally {
    if (pushed) this.loop_frames.pop()                  // try/finally: never leak across analyses (R1)
}
```

- `outermost_active_end_line()` returns the **maximum `endLine` across all active
  `loop_frames`** (R1). For a single loop this is the loop's own `}` line; for
  nested loops it is the outermost loop's `}`, so a constructed name is never
  treated as defined *inside* any enclosing loop body — honoring requirement 4
  conservatively (the safe direction: at worst a few legitimate post-inner-loop
  references in the outer body keep today's behavior; we never falsely suppress).

- **Program-scope isolation (R1).** `process_program` (`:693`) must save the
  current `loop_frames`, set it to `[]` for the program body, and restore it after
  (`try/finally`). A loop body that *defines a program* must not let the program's
  internal `local \`i'` expand against the enclosing do-file iterator.

- `inject_expanded_macro` builds `MacroSymbol { name, scope,
  location:{uri,range:m.sourceRange}, sourceUri:uri, containingScope:
  current_scope.type, definition_line: visibility_line, definition_index:
  undefined }` and registers it via the **existing `add_or_append_definition`
  helper** (`:656`): first occurrence becomes the primary; later collisions
  (two loops, or a loop name colliding with a real `local`) append to
  `additional_definitions` (R1 — preserves hover/references/redefinition data
  instead of silently dropping). First-def-wins primary behavior is retained.

### Effective definition line for cross-file ordering (R1)

Add a tiny shared helper (e.g. in `src/utils/`):
`effective_definition_line(sym): number = sym.definition_line ??
sym.location.range.start.line`. Use it where **cross-file execution order** is
computed against `location.range.start.line` today:
`scope-resolver/index.ts:2405` (`filter_by_call_site`) and
`forward-scope-resolver/index.ts:~905` (effective-end-state walk). This is
**monotonic and safe**: for every existing symbol `definition_line` equals (or is
absent and falls back to) `location.range.start.line`, so behavior is unchanged;
only our injected symbols (whose `location` is the in-loop body line but whose
`definition_line` is after the brace) are corrected, so an inherited constructed
**global** is not treated as visible cross-file until after the loop.

### Full-symbol behavior — scope and what is/ isn't "free" (R1)

Diagnostics get exact after-brace visibility via `is_macro_defined`'s
`definition_line` gate (verified through both the AST and token reference passes;
the index gate no-ops when `definition_index` is `undefined`). Completion,
go-to-definition, and hover read the symbol maps directly and **do not** filter
current-file locals by `definition_line` — but this is the **pre-existing
behavior for every local** (a `local x` on line 50 is already offered/navigable
from line 10). Our injected symbols therefore behave **identically to ordinary
locals** for those features; we are not introducing an inconsistency, and we
deliberately do **not** change same-file completion/goto/hover visibility (that
would be a broad behavior change beyond this feature). The only execution-order
filtering we touch is the cross-file path above, where correctness genuinely
matters for globals.

## Caps (perf / safety)

- Value-set size cap per loop (1000). `forvalues 1/100000` ⇒ exceed ⇒ treat as
  `dynamic` (skip — falls back to today's behavior).
- Total expansions per template cap (5000) to bound cartesian blowup; on overflow
  **skip the whole template deterministically** — never inject a partial prefix
  (R1).
- Constant-fold recursion depth cap (8) + `visited` cycle guard.

## Out of scope (YAGNI)

- `while` loops (never statically known) — but `while`/`if`/`frame` bodies
  *nested inside* a static `foreach`/`forvalues` are descended into for template
  collection (consistent with the analyzer already flattening control flow).
- `of varlist` (wildcards/abbrevs need the dataset), `of numlist` ranges.
- Pretty-printer/formatter changes (the body statement's AST is unchanged).
- Cross-file/scope-resolver special handling (globals propagate via the existing
  symbol table; the indexer re-analyzes callees).
- Arithmetic in the folder (e.g. `forvalues i = 1(`=2*\`n'')9`) — non-literal
  step ⇒ dynamic.
- Block-prefix bodies (`quietly { … }`, `capture { … }`) and `by`/`bysort`
  prefixes (R1) — constructed names defined only inside these are not expanded.
- Same-file completion/goto/hover line-visibility — left identical to existing
  ordinary-local behavior (R1); only cross-file execution-order filtering is
  corrected.

## Testing strategy

- **Unit** (`tests/unit/loop-expander/*.test.ts`), one file per pure module,
  hand-crafted inputs (no lexer needed for the env/value-set/expander; the
  template extractor takes a `Token[]` that can be hand-built or produced by the
  real lexer in a small helper): literal value, chained/recursive fold, cycle,
  `=expr`/extended/placeholder dynamic; `in`/`of local`/`of global`/`= a/b`/
  `= a(s)b`/dynamic specs + caps; single + mixed templates, partial-dynamic skip,
  no-slot ⇒ null, prefix-command/`++` skip, `:`/`=` boundary.
- **Property** (`tests/property/loop-macro-expander.prop.test.ts`): expansion of
  valid identifiers yields valid identifiers; `a/b` value-set size = `b-a+1`;
  cycles never throw. Use `arbitrary_non_reserved_identifier` where relevant.
- **Integration** (`tests/integration/loop-macro-expansion.test.ts`): full
  lex→parse→analyze. Assert each of the four body examples + `of local` +
  `forvalues` + nested cartesian produce the expected names in
  `symbols.localMacros` with `definition_line == brace+1`; post-loop references
  emit no `UNDEFINED_MACRO`; in-body sibling references still warn (req 4);
  dynamic `of local` (unknown macro) injects nothing; completion at a post-loop
  position lists the names; go-to-definition for an expanded name points at the
  body statement.
- `bun run test` (typecheck + tests, the CI gate) and `bun run lint` (manual,
  not in CI) before PR.

## Adversarial review resolutions (R1)

1. **Dynamic-value detection** — `value` alone is insufficient; thread
   `MacroDefNode.hasEquals` onto `MacroSymbol` and treat `= <expr>` as dynamic
   unless it is a pure quoted literal. **Resolved** (Types + folder rules).
2. **Iterator shadowing / leak** — replaced the by-name map with a
   save/restore-free **`loop_frames` stack** read innermost-first, popped in
   `finally`. **Resolved.**
3. **Caps** — 1000 values / 5000 expansions / depth 8; overflow skips the whole
   template deterministically. **Resolved.**
4. **List quoting** — quote-aware splitting; `= "literal"` is static (quotes
   stripped), `= expr` is dynamic. **Resolved.**
5. **Prefix commands** — support single-line `capture/cap/quietly/qui/noisily/noi`
   via token scanning; block-prefix bodies and `by`/`bysort` out of scope.
   **Resolved (scoped).**
6. **Symbol-only vs `declared_locals`** — `definition_line` suffices for
   diagnostics; no `declared_locals` needed. Cross-file execution-order filters
   are fixed to use the effective definition line. **Resolved.**
7. **Collisions** — append to `additional_definitions` (existing
   `add_or_append_definition`) rather than dropping. **Resolved.**

Additional blockers from R1 folded into the design above: token **range-adjacency**
name extraction (lexer skips whitespace in `cr` mode); **outermost-active-frame**
nested visibility; **program-scope** binding isolation.

Required integration coverage (R1): pre-loop reference (still undefined),
in-(defining-)loop reference (still warns), post-loop reference (defined),
nested-loop cartesian, cross-file call-site for a constructed **global**, and
name **collision** (two loops / loop + real `local`).
