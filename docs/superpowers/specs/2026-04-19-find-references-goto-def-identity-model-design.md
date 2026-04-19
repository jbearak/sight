# Find-References and Go-to-Definition — Identity Model Rearchitecture

**Status:** design
**Date:** 2026-04-19
**GitHub issue:** TBD (this document is the basis for the issue body)
**Scope:** Rearchitect how Sight assigns *identity* to redeclared symbols so that find-references and go-to-definition return a coherent, predictable set of results. Current behavior over-trims by splitting redeclarations into separate identities when they are, semantically, the same symbol.

## Problem

Consider two single-file cases a user can reasonably type today:

```stata
local fruit apple
di "`fruit' is apple"

local fruit banana
di "`fruit' is banana"
```

```stata
if (a < 1) {
    local fruit apple
}
else {
    local fruit banana
}
di "`fruit'"
```

In both cases a user asking "where is `fruit` defined?" expects **both** `local fruit ...` lines. A user asking "where is `fruit` referenced?" expects the full set — both `local` lines and both `di` lines. Today:

- **The analyzer** treats the first `local fruit ...` as the primary `MacroSymbol`; the second becomes an entry in `additional_definitions`. The principle is "first definition wins."
- **`src/providers/definition.ts`** reads only the primary `location`, not `additional_definitions`. Go-to-definition returns one line.
- **`src/providers/references.ts`** uses the primary symbol's range as the identity key and applies an "active visible symbol instance at the cursor" filter that was designed to exclude *unrelated* same-named symbols in disjoint branches of the dep graph — but the same guard also splits redeclarations in the same file/chain into distinct identities. The `di` after `apple` and the `di` after `banana` can end up in different reference sets.
- **`docs/find-references.md`** codifies a "three-tier scoping model" whose middle tier ("same-name conflicts resolved by effective scope precedence so only files contributing the active visible symbol instance at the cursor participate") is inconsistent with the analyzer's first-def-wins identity model for local macros and produces the trimming described above.

The over-trimming shows up across the providers (definition, references, hover, completion) because they share the "visible symbol instance" machinery (`scope-resolver/visible-symbols.ts`, issue #129's unification).

## Semantic model

We adopt two related rules:

### Rule 1 — Same-identity for redeclarations within the reachable chain

Two declarations of the same name, same kind, within the scope chain that is reachable from the cursor's file are **the same symbol**. This applies whether the redeclarations sit in the same file, in sibling branches of an `if/else`, in a parent and a do-called child, or anywhere else in the reachable chain.

**What "reachable chain" means differs by symbol kind**, matching Stata's scoping rules exactly:

- **Local macros:** the **include chain only**. Stata propagates locals through `include`, never through `do` or `run`. A local in a do-called child and a same-named local in the parent are distinct identities; the dep-graph `do`/`run` edges do **not** connect them.
- **Globals, programs, scalars, matrices:** the full **do/run/include dependency graph**. These symbols outlive `do`/`run` boundaries, so any path through the dep graph unifies identity.
- **Variables:** see Rule 3 below (tier 3). Identity for variables is always by name; reachability only affects sort order, not whether a reference is included.

Implementations must not accidentally widen the local-macro chain to the full dep graph; doing so would bleed locals across `do`/`run` boundaries in violation of Stata semantics.

### Rule 2 — Unrelated branches stay out

Two declarations of the same name that are *not* mutually reachable through the dep graph (e.g., two `helper` programs in unrelated analyses) remain distinct symbols. This is the protection the current three-tier model was designed to provide, and Rule 1 does not dissolve it. The "coincidental same-name in unrelated branches" exclusion is preserved.

Together the rules say: **within the reachable chain, name + kind is identity; across disjoint branches of the dep graph, the name is coincidental.**

### Rule 3 — Reachability is static only

"Reachable" is determined **purely from static `do`/`run`/`include` edges in the dep graph**. Sight does not trace data-flow: a script that writes a `.dta` file and a downstream script that reads it are not considered reachable from each other, even though the user may reason about them as connected. This limitation is intrinsic to the LSP's static-analysis model and is noted here so users and implementers share the same expectations. The Tier 3 sort for variables (below) accommodates this by keeping non-reachable results in the workspace-wide list rather than excluding them.

## Semantics per provider

### Go-to-definition — return all defs

`go-to-def` returns **every** definition of the identity that is reachable from the cursor. LSP permits multi-location results; editors show a peek/list when more than one location is returned, or jump directly when only one is present. This matches Rule 1 literally: if two `local fruit ...` lines are the same symbol, both are valid targets.

### Find-references — pool all references for the identity

`find-references` returns **all** reference sites (and, per `includeDeclaration`, all declaration sites) of the identity across the reachable chain. The "active visible symbol instance" identity split inside the reachable chain is retired. Rule 2 continues to exclude files that contribute *only* a disjoint same-named symbol.

Concretely, inside `collect_references` (and its peers):

- Two redeclarations in the same file are one identity; all references to either instance are pooled.
- Two redeclarations in sibling branches of an `if/else` are one identity; references from outside the branches pool with both.
- A global set in a do-called child and a same-named global set in the parent after the `do` call are the same identity (both are reachable through the dep graph).
- Two unrelated `helper` programs in branches of the dep graph that are *not* mutually reachable stay distinct — current Rule 2 behavior, preserved.

### Hover — first definition with a mandatory redefinition footer

Hover shows the first definition, ordered by preorder index. This is the simplest stable answer. When the primary symbol has `additional_definitions`, the hover content **always** includes a trailing footer summarizing the other sites. Showing the first definition without the footer risks confusing users who redeclare a local repeatedly — they'd see an initial definition that may be hundreds of lines away without any cue that later definitions exist. The footer is therefore in scope for v1, not deferred.

Footer format:

- **Same-file redeclarations only:** list the line numbers explicitly, e.g.
  > Redefined at lines 12, 17, 23 — see all references
- **Cross-file redeclarations:** list same-file lines specifically, then aggregate other files, e.g.
  > Redefined at lines 12, 17 and in 2 other files — see all references
- **Cross-file only, no same-file redeclarations:** drop the line list, e.g.
  > Redefined in 2 other files — see all references

Paths are not printed in the footer; the "see all references" link directs the user to find-references for granular locations. Showing the *last* active-at-cursor definition would require value-flow analysis the LSP does not have, and reintroduces the per-site identity splitting this design is retiring.

### Completion — identity unification follows automatically

Completion already dedupes by name within a scope, so `fruit` appears once regardless of redeclaration count. The only change required is verification: once the analyzer and scope resolver stop treating redeclarations as separate candidates, the same-name handling in `completion.ts` reduces to a no-op for the in-chain case. This item is mostly a test task, not a redesign.

### Variables (tier 3) — workspace-wide, sorted

Variables remain workspace-wide. Dataset columns like `id`, `year`, `analysis_sample` are legitimately shared across unrelated `.do` files, and users routinely want the full workspace set when asking "where is `cm_birth` used?" Even when Sight *can* identify the recode chain, the user may still want the identically-named columns from sibling surveys. Sight also does not follow chains through disk reads/writes, so a chain that appears disjoint may actually be connected through a `.dta` write that Sight does not model.

**Change:** find-references results for variables are sorted so that files reachable through the dep graph from the cursor's file are listed first. Within each group (reachable vs. non-reachable), the existing order (URI, then line) is preserved. This keeps the workspace-wide promise while prioritizing the result the user most likely wants to see first.

**Future work (out of scope for this issue):** grouping non-reachable references into labeled clusters by recode chain, for workspaces that contain multiple disjoint chains (e.g., NSFG, DHS, MICS, ENADID, WFS). Useful but requires defining chain labels, handling files reachable from two chains, and designing the UI affordance — deferred.

## Concrete changes

### `src/analyzer/index.ts`

- Retire the "first definition wins" framing as an *identity* rule. Continue to record the first def as the primary `location` (for backward compatibility and hover), but treat `additional_definitions` as co-equal for identity purposes downstream. The call sites that currently pattern-match on primary-only identity (scope resolver, references, definition) are the ones that need to change; the analyzer's symbol-table shape does not need to.
- Forward-reference warning logic is unchanged. It already answers "has *any* def been seen in preorder before this use?" and is orthogonal to identity.

### `src/providers/definition.ts`

- `find_definitions` for macros: return the primary location **and** every entry in `additional_definitions` whose site is reachable at the cursor per Rule 1. Preserve existing non-macro paths except to extend them analogously (programs, scalars, matrices — primary + any same-identity redeclarations in the reachable chain).

### `src/providers/references.ts`

- `collect_references`: remove the "active visible symbol instance" identity filter for the *in-chain* case. Keep the Rule 2 exclusion for disjoint branches. The three-tier scoping table in `docs/find-references.md` is rewritten to match.
- Pool reference sites from all files that are reachable through the dep graph from the cursor's file and contribute a declaration or reference of the same name + kind.
- Variables: keep workspace-wide; apply the two-group sort described above (reachable first, then non-reachable; each group ordered by URI/line).

### `src/scope-resolver/visible-symbols.ts`

- `has_definition_in_window` and friends already know about `additional_definitions`. The change is in *how* consumers interpret "same name, different instance": within the reachable chain they are the same identity, so the "different identity" guard inside `collect_visible_reference_uris` collapses to a no-op for in-chain redeclarations. It is only retained for cross-branch disjoint cases.

### `src/providers/hover.ts`

- Show first def. Always append a redefinition footer when `additional_definitions` is non-empty, using the same-file/cross-file/mixed variants described in the semantics section. The footer is required for v1, not deferred.

### `src/providers/completion.ts`

- No intended behavior change. Add a verification test that a file with two `local fruit ...` declarations produces exactly one `fruit` completion item with stable ranking.

### `docs/find-references.md`

- Rewrite the middle tier to describe the new rule:
  - **Tier 1 (local macros):** include-chain files, identity = name + kind across all redeclarations reachable from the cursor.
  - **Tier 2 (globals, programs, scalars, matrices):** dep-graph-reachable files, same-name redeclarations within the reachable chain are one identity, disjoint branches remain separate.
  - **Tier 3 (variables):** workspace-wide, sorted reachable-first.
- Preserve the existing rationale blocks. Add a subsection explicitly stating that globals set across `do`/`run` boundaries are the same identity, and that programs, scalars, and matrices follow Tier 2 identically.

## Scope — in and out

**In scope.**

- Analyzer: stop treating "first def" as an identity anchor (data model unchanged).
- Definition provider: return all defs.
- References provider: retire in-chain identity splitting; keep Rule 2.
- Hover: first def with a required redefinition footer.
- Completion: verify dedup; mostly falls out.
- Globals across `do`/`run`: stated explicitly as same identity.
- Programs, scalars, matrices: stated explicitly as same treatment.
- Variables: workspace-wide preserved, add reachable-first sort.
- `docs/find-references.md`: rewritten.

**Out of scope.**

- Forward-reference warnings (orthogonal, already correct).
- Value-flow analysis for hover (not attempted).
- Variable reference grouping by recode chain cluster (future work, noted).
- Coincidental same-name in unrelated dep-graph branches (stays excluded, unchanged).

## Test plan

- **Redeclared local, flat.** The two-`local fruit` example: go-to-def on any `` `fruit' `` returns both declarations; find-references returns both decls + both `di` lines.
- **Redeclared local, branches.** The `if/else` example: go-to-def on `di "`fruit'"` after the block returns both branch declarations; find-references returns both decls + the `di` line.
- **Redeclared global across do/run.** Parent sets `$g`, calls child via `do`, child also sets `$g`. Go-to-def on a later `$g` use in the parent returns both `global $g ...` sites; find-references pools all uses.
- **Same-named programs in disjoint branches.** Two unrelated `helper` programs; cursor on one's call site: references for that call site include only the files reachable through its own branch. Rule 2 preserved.
- **Variables, workspace-wide sort.** A workspace with `cm_birth` references in both the cursor's recode chain and unrelated sibling chains: all references returned; chain-reachable ones listed first.
- **Completion dedup.** File with two `local fruit` declarations: completion offers `fruit` exactly once, with stable ranking independent of which redeclaration is "primary."
- **Hover.** File with three `local fruit` declarations: hover shows the first, and the footer mentions the other two.
- **Forward-reference warnings unchanged.** Regression test: existing warning-on/off cases still behave as before.
- **Symmetric reachability, include chain.** File A `include`s B, B does not `include` A. A declares a local, B references it: find-references from inside B returns both the declaration in A and the reference in B. Invert (B declares, A references): find-references from inside A returns both. Same result set regardless of which end triggers the query.
- **Symmetric reachability, do/run for globals.** Parent file A `do`s child file B. A defines `$g`, B uses `$g`: find-references invoked from B returns both sites, same as invoked from A.
- **Local-macro chain must not widen to do/run.** File A defines `local fruit apple`, then `do "B.do"` where B uses `` `fruit' ``: the `fruit` in B is a distinct identity, references do not pool across the `do` boundary. Regression guard against accidentally extending Rule 1's reachability rule for locals.
- **Hover footer variants.** Same-file only, cross-file only, and mixed cases each render the documented footer string.

## Resolved design decisions

### Reachability is symmetric

When file A `include`s file B and B does not `include` A, invoking find-references on a symbol inside B **does** reach upward into A. A's `include` of B makes A and B part of a single execution context; users expect the same result set regardless of which end of the chain they trigger the request from. Asymmetric results ("everything if I invoke it from A, subset if I invoke it from B") would be a usability bug. Implementation uses `callee_to_callers` to walk upward in addition to the existing downward walk.

The same rule applies to `do`/`run` chains for non-local symbols: if A calls B via `do`, find-references on a global inside B reaches upward into A.

### Hover footer aggregates across files

The hover footer uses the three-variant format specified in the Hover section above: explicit line numbers for same-file redeclarations, an aggregate "N other files" count for cross-file redeclarations, no file paths. This keeps the hover compact regardless of how widely a symbol is redeclared.

## Performance considerations

Pooling all same-identity references across the reachable chain has an obvious worst case: generic names like `local i`, `local j`, `local tmp` reused in dozens of unrelated places within one dep graph. Under Rule 1 + Rule 2, these remain distinct identities *across* disjoint branches, which limits the blast radius — but a single large recode chain with hundreds of `local i` uses will still surface all of them.

The implementation plan should:

- **Measure before optimizing.** Instrument `collect_references` to log result counts and per-call duration during the implementation phase; do not add artificial caps speculatively.
- **Identify candidate caps only if measurements warrant.** If real workspaces produce pathological results (e.g., >10k references for a single query, or latencies that block the editor), revisit. Candidates include a hard result cap (with a "more results truncated" message), lazy enumeration, or streaming partial results. None of these is in scope for v1; the v1 deliverable is the correctness change plus the measurement.
- **Document the expected steady state.** After shipping, update `docs/find-references.md` with observed performance characteristics so users and future contributors know what to expect when working with high-reuse names.
