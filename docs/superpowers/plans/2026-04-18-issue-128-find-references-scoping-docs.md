# Find References — Three-Tier Scoping Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the deliberate three-tier scoping model in Find References so reviewers stop filing it as a bug.

**Architecture:** Three additive, doc-only artifacts: a new design-notes page at `docs/find-references.md`, a paragraph inserted into `CLAUDE.md` after the Completion Provider Architecture block, and one-line doc pointers at three sites in `src/providers/references.ts`. No behavioral changes.

**Tech Stack:** Markdown (new doc page), CLAUDE.md (text insert), TypeScript (comment-only edits, no logic changes).

---

## File Map

| Action | Path | What changes |
|---|---|---|
| **Create** | `docs/find-references.md` | New design-notes page |
| **Modify** | `CLAUDE.md` | One paragraph inserted after Concurrency Handling |
| **Modify** | `src/providers/references.ts` | Three comment-only edits (no logic) |

---

## Task 1: Create `docs/find-references.md`

**Files:**
- Create: `docs/find-references.md`

- [ ] **Step 1: Create the file with this exact content**

Write `docs/find-references.md`:

```markdown
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
```

- [ ] **Step 2: Verify the file was created**

```bash
wc -w docs/find-references.md
```

Expected: a word count in the 180–280 range and no error.

- [ ] **Step 3: Commit**

```bash
git add docs/find-references.md
git commit -m "docs: add find-references design notes page (issue #128)"
```

---

## Task 2: Insert paragraph in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md:215-218`

The insertion point is after the `**Concurrency Handling**` paragraph (line
216) and before `### Infrastructure` (line 218). Do not touch any surrounding
text.

- [ ] **Step 1: Open CLAUDE.md and locate the exact insertion point**

Search for this exact block (currently at lines 215–218):

```
**Concurrency Handling**:
Completion requests are race-prone against document updates. The `server-handlers.ts` uses `document_store.wait_for_update(uri)` to ensure any pending `textDocument/didChange` processing completes before serving completions.

### Infrastructure
```

- [ ] **Step 2: Replace that block with the following** (adds one paragraph between Concurrency Handling and ### Infrastructure)

```
**Concurrency Handling**:
Completion requests are race-prone against document updates. The `server-handlers.ts` uses `document_store.wait_for_update(uri)` to ensure any pending `textDocument/didChange` processing completes before serving completions.

**Find References — Three-Tier Scoping**: The references provider uses three
distinct scoping tiers by design: (1) **local macros** — include-chain files
only (Stata locals don't propagate through `do`/`run`); (2) **global macros,
programs, scalars, matrices** — dep-graph-reachable files (all do/run/include
edges); (3) **variables** — entire workspace (dataset columns like `id`,
`year`, `analysis_sample` are legitimately shared across unrelated analyses).
If this looks like a bug: it is not. See
[docs/find-references.md](docs/find-references.md). Implementation:
`src/providers/references.ts::collect_references`.

### Infrastructure
```

- [ ] **Step 3: Verify the paragraph is present**

```bash
grep -n "Three-Tier Scoping" CLAUDE.md
```

Expected: one hit on a line between 215 and 225.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add find-references three-tier scoping note to CLAUDE.md (issue #128)"
```

---

## Task 3: Add doc-pointer comments in `src/providers/references.ts`

**Files:**
- Modify: `src/providers/references.ts` — three comment-only edits

All three edits are in the same file. Make them all, verify, then commit once.

### Site 1 — `collect_references`, line 747

Find this exact text (currently at line 747):

```typescript
        // so the reachable set is restricted to include-only edges.
        const restrict_to_related = symbol_type !== 'variable';
```

Replace with:

```typescript
        // so the reachable set is restricted to include-only edges.
        // See docs/find-references.md for the rationale behind this three-tier model.
        const restrict_to_related = symbol_type !== 'variable';
```

- [ ] **Step 1: Make the Site 1 edit** (append one comment line before `const restrict_to_related`)

### Site 2 — `classify_word_symbol` scope-resolver path, line 596

Find this exact text (currently at lines 594–596):

```typescript
            // 3. Variables remain workspace-wide: dataset columns are
            //    legitimately shared across unrelated modules, so no
            //    call-site filter here.
```

Replace with:

```typescript
            // 3. Variables remain workspace-wide: dataset columns are
            //    legitimately shared across unrelated modules, so no
            //    call-site filter here. See docs/find-references.md.
```

- [ ] **Step 2: Make the Site 2 edit** (append doc pointer to last line of comment)

### Site 3 — `classify_word_symbol` fallback path, line 652

Find this exact text (currently at lines 649–652):

```typescript
            if (has_cross_file_related('matrix')) {
                return { name: word, type: 'matrix', range };
            }
            if (has_cross_file_any('variable')) {
```

Replace with:

```typescript
            if (has_cross_file_related('matrix')) {
                return { name: word, type: 'matrix', range };
            }
            // Variables remain workspace-wide on the fallback path too;
            // see docs/find-references.md.
            if (has_cross_file_any('variable')) {
```

- [ ] **Step 3: Make the Site 3 edit** (add two-line comment before the `if`)

### Verify and commit

- [ ] **Step 4: Run typecheck to confirm no syntax errors crept in**

```bash
bun run typecheck
```

Expected: exits 0 with no errors. (Comment-only edits cannot cause type errors,
but this confirms no accidental whitespace damage.)

- [ ] **Step 5: Verify all three pointers are present**

```bash
grep -n "find-references.md" src/providers/references.ts
```

Expected: exactly 3 hits — one in `collect_references`, one in
`classify_word_symbol` scope-resolver path, one in `classify_word_symbol`
fallback path.

- [ ] **Step 6: Commit**

```bash
git add src/providers/references.ts
git commit -m "docs: add find-references.md pointers at all three variable-scoping sites (issue #128)"
```
