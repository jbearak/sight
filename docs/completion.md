# Completion

Sight offers completion for Stata commands, options, macros, programs,
scalars, matrices, and variables. This page describes what shows up at
the cursor, why some entries are marked **out of scope**, and how
ranking decides the order.

The guiding principle: **accepting a suggestion should not silently
trigger an undefined-symbol diagnostic.** Where that conflicts with
discoverability, the entry is shown but marked out of scope rather
than hidden.

## What's offered, by symbol type

| Symbol type | Visible at the cursor | Out-of-scope treatment |
|---|---|---|
| **Local macros** | Current file only, and only if defined on or before the cursor line | Hidden — workspace locals and same-file locals defined below the cursor are never shown |
| **Global macros, programs, scalars, matrices** | Current file plus scope-chain entries (call-site-filtered) | Shown, ranked last, with `detail = "<kind> (out of scope — from <relative path>)"` |
| **Variables** | Entire workspace | None — variables keep their normal detail |

What counts as "in scope" depends on whether the file has resolved
parents (see [Modes](#modes) below).

## Rules

### 1. No suggestion silently triggers a diagnostic

If accepting an entry would emit an undefined-symbol diagnostic, it is
either hidden (locals) or clearly marked out of scope (globals,
programs, scalars, matrices). Variables are the deliberate exception:
Stata dataset columns are legitimately shared across unrelated
analyses, and the undefined-variable diagnostic is advisory.

### 2. Locals are file- and position-scoped

Stata locals do not propagate through `do` or `run`, so workspace
locals from other files are never offered. Within the current file, a
local is offered once the cursor sits at or below its definition line —
before that point the macro does not yet exist at the execution
point. Locals inherited via an `include` chain are placed in scope by
the resolver upstream and require no further filtering.
For statically expanded `foreach` / `forvalues` constructed macro
names, the definition line is the loop-body `local` statement that
creates each concrete name. For example, after

```stata
foreach g in age sex educ {
    local mean_`g' = r(mean)
}
```

typing `` `mean_ `` below the loop offers `mean_age`, `mean_sex`, and
`mean_educ` as completions.

### 3. Workspace non-variable symbols surface as out of scope

Globals, programs, scalars, and matrices defined in unrelated workspace
files are not hidden. They appear at the bottom of the list with a
`(out of scope — from <path>)` detail. Accepting one produces an
undefined-symbol diagnostic — the cue to add a `do` / `run` / `include`
statement or a cross-file directive (`sight: do`, `sight: done-by`,
`sight: included-by`, …) to bring the symbol into scope. `@lsp-`
spellings remain aliases.

### 4. Built-ins win over out-of-scope programs

A workspace program named `display` (or any other name colliding with a
built-in command) must not crowd the built-in out of completion. An
out-of-scope program is dropped if a built-in with the same name
exists. Precedence:

```text
in-scope user program > built-in command > out-of-scope user program
```

### 5. Variables stay workspace-wide

Variables are exempt from out-of-scope treatment at every layer. The
workspace-wide model matches how [find-references](find-references.md)
handles variables, and reflects that dataset columns like `id`,
`year`, or `analysis_sample` legitimately recur across unrelated
analyses.

## Modes

### Resolved-scope mode

Active when the file has `sight:` / `@lsp-` directives or auto-discovered
parents via the dependency graph. The in-scope set is the current
file plus the call-site-filtered scope chain. Entries the resolver
ruled out (after the call site, or excluded by `do` / `run`
inheritance) are kept hidden, not surfaced as out-of-scope.

### Global mode

Active when no directives or auto-parents are found. The in-scope set
is the current file alone. Workspace locals are dropped; workspace
globals, programs, scalars, and matrices are routed to the
out-of-scope bag. Variables pass through unchanged.

See [Cross-File Awareness](cross-file.md) for how parents are
auto-discovered or declared.

## Ranking

Completion order is deterministic. Each entry's `sortText` is built
from, in order:

1. **Scope depth** — current file first, then immediate parents, then
   grandparents, and so on.
2. **Directive type** — `current` (0), `included-by` (1), `done-by`
   (2), `out-of-scope` (3).
3. **Symbol type** — built-in commands and other priority tiers.
4. **Parent URI**, then **name**, as final tiebreakers.

Because directive type outranks symbol type, an in-scope local macro
sorts above an out-of-scope program even though the program's symbol
tier would otherwise come first.

## Why these rules

**Locals are the narrowest** because Stata propagates them only
through `include`, never through `do` or `run`, and a local defined
below the cursor literally does not yet exist at the cursor's
execution point.

**Non-variable workspace symbols are surfaced anyway** because pure
hiding hurts discoverability. The two-step workflow — see the
suggestion, accept it, then resolve the resulting diagnostic by
linking the file — depends on the symbol being visible in the first
place. The out-of-scope label makes the workflow legible.

**Variables are workspace-wide** because Stata dataset columns are
identified by name across `.do` files, so reachability is the wrong
gate.

## Relationship to find-references

Completion is narrower than [find-references](find-references.md).
Find-references pools same-name declarations across the reachable
dep-graph chain so a user searching by name sees every declaration
that could bind to that name. Completion only shows what the cursor
can reference right now. A symbol can legitimately appear in
find-references while being hidden or marked out of scope in
completion — the user has not yet linked the file.

## Relationship to diagnostics

Completion and [diagnostics](diagnostics.md) share the same scope
resolver but apply different rules. Completion may surface workspace
symbols as out-of-scope suggestions; diagnostics never treat
workspace-only visibility as resolved scope. Accepting an out-of-scope
completion produces a diagnostic by design — that is the signal to
link the file via `do` / `run` / `include` or a cross-file directive.
