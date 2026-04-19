# Find References — Design Notes

This page documents a deliberate design decision in Sight's Find References
feature. It is not a usage guide.

## Three-Tier Scoping Model

The references provider applies different scoping rules depending on symbol
type:

| Symbol type | Scope |
|---|---|
| **Local macros** | Include-chain files only |
| **Global macros, programs, scalars, matrices** | Dep-graph-reachable, cursor-visible files, with same-name conflicts resolved by effective scope precedence so only files contributing the active visible symbol instance at the cursor participate |
| **Variables** | Entire workspace |

## Rationale

**Why local macros are narrowest:** Stata only propagates local macros through
`include`, never through `do` or `run`. A local macro with the same name in a
`do`-called child is a separate, unrelated macro, and locals stripped by a
downstream `done-by` boundary stay out of scope even if an older ancestor was
reached through `included-by`.

**Why global macros and code symbols are dep-graph-scoped *and* identity
filtered:** Same-named programs, scalars, or matrices in unrelated branches
of the dependency graph are typically coincidental, not shared semantics.
Pooling them would produce misleading results — for example, jumping
between two unrelated `helper` programs that happen to share a name. Within
the dep-graph-reachable set, Sight resolves the cursor position to a single
*active symbol instance* (using effective scope precedence to pick between
same-name candidates) and then includes every file that could reference
*that* instance — no matter whether its call site sits before or after the
cursor in execution order. The cursor line only picks the definition; once
picked, it's irrelevant to reference discovery. Files that redeclare the
name with a different identity are excluded, because their declarations are
separate instances and their in-file references are no longer unambiguously
to the active definition.

**Why variables are workspace-wide:** Stata dataset columns are legitimately
shared across unrelated analyses. Column names like `id`, `year`, or
`analysis_sample` frequently refer to the same underlying dataset column
across many unrelated `.do` files. A user asking "where is `analysis_sample`
used?" typically wants all workspace sites, not just dependency-graph-reachable
ones.

## Implementation

The three-tier rule is implemented in
`src/providers/references.ts::collect_references` (look for the "Search
workspace-indexed files" comment block). Classification of what type a symbol
is happens in `classify_word_symbol` for WORD tokens; macro references are
identified directly from token type (`MACRO_REF_LOCAL` / `MACRO_REF_GLOBAL`).
