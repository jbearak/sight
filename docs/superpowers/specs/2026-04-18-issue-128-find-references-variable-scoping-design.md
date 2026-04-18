# Issue #128 — Document workspace-wide variable references design decision

**Status:** design approved, implementation pending
**Date:** 2026-04-18
**GitHub issue:** [#128](https://github.com/jbearak/sight/issues/128)
**Scope:** documentation only — three additive artifacts, zero behavioral changes.

## Problem

`src/providers/references.ts::classify_word_symbol` applies a deliberate
asymmetry: code symbols (programs, scalars, matrices) are scoped via the
dependency graph and forward-call filter, but variables are returned
workspace-wide regardless of dependency-graph reachability. This choice is
intentional and grounded in how Stata datasets work, but it is currently
documented only in a single in-code comment that reviewers (human and AI)
repeatedly miss — and consequently file as a bug.

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

**Intro** (2 sentences max): this page documents a deliberate scoping
asymmetry in Find References; it is not a usage guide.

**The asymmetry** (short list):

- **Code symbols** (programs, scalars, matrices) — scoped via the dependency
  graph and call-site filter. Same rule completion and hover apply: backward
  directive parents are always in scope; forward-called files are in scope only
  after their call line.
- **Variables** — workspace-wide, regardless of dependency-graph reachability.

**Why variables are workspace-wide**: Stata dataset columns are legitimately
shared across unrelated analyses. Names like `id`, `year`, `analysis_sample`
frequently refer to the same underlying column across many unrelated `.do`
files. A user asking "where is `analysis_sample` used?" typically wants all
workspace sites, not just dependency-graph-reachable ones.

**Why code symbols are NOT workspace-wide**: Same-named programs in unrelated
branches of the dependency graph are typically coincidence, not shared
semantics. Pooling their references would produce misleading results — jumping
between two unrelated `helper` programs that happen to share a name.

**Cross-reference**: `src/providers/references.ts::classify_word_symbol` is
where the rule is implemented; see the comment in step 3 of that function.

**Tone**: descriptive, settled design. No "TODO" language, no future-work
hints.

## Artifact 2 — CLAUDE.md paragraph

**Placement**: after the "Completion Provider Architecture" block (search
CLAUDE.md for the heading `**Completion Provider Architecture**`; the block
ends before the next `**...**` heading). Provider-level architectural rules
already live there; this belongs alongside them.

**Draft content**:

> **Find References — Scoping Asymmetry**: The references provider applies
> dependency-graph scoping to code symbols (programs, scalars, matrices) but
> treats variables as workspace-wide. Variables are intentionally exempt because
> Stata dataset columns (e.g., `id`, `year`, `analysis_sample`) are legitimately
> shared across unrelated analyses — a find-references query on a variable should
> return all workspace hits, not just dependency-graph-reachable ones. Code
> symbols use the same "visible at cursor" rule as completion and hover: backward
> directive parents plus forward-called files whose call line is before the
> cursor. See [docs/find-references.md](docs/find-references.md) for the full
> rationale. Implementation: `src/providers/references.ts::classify_word_symbol`.

## Artifact 3 — code comment pointers

Two sites in `src/providers/references.ts`:

### Site 1 — primary path (scope-resolver present), around lines 594–596

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

### Site 2 — fallback path (scope-resolver absent), around lines 652–655

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
