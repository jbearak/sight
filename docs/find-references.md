# Find References — Design Notes

This page documents a deliberate design decision in Sight's Find References
feature. It is not a usage guide.

## Three-Tier Scoping Model

The references provider applies different scoping rules depending on symbol
type:

| Symbol type | Scope |
|---|---|
| **Local macros** | Include-chain files only |
| **Global macros, programs, scalars, matrices** | Dep-graph-reachable files (do/run/include edges) |
| **Variables** | Entire workspace |

## Rationale

**Why local macros are narrowest:** Stata only propagates local macros through
`include`, never through `do` or `run`. A local macro with the same name in a
`do`-called child is a separate, unrelated macro — pooling those references
would be misleading.

**Why global macros and code symbols are dep-graph-scoped:** Same-named
programs, scalars, or matrices in unrelated branches of the dependency graph
are typically coincidental, not shared semantics. Pooling them would produce
misleading results — for example, jumping between two unrelated `helper`
programs that happen to share a name.

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
