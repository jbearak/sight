# Completion — Design Notes

This page documents deliberate design decisions in Sight's completion
provider. It is not a usage guide.

## Scoping Model

Completion applies different visibility rules per symbol category. The
driving principle: **a completion offered at the cursor should not
silently trigger an undefined-symbol diagnostic if the user accepts
it.** Where that rule conflicts with discoverability, the conflict is
resolved by marking the entry out-of-scope rather than hiding it.

| Symbol type | Scope at cursor | Out-of-scope treatment |
|---|---|---|
| **Local macros** | Current file only, further narrowed to lines strictly before the cursor line | Hidden — workspace locals and same-file locals below the cursor are never shown |
| **Global macros, programs, scalars, matrices** | Current file + scope-chain entries (call-site-filtered) | Shown, ranked last, with `detail = "<kind> (out of scope — from <relative path>)"` |
| **Variables** | Entire workspace | No out-of-scope treatment — variables keep their normal detail |

"In scope" itself depends on mode (see [Mode dependency](#mode-dependency)
below).

## Rules

### Rule 1 — No completion silently triggers a diagnostic

If accepting a suggestion would emit an undefined-symbol diagnostic, the
suggestion is either hidden (locals) or clearly marked (globals,
programs, scalars, matrices). Variables are the deliberate exception:
Stata dataset columns are legitimately shared across unrelated analyses,
and the undefined-variable diagnostic is advisory rather than
load-bearing.

### Rule 2 — Locals are file-and-position scoped

Workspace locals from other files are never offered in completion —
Stata locals do not propagate through `do` or `run`, and `include`
inheritance is already resolved upstream by `ScopeResolver`. Within the
current file, a local defined on a line strictly after the cursor is
excluded, because a Stata local is only visible on lines after its
definition. Locals inherited from a parent file via an `include` chain
are in scope when the scope resolver places them there; no additional
position filter runs in the provider, because the parent's call-site
filter has already happened upstream.

### Rule 3 — Workspace non-variable symbols surface as out-of-scope

Global macros, programs, scalars, and matrices defined in unrelated
workspace files are not hidden. They appear at the bottom of the
completion list with a distinct `(out of scope — from <path>)` detail,
and their `sortText` places them below every in-scope entry of the same
category. Accepting one produces an undefined-symbol diagnostic; that
diagnostic is the user's cue to add a `do`/`run`/`include` statement or
a cross-file directive (`@lsp-do`, `@lsp-done-by`, `@lsp-included-by`,
etc.) to bring the symbol into scope.

### Rule 4 — Built-ins win over out-of-scope programs

A workspace program named `display` — or any other name that collides
with a built-in command — must not suppress the built-in from
completion. Out-of-scope programs are filtered against the command
database before emission (skipped if a built-in with the same name
exists) and never claim a `seen_labels` slot. Precedence:

```
in-scope user program > built-in command > out-of-scope user program
```

### Rule 5 — Variables stay workspace-wide

Variables are exempt from the out-of-scope treatment at every layer:
they are not stripped from the Global-Mode in-scope bag by
`build_merged_map`, they are forced empty in
`partition_symbols_for_completion`'s output, and
`get_variable_completions` has no out-of-scope variable loop. The
workspace-wide model matches find-references' variable handling.

## Ranking

`compute_ranking_key` composes a lexicographic `sortText` from
`(scope_depth, directive_type, symbol_type, parent_uri, name)`. The
`directive_type` bucket maps `'current'` → 0, `'included-by'` → 1,
`'done-by'` → 2, `'out-of-scope'` → 3 — so out-of-scope entries always
sort after every in-scope entry within the same symbol-type tier.
Symbol-type tiering is a higher-order key, so an in-scope local-macro
still sorts above an out-of-scope program even though programs rank
lower than locals in the symbol-type ordering.

## Mode dependency

"In scope" resolves differently depending on whether the file has
directives or auto-discovered parents.

**Resolved-Scope Mode** (file has `@lsp-*` directives or
auto-discovered parents via the dep graph): the in-scope bag is
`get_visible_symbols_at(resolved_scope, cursor_line)` — current file
plus scope-chain entries, call-site-filtered. Entries the scope
resolver deemed out-of-scope for `after_call_site` or
`inheritance_excludes_locals` reasons are excluded from the new
workspace out-of-scope partition as well; they stay hidden.

**Global Mode** (no directives, no auto-parents): the in-scope bag is
current-file-only. `build_merged_map` strips workspace locals, globals,
programs, scalars, and matrices from the merged in-scope view, and
`partition_symbols_for_completion` routes them to the out-of-scope bag
instead. Variables pass through untouched, preserving their
workspace-wide behavior.

## Rationale

**Why locals are narrowest:** Stata propagates locals only through
`include`, never through `do` or `run`. A local in a `do`-called child
is a separate macro from a same-named local in its caller. Position
within the current file matters too: a local defined below the cursor
literally does not exist yet at the cursor's execution point.

**Why non-variable workspace symbols are surfaced at all:** Pure
hiding would hurt discoverability. Engineers often want completion to
suggest a helper program or a configuration global defined elsewhere
in the project, then add a `do` statement or directive to pull it into
scope. The out-of-scope label makes this two-step workflow visible:
the suggestion appears, and the resulting diagnostic guides the user
to the linking step.

**Why variables are workspace-wide:** Stata dataset columns like `id`,
`year`, or `analysis_sample` frequently refer to the same underlying
column across many unrelated `.do` files. The "column identity is
name-only" convention means treating every workspace-known column as
in-scope is more useful than gating on reachability. This matches how
find-references scopes variables (see `docs/find-references.md`).

## Implementation

- `src/providers/completion.ts::partition_symbols_for_completion` —
  builds the out-of-scope SymbolTable view; always returns empty
  `localMacros` and `variables`.
- `src/providers/completion.ts::build_merged_map` — produces the
  Global-Mode in-scope bag; strips workspace locals, globals, programs,
  scalars, and matrices, leaves variables in place.
- `src/providers/completion.ts::compute_ranking_key` — sortText
  composition including the `'out-of-scope'` tier.
- `src/providers/completion.ts::get_macro_completions` — position
  filter for same-file locals; out-of-scope pass for global macros
  (skipped when `scope === 'local'`).
- `src/providers/completion.ts::get_command_completions` and
  `get_program_completions` — in-scope and out-of-scope program
  emission with the built-in-precedence guard described in Rule 4.
- `src/providers/completion.ts::get_variable_completions` — in-scope
  variable/scalar/matrix loops plus out-of-scope passes for scalars
  and matrices only (no variable out-of-scope pass).

## Relationship to find-references

Completion's visibility model is **not** the same as find-references'.
Find-references pools same-identity declarations across the reachable
dep-graph chain so a user searching by name sees every declaration
that could bind to that name (see `docs/find-references.md`).
Completion is narrower: it only shows what the cursor can reference
right now. A symbol can legitimately surface in find-references
(because the user knows the name and is searching) while being hidden
or marked out-of-scope in completion (because the user has not yet
linked the file).
