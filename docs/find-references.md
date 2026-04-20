# Find References — Design Notes

This page documents a deliberate design decision in Sight's Find References
feature. It is not a usage guide.

## Three-Tier Scoping Model (Identity Edition)

The references provider applies different scoping rules depending on symbol
type. **Within the reachable chain, name + kind is identity; across disjoint
branches of the dep graph, the name is coincidental.** (See issue #135 for
the rationale; previous versions of this model over-trimmed by splitting
same-file and in-chain redeclarations into separate identities.)

| Symbol type | Scope | Identity |
|---|---|---|
| **Local macros** | Include-chain files only (no `do`/`run`) | Same name + `local` kind within include chain = one identity |
| **Global macros, programs, scalars, matrices** | Dep-graph-reachable files (all `do`/`run`/`include` edges) | Same name + same kind within the dep-graph-reachable set = one identity |
| **Variables** | Entire workspace | Always same name = same identity; reachability only affects sort order |

## Rules

### Rule 1 — Same identity for redeclarations within the reachable chain

Two declarations of the same name + same kind, reachable from the cursor's
file, are **the same symbol**. This applies whether they sit in the same
file, in sibling branches of an `if/else`, in a parent file and a do-called
child, or anywhere else in the reachable chain.

Find-references pools all reference sites across these declarations.
Go-to-definition returns every declaration as a target location (LSP
supports multi-location results).

### Rule 2 — Unrelated branches stay out

Two declarations of the same name that are **not** mutually reachable
through the dep graph remain distinct. Two `helper` programs in unrelated
analyses stay distinct, preventing pooling of coincidentally same-named
symbols.

### Rule 3 — Reachability is static only

"Reachable" is determined purely from static `do`/`run`/`include` edges.
Sight does not trace data-flow: a script that writes a `.dta` file and a
downstream script that reads it are not connected.

### Reachability is symmetric

Find-references reaches both downward (callees) and upward (callers). If
file A `include`s B, a query from inside B returns references in A too.

## Rationale

**Why local macros are narrowest:** Stata only propagates local macros
through `include`, never through `do` or `run`. A local macro with the
same name in a `do`-called child is a separate, unrelated macro.

**Why global macros and code symbols are dep-graph-scoped:** These symbols
outlive `do`/`run` boundaries, so any path through the dep graph pools
them into one identity. A global set in a parent and a same-named global
set in a do-called child are the same identity — both are reachable
through the dep graph. Programs, scalars, and matrices follow the same
rule: same name within the reachable set = same identity.

**Why variables are workspace-wide:** Stata dataset columns are
legitimately shared across unrelated analyses. Column names like `id`,
`year`, or `analysis_sample` frequently refer to the same underlying
dataset column across many unrelated `.do` files. Even when Sight *can*
identify the recode chain, the user may still want the identically-named
columns from sibling surveys. Results are sorted so dep-graph-reachable
files appear first (see [sort order](#variable-result-ordering) below).

## Variable Result Ordering

Variable references are sorted in two groups:

1. **Reachable group:** files reachable through the dep graph from the
   cursor's file (both directions). Within this group, results are ordered
   by URI then by line.
2. **Non-reachable group:** every other file in the workspace. Same
   within-group ordering.

Future work (out of scope for issue #135): grouping non-reachable results
by recode-chain cluster (e.g., NSFG, DHS) with a UI affordance. Useful,
but requires defining chain labels and handling multi-chain files.

## Hover and Redefinition Footer

When a symbol has multiple definitions across the reachable chain, hover
shows the first definition (ordered by preorder index) and appends a
footer summarizing the others:

- **Same-file only:** `Redefined at lines 12, 17, 23 — see all references`
- **Cross-file only:** `Redefined in 2 other files — see all references`
- **Mixed:** `Redefined at lines 12, 17 and in 2 other files — see all references`

The footer directs the user to find-references for granular locations
(paths are intentionally omitted from the footer to keep it compact).

## Implementation

- `src/providers/references.ts::collect_references` — main reference
  collection logic. Look for the "Search workspace-indexed files" comment.
  The dep-graph reachability walk is the primary filter; same-identity
  pooling happens inside `collect_visible_reference_uris`.
- `src/providers/definition.ts::resolve_*` — each resolver now returns all
  reachable same-identity declaration sites, not just the primary.
- `src/scope-resolver/visible-symbols.ts::collect_visible_reference_uris`
  — computes which URIs participate in find-references. The former
  "active visible symbol instance" identity filter has been retired for
  the in-chain case; disjoint-branch exclusion is provided by dep-graph
  reachability upstream.
- `src/providers/hover.ts::format_redefinition_footer` — produces the
  hover footer variants described above.

## Performance

Pooling same-identity references has a worst case for names like
`local i`, `local j`, `local tmp` reused heavily within one dep graph.
Rule 2 bounds the blast radius across disjoint branches; Rule 1 still
surfaces all uses within one recode chain. Measurement and observed
characteristics are intentionally left to a follow-up — instrumented
`collect_references` is the plan; hard caps or lazy enumeration are
candidates for future issues if measurement warrants.
