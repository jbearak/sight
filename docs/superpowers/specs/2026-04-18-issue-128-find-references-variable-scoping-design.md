# Issue #128 — Document workspace-wide variable references design decision

**Status:** design approved, implementation pending
**Date:** 2026-04-18
**GitHub issue:** [#128](https://github.com/jbearak/sight/issues/128)
**Scope:** documentation only — three additive artifacts, zero behavioral changes.

## Problem

`src/providers/references.ts::collect_references` applies a deliberate
three-tier scoping model across symbol kinds, but this design is currently
captured only in in-code comments that reviewers (human and AI) repeatedly
miss — and consequently file as a bug.

The full model (from `collect_references` lines 734–754):

| Symbol type | Scope for workspace scan |
|---|---|
| **Local macros** | Include-chain edges only (`get_related_uris(..., { include_only: true })`). Stata only propagates locals through `include`, never `do` or `run`. |
| **Global macros, programs, scalars, matrices** | All dep-graph-reachable files (do/run/include edges). |
| **Variables** | Entire workspace — no dep-graph restriction. |

Variables are workspace-wide because Stata dataset columns are legitimately
shared across unrelated analyses. Locals are narrower than globals/programs
because Stata's scoping semantics propagate them only through `include`.

The fix is documentation, not a behavior change.

## Artifacts

Three purely additive changes:

| # | Artifact | Location |
|---|----------|----------|
| 1 | New design-notes doc | `docs/find-references.md` |
| 2 | CLAUDE.md paragraph | After "Completion Provider Architecture" block |
| 3 | Code comment pointer(s) | `src/providers/references.ts` — two sites |

No README.md change. The page is a design note, not a user-facing feature;
discoverability via CLAUDE.md and the in-code pointer is sufficient.

## Artifact 1 — `docs/find-references.md`

A new, narrow (~150–300 word) design-notes page. Not a user guide; not a
feature overview. Its sole purpose is to document the variable-vs-code-symbol
scoping asymmetry so reviewers have a stable link to cite.

### Structure

**Intro** (2 sentences max): this page documents a deliberate three-tier
scoping model in Find References; it is not a usage guide.

**The three-tier model** (table):

| Symbol type | Scope |
|---|---|
| Local macros | Include-chain files only |
| Global macros, programs, scalars, matrices | Dep-graph-reachable files (do/run/include edges) |
| Variables | Entire workspace |

**Why local macros are narrowest**: Stata only propagates local macros through
`include`, never through `do` or `run`. A local with the same name in a
`do`-called child is a separate, unrelated macro.

**Why global macros and code symbols (programs, scalars, matrices) are
dep-graph-scoped**: Same-named code symbols in unrelated branches of the
dependency graph are typically coincidental, not shared semantics. Pooling
them would produce misleading results — jumping between two unrelated
`helper` programs that share a name by accident.

**Why variables are workspace-wide**: Stata dataset columns are legitimately
shared across unrelated analyses. Names like `id`, `year`, `analysis_sample`
frequently refer to the same underlying column across many unrelated `.do`
files. A user asking "where is `analysis_sample` used?" typically wants all
workspace sites, not just dependency-graph-reachable ones.

**Cross-reference**: `src/providers/references.ts::collect_references`
(lines 734–754) is where the three-tier rule is implemented.

**Tone**: descriptive, settled design. No "TODO" language, no future-work
hints.

## Artifact 2 — CLAUDE.md paragraph

**Placement**: after the "Completion Provider Architecture" block (search
CLAUDE.md for the heading `**Completion Provider Architecture**`; the block
ends before the next `**...**` heading). Provider-level architectural rules
already live there; this belongs alongside them.

**Draft content**:

> **Find References — Three-Tier Scoping**: The references provider uses
> three distinct scoping tiers, intentionally different from each other:
> (1) **local macros** — include-chain files only (Stata locals don't propagate
> through `do`/`run`); (2) **global macros, programs, scalars, matrices** —
> dep-graph-reachable files (all do/run/include edges); (3) **variables** —
> entire workspace (dataset columns like `id`, `year`, `analysis_sample` are
> legitimately shared across unrelated analyses). Reviewers: this is by design,
> not a bug. See [docs/find-references.md](docs/find-references.md).
> Implementation: `src/providers/references.ts::collect_references`.

## Artifact 3 — code comment pointers

Three sites in `src/providers/references.ts`:

### Site 1 — `collect_references` workspace-scan block, around lines 734–752

This block already has the best prose explanation of the three-tier model.
Append a one-line doc pointer at the end of the existing comment block:

```typescript
// See docs/find-references.md for the rationale behind this three-tier model.
const restrict_to_related = symbol_type !== 'variable';
```

### Site 2 — `classify_word_symbol` primary path (scope-resolver present),
around lines 594–596

Current:
```typescript
// 3. Variables remain workspace-wide: dataset columns are
//    legitimately shared across unrelated modules, so no
//    call-site filter here.
```

Updated (append one line):
```typescript
// 3. Variables remain workspace-wide: dataset columns are
//    legitimately shared across unrelated modules, so no
//    call-site filter here. See docs/find-references.md.
```

### Site 3 — `classify_word_symbol` fallback path (scope-resolver absent),
around lines 652–655

Current (`has_cross_file_any('variable')` check with no comment):
```typescript
if (has_cross_file_any('variable')) {
    return { name: word, type: 'variable', range };
}
```

Updated (add comment before the `if`):
```typescript
// Variables remain workspace-wide on the fallback path too;
// see docs/find-references.md.
if (has_cross_file_any('variable')) {
    return { name: word, type: 'variable', range };
}
```

## Out of scope

- No behavioral changes to any provider. The variable-vs-code-symbol asymmetry
  itself is documented here, not reconsidered.
- No ADR directory or new documentation convention.
- No broader Find References user guide.
- No changes to diagnostics, definition, completion, hover, or other providers.
- `docs/cross-file.md` is not touched (it covers scope resolution generally,
  not the variable asymmetry specifically).
- README.md is not changed (this page is a design note, not a user feature).
