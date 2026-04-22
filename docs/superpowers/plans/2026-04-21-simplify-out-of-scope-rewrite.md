# Simplify OUT_OF_SCOPE_SYMBOL rewrite to single-boundary semantics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the OUT_OF_SCOPE_SYMBOL rewrite so it only names a specific file when the suggested one-line fix (promote this `do`/`run` to `include`) actually exposes the referenced local. In every other case, fall back to the plain UNDEFINED_MACRO warning.

**Architecture:** `compute_effective_end_state_locals` becomes an **include-only** walk of a direct callee (no descent through `do`/`run`). Nested call sites bubbled up from inner recursion are always handed out with `excluded_locals: undefined`, because their blame targets don't correspond to a one-line fix at the outer reference. The `boundary_only` `DuplicateCallDecision` variant is deleted — a duplicate `do`-after-`do` goes back to `skip`. The independent oracle (`StataExecutionOracle.blame_target_for`) changes to match: for each root-level `do`/`run` before the reference, walk its callee include-only and take the last binding; return `null` if none matches.

**Tech Stack:** TypeScript, Bun, fast-check.

**Why this shape:**
- The current all-promotion counterfactual names files that are only reachable if the user promotes *every* downstream `do`/`run`, not just the one the diagnostic text points at (Codex 2026-04 finding).
- A correct "generic undefined local" warning is already the analyzer's default; handing the user that message in ambiguous chains is acceptable per project owner's call.
- Shrinking the rewrite deletes the `boundary_only` action, the conditional nested-site strip, and a lot of reasoning about counterfactual descent ordering.

**Non-goals:** We are NOT trying to fix the rewrite for deep chains; we are explicitly choosing generic fallback in those cases. The property test's "deep graphs" variant will still run but will simply validate that most blocked references go to the generic path.

---

## File map

**Production (edit):**
- `src/forward-scope-resolver/index.ts` — restrict helper to include-only walk; remove `boundary_only` branch; unconditional nested-site strip.
- `src/types/index.ts` — remove `boundary_only` variant from `DuplicateCallDecision`; refresh `ForwardCallSite.excluded_locals` comment.
- `src/providers/diagnostics.ts` — no structural changes. (The site-iteration + `excluded_callee_uri` logic still works; it just has less to iterate over.)

**Tests (edit):**
- `tests/property/helpers/stata-execution-oracle.ts` — rewrite `blame_target_for` (and drop `walk_counterfactual`) for single-boundary semantics.
- `tests/unit/stata-execution-oracle-counterfactual.test.ts` — flip Bug B and Codex audit expectations.
- `tests/property/forward-call-out-of-scope-oracle.prop.test.ts` — update Bug B fixture to expect generic UNDEFINED; flip Codex audit fixture to expect `defs1.do`; update codex-gap-5 dedup fixture to `file_2.do` (or delete since its narrative was boundary_only-specific).
- `tests/unit/forward-scope-resolver-effective-end-state.test.ts` — flip the "nested `do` contributes its locals counterfactually" expectation; update header comment; leave depth/cycle/sort tests alone.
- `tests/unit/forward-scope-resolver-sort-order.test.ts` — no change needed (sort logic is unchanged).

**Docs (edit):**
- `CLAUDE.md` — no change (it doesn't describe the counterfactual model at this level of detail).
- Inline comments in `src/forward-scope-resolver/index.ts` that reference "counterfactual", "all-promotion", "promote every do/run" get rewritten to "include-only walk".

---

### Task 1: Rewrite the oracle to single-boundary semantics

**Files:**
- Modify: `tests/property/helpers/stata-execution-oracle.ts`

- [ ] **Step 1: Update the oracle implementation**

Replace the existing `blame_target_for` and `walk_counterfactual` with an include-only, per-direct-call walk. Keep `is_visible_at`, `simulate_stack_until_ref`, `get_file_name`, and `is_defined_in_root` as-is (they still model real Stata execution for property 1 and the root-defined carve-out).

```typescript
// tests/property/helpers/stata-execution-oracle.ts
/**
 * Stata execution oracle for forward-call graphs.
 *
 * Ground truth for `tests/property/forward-call-out-of-scope-oracle.prop.test.ts`.
 *
 * Semantics modelled:
 *
 *  - `is_visible_at()` — real Stata: a scope stack pushes a fresh scope on
 *    `do`/`run` and keeps the caller's scope on `include`. Reports whether
 *    the referenced name is bound when the reference event fires.
 *
 *  - `blame_target_for()` — single-boundary counterfactual: for each
 *    root-level `do`/`run` call that precedes the reference, promote ONLY
 *    that one boundary to `include` and ask whether the referenced local
 *    would then be bound. Internal `do`/`run` boundaries stay opaque —
 *    `include` is the only edge the walk descends. Returns the file whose
 *    `local X` is the last (in source order, across visible sites) include-
 *    reachable binding, or `null` when no single-boundary promotion would
 *    expose the name.
 */
import { ForwardCallGraph } from '../generators/forward-call-graphs';

export class StataExecutionOracle {
    constructor(private graph: ForwardCallGraph) {}

    is_visible_at(): boolean {
        const the_scope = this.simulate_stack_until_ref();
        return the_scope !== null && the_scope.has(this.graph.reference_name);
    }

    blame_target_for(): number | null {
        // Iterate root-level events in source order until the reference.
        // For each do/run call before the reference, compute the include-
        // only end-state of the callee. The last such call whose end-state
        // binds `reference_name` wins (matches the diagnostic provider's
        // last-visible-site precedence).
        const my_root = this.graph.files[0];
        let blame: number | null = null;
        for (let i = 0; i < my_root.events.length; i++) {
            if (i === this.graph.reference_event_index) break;
            const my_event = my_root.events[i];
            if (my_event.kind !== 'do_call' && my_event.kind !== 'run_call') {
                continue;
            }
            const end_state = this.compute_include_only_end_state(
                my_event.target,
                new Set<number>(),
            );
            const my_winner = end_state.get(this.graph.reference_name);
            if (my_winner !== undefined) {
                blame = my_winner;
            }
        }
        return blame;
    }

    get_file_name(file_index: number): string {
        return this.graph.files[file_index].filename;
    }

    /**
     * True when the referenced name is defined anywhere in the root file
     * — even after the reference line. The LSP preserves the analyzer's
     * UNDEFINED_MACRO diagnostic for in-root forward references instead
     * of rewriting to OUT_OF_SCOPE_SYMBOL; see `src/providers/diagnostics.ts`
     * around line 358 and issue #145.
     */
    is_defined_in_root(): boolean {
        const my_root = this.graph.files[0];
        for (const my_event of my_root.events) {
            if (
                my_event.kind === 'define_local' &&
                my_event.name === this.graph.reference_name
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Stack-based real-Stata simulation. Returns the current top-of-stack
     * scope when the reference event is reached in the root file, or
     * `null` if the reference is never reached.
     */
    private simulate_stack_until_ref(): Map<string, number> | null {
        const scope_stack: Map<string, number>[] = [new Map()];
        return this.simulate_file(0, scope_stack, new Set([0]));
    }

    private simulate_file(
        file_index: number,
        scope_stack: Map<string, number>[],
        visited: Set<number>,
    ): Map<string, number> | null {
        const my_file = this.graph.files[file_index];
        for (let i = 0; i < my_file.events.length; i++) {
            const my_event = my_file.events[i];
            if (file_index === 0 && i === this.graph.reference_event_index) {
                return scope_stack[scope_stack.length - 1];
            }
            if (my_event.kind === 'define_local') {
                scope_stack[scope_stack.length - 1].set(my_event.name, file_index);
            } else if (my_event.kind === 'include_call') {
                if (visited.has(my_event.target)) continue;
                const my_visited = new Set(visited);
                my_visited.add(my_event.target);
                const result = this.simulate_file(my_event.target, scope_stack, my_visited);
                if (result !== null) return result;
            } else if (
                my_event.kind === 'do_call' ||
                my_event.kind === 'run_call'
            ) {
                if (visited.has(my_event.target)) continue;
                const my_visited = new Set(visited);
                my_visited.add(my_event.target);
                scope_stack.push(new Map());
                const result = this.simulate_file(my_event.target, scope_stack, my_visited);
                scope_stack.pop();
                if (result !== null) return result;
            }
        }
        return null;
    }

    /**
     * Include-only end-state: walk the callee in source order, overwriting
     * bindings as `local X` statements fire, and merging include-reachable
     * end-states from nested `include` calls. `do`/`run` events are
     * skipped — they would run in a fresh scope and leave nothing behind.
     *
     * Cycle protection is per-path (current_path) so mutual includes
     * terminate.
     */
    private compute_include_only_end_state(
        file_index: number,
        current_path: Set<number>,
    ): Map<string, number> {
        if (current_path.has(file_index)) return new Map();
        current_path.add(file_index);
        try {
            const the_scope = new Map<string, number>();
            const my_file = this.graph.files[file_index];
            for (const my_event of my_file.events) {
                if (my_event.kind === 'define_local') {
                    the_scope.set(my_event.name, file_index);
                } else if (my_event.kind === 'include_call') {
                    const my_nested = this.compute_include_only_end_state(
                        my_event.target,
                        current_path,
                    );
                    for (const [my_name, my_owner] of my_nested) {
                        the_scope.set(my_name, my_owner);
                    }
                }
                // do_call / run_call: skipped.
            }
            return the_scope;
        } finally {
            current_path.delete(file_index);
        }
    }
}
```

- [ ] **Step 2: Update the oracle unit tests to the new semantics**

In `tests/unit/stata-execution-oracle-counterfactual.test.ts`:

Rewrite the describe header comment to mention single-boundary semantics. Change two tests; leave Bug A, a813cca, and the null test unchanged.

`Bug B`: the oracle now returns `null` because there is no root-level `do`/`run` before the reference in the root file (root `include child` + reference).

```typescript
test('Bug B: root include blocker is not a do/run - returns null', () => {
    // root: include child; ref macro_a
    // child: do grandchild
    // grandchild: local macro_a
    //
    // Single-boundary semantics: no root-level do/run precedes the
    // reference, so no one-line fix on a root `do`/`run` exposes the
    // binding. The diagnostic falls back to generic UNDEFINED_MACRO and
    // the oracle must return null.
    const g = graph([
        { name: 'main.do', events: [
            { kind: 'include_call', target: 1 },
            { kind: 'reference_local', name: 'macro_a' },
        ]},
        { name: 'child.do', events: [
            { kind: 'do_call', target: 2 },
        ]},
        { name: 'grandchild.do', events: [
            { kind: 'define_local', name: 'macro_a' },
        ]},
    ], 1, 'macro_a');
    const oracle = new StataExecutionOracle(g);
    expect(oracle.blame_target_for()).toBeNull();
});
```

`Codex audit`: the oracle now returns `2` (defs1), because root `do child` is the single boundary and child's include-only end-state binds `macro_a` from defs1 (the later `include mid` end-state is empty — mid's only event is a `do`, which the walk skips).

```typescript
test('Codex audit: nested do under include chain names defs1 (single-boundary)', () => {
    // root: do child; ref macro_a
    // child: include defs1; include mid
    // defs1: local macro_a
    // mid: do grandchild
    // grandchild: local macro_a
    //
    // Promoting only root's `do child` to `include child` makes child run
    // in main's scope. child's include-only end-state: include defs1
    // binds macro_a to defs1; include mid contributes nothing (mid's only
    // event is a do, which is opaque). grandchild's binding is NOT
    // exposed by this one-line fix.
    const g = graph([
        { name: 'main.do', events: [
            { kind: 'do_call', target: 1 },
            { kind: 'reference_local', name: 'macro_a' },
        ]},
        { name: 'child.do', events: [
            { kind: 'include_call', target: 2 },
            { kind: 'include_call', target: 3 },
        ]},
        { name: 'defs1.do', events: [
            { kind: 'define_local', name: 'macro_a' },
        ]},
        { name: 'mid.do', events: [
            { kind: 'do_call', target: 4 },
        ]},
        { name: 'grandchild.do', events: [
            { kind: 'define_local', name: 'macro_a' },
        ]},
    ], 1, 'macro_a');
    const oracle = new StataExecutionOracle(g);
    expect(oracle.blame_target_for()).toBe(2); // defs1.do
});
```

- [ ] **Step 3: Run the oracle unit tests to verify they pass against the new oracle**

Run: `bun test tests/unit/stata-execution-oracle-counterfactual.test.ts`
Expected: PASS on all 5 tests.

- [ ] **Step 4: Commit**

```bash
git add tests/property/helpers/stata-execution-oracle.ts tests/unit/stata-execution-oracle-counterfactual.test.ts
git commit -m "Simplify oracle to single-boundary include-only walk

The OUT_OF_SCOPE_SYMBOL rewrite is about to emit a specific filename
only when promoting a single blocking do/run to include would actually
expose the binding. The oracle mirrors that rule: walk each root-level
do/run's callee under an include-only event order and take the last
binding that matches. Internal do/run boundaries stay opaque."
```

---

### Task 2: Update property-test regression fixtures

**Files:**
- Modify: `tests/property/forward-call-out-of-scope-oracle.prop.test.ts`

This task updates only the `regression: pinned scenarios from code review` block. The three top-level properties (visibility soundness, rewrite attribution, generic-warning completeness) stay as-written — the oracle change alone is enough to keep them meaningful under the new semantics.

- [ ] **Step 1: Bug B — expect generic UNDEFINED, no rewrite**

Replace the existing `Bug B: do nested under include keeps its boundary blame` test with this one. The narrative flips: under the new rules, there is no root-level do/run preceding the reference, so the rewrite is suppressed and the analyzer's generic warning stands.

```typescript
// Bug B (this branch): nested do under an include chain used to be
// forcibly blamed. Under single-boundary semantics the rewrite no longer
// fires here — there is no root-level `do`/`run` whose promotion would
// expose the deep binding — so the analyzer's generic UNDEFINED_MACRO
// stands. Kept as a pin so we don't accidentally regress back to the
// all-promotion rewrite.
test('Bug B: nested do under include falls back to generic UNDEFINED_MACRO', async () => {
    fs.writeFileSync(path.join(h.temp_dir, 'grandchild.do'), 'local veggie beet');
    fs.writeFileSync(path.join(h.temp_dir, 'child.do'), 'do "grandchild.do"');
    const root_content = ['include "child.do"', 'di `veggie\''].join('\n');
    const root_path = path.join(h.temp_dir, 'main.do');
    fs.writeFileSync(root_path, root_content);
    const root_uri = URI.file(root_path).toString();
    await h.document_store.open(root_uri, root_content, 1);
    const doc = h.document_store.get(root_uri)!;
    const diags = await h.diagnostics_provider.get_diagnostics(
        doc,
        MIN_CONFIG,
        undefined,
        h.scope_resolver,
    );
    const ref_line_diags = diags.filter(d => d.range.start.line === 1);
    const rewrite = ref_line_diags.find(
        d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
             d.message.includes('veggie'),
    );
    const generic = ref_line_diags.find(
        d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
             d.message.includes('veggie'),
    );
    expect(rewrite).toBeUndefined();
    expect(generic).toBeDefined();
});
```

- [ ] **Step 2: Codex audit — expect defs1.do, not grandchild.do**

Replace the existing `codex audit` test with this. The include-only walk of child stops at the `do grandchild` inside mid, so the named file is defs1.

```typescript
// Codex audit (2026-04): under single-boundary semantics, promoting
// root's `do child` to `include child` makes child run in main's scope.
// child's include-only end-state binds x from defs1 (reached through
// include); mid's `do grandchild` is opaque and contributes nothing.
// The diagnostic must name defs1, not grandchild.
test('codex audit: single-boundary walk names defs1 (nested do stays opaque)', async () => {
    fs.writeFileSync(path.join(h.temp_dir, 'defs1.do'), 'local x defs1');
    fs.writeFileSync(path.join(h.temp_dir, 'grandchild.do'), 'local x grand');
    fs.writeFileSync(path.join(h.temp_dir, 'mid.do'), 'do "grandchild.do"');
    fs.writeFileSync(
        path.join(h.temp_dir, 'child.do'),
        ['include "defs1.do"', 'include "mid.do"'].join('\n'),
    );
    const root_content = ['do "child.do"', 'di `x\''].join('\n');
    const root_path = path.join(h.temp_dir, 'main.do');
    fs.writeFileSync(root_path, root_content);
    const root_uri = URI.file(root_path).toString();
    await h.document_store.open(root_uri, root_content, 1);
    const doc = h.document_store.get(root_uri)!;
    const diags = await h.diagnostics_provider.get_diagnostics(
        doc,
        MIN_CONFIG,
        undefined,
        h.scope_resolver,
    );
    const informative = diags.find(
        d => d.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL &&
             d.message.includes("'x'"),
    );
    expect(informative).toBeDefined();
    expect(informative!.message).toContain('defs1.do');
    expect(informative!.message).not.toContain('grandchild.do');
});
```

- [ ] **Step 3: Delete the codex-gap-5 dedup-revisit fixture**

The `codex gap 5 (dedup revisit): second direct run emits its own blame` test was specifically about the `boundary_only` dedup action, which is being removed. Under the new rules the second `run file_5` is dedup'd away by the plain `skip` path, and the blame comes from the first `run file_2` — a different (and much less focused) scenario. Delete the test entirely rather than repurpose it; its narrative no longer matches the code it was protecting.

- [ ] **Step 4: Leave run-vs-do, cycle, severity fixtures alone**

These still exercise real behavior under the new semantics:
- run-vs-do: direct do/run callees emit identical blame (still true — include-only walk is symmetric in call type at the top level).
- cycle: include-only walk terminates on cycles via `current_path`.
- severity passthrough: diagnostic message construction unchanged.

No edits.

- [ ] **Step 5: Run the regression block to verify all fixtures pass against the NEW oracle but the CURRENT production (they will fail; that's TDD red)**

Run: `bun test tests/property/forward-call-out-of-scope-oracle.prop.test.ts --test-name-pattern="regression"`
Expected: FAIL on Bug B (current production emits the specific rewrite) and FAIL on codex audit (current production names grandchild.do). Other regression fixtures pass.

Note the failing tests — they are the contracts we will satisfy in Tasks 4-6.

- [ ] **Step 6: Commit**

```bash
git add tests/property/forward-call-out-of-scope-oracle.prop.test.ts
git commit -m "Pin regression fixtures to single-boundary rewrite semantics

Bug B now falls back to generic UNDEFINED_MACRO (root's include is not a
blocking do/run, and nested blame claims no longer bubble out).

Codex audit now names defs1.do — promoting root's do child to include
exposes defs1's local via child's include chain, but the deeper
do grandchild remains opaque.

The codex-gap-5 dedup-revisit fixture is removed because its narrative
was specific to the boundary_only action being deleted in the next
commits."
```

---

### Task 3: Update effective-end-state unit tests

**Files:**
- Modify: `tests/unit/forward-scope-resolver-effective-end-state.test.ts`

Only one test's expectation changes; everything else (empty, last-def, include-then-local, local-then-include, cycle, depth boundary) is unchanged under include-only.

- [ ] **Step 1: Flip the `nested do` test**

Replace the `nested \`do\` contributes its locals counterfactually (promote-all model)` test with an assertion that nested `do` targets are NOT walked. Keep the `fruit` expectation (own local in the callee); drop `veggie` (nested do target's local).

```typescript
test('nested `do` is opaque: walk does not descend into `do`/`run` callees', async () => {
    // The helper is the engine behind OUT_OF_SCOPE_SYMBOL rewrites. The
    // rewrite is a single-boundary counterfactual: "promote THIS one
    // do/run to include — where would the local now come from?" Deeper
    // do/run boundaries stay opaque because promoting them would be a
    // separate fix. So this walk does not descend into `do`/`run`
    // callees, even when they define the referenced name.
    const nested_path = path.join(temp_dir, 'nested_do_target.do');
    fs.writeFileSync(nested_path, 'local veggie beet');
    const my_path = path.join(temp_dir, 'nested_do.do');
    fs.writeFileSync(my_path, ['do "nested_do_target.do"', 'local fruit apple'].join('\n'));
    const result = await walk(my_path);
    expect(result.has('fruit')).toBe(true);
    expect(result.has('veggie')).toBe(false);
    expect(result.get('fruit')!.sourceUri).toContain('nested_do.do');
});
```

- [ ] **Step 2: Rewrite the file header docstring**

The top-of-file comment mentions "counterfactual" framing. Update to match the new include-only model:

```typescript
/**
 * Unit tests for `ForwardScopeResolver.compute_effective_end_state_locals`.
 *
 * The helper computes a callee's include-only end-state: walk its own
 * `local X` statements in source order, merging the end-states of any
 * nested `include` callees. `do`/`run` callees are NOT descended — they
 * would require a separate boundary promotion to expose their bindings.
 * The helper drives the OUT_OF_SCOPE_SYMBOL rewrite message, so covering
 * it at unit level catches shadowing/redefinition and cycle-handling
 * regressions closer to the code under change.
 */
```

- [ ] **Step 3: Update the "nested do redef" test narrative**

The test "nested `do` that redefines an earlier include local: include wins when it comes after" still passes algorithmically (the own local comes after the `do`, so it wins either way), but its narrative implies we descend into the `do`. Simplify:

```typescript
test('own local after opaque `do` wins (nested do target is not walked)', async () => {
    const nested_path = path.join(temp_dir, 'nested_do_redef.do');
    fs.writeFileSync(nested_path, 'local shared beet');
    const my_path = path.join(temp_dir, 'nested_do_overridden.do');
    fs.writeFileSync(
        my_path,
        ['do "nested_do_redef.do"', 'local shared carrot'].join('\n'),
    );
    const result = await walk(my_path);
    expect(result.size).toBe(1);
    // `do` is opaque, so only the caller's own `local shared carrot`
    // contributes — no need to reason about which comes first.
    expect(result.get('shared')!.sourceUri).toContain('nested_do_overridden.do');
});
```

- [ ] **Step 4: Run the unit tests (still against CURRENT production — should FAIL on `nested do is opaque`)**

Run: `bun test tests/unit/forward-scope-resolver-effective-end-state.test.ts`
Expected: FAIL on `nested do is opaque` (current production descends into the nested do and binds `veggie`). Other tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/forward-scope-resolver-effective-end-state.test.ts
git commit -m "Flip nested-do unit test to opaque-boundary expectation"
```

---

### Task 4: Production — restrict helper to include-only descent

**Files:**
- Modify: `src/forward-scope-resolver/index.ts:630-648` (inside `compute_effective_end_state_locals`)

- [ ] **Step 1: Skip `do`/`run` events in the walk**

Find the `for (const my_call of callee_result.forward_calls)` loop inside `compute_effective_end_state_locals`. Add a type filter that keeps only `include`:

```typescript
for (const my_call of callee_result.forward_calls) {
    if (!my_call.is_static || !my_call.path) continue;
    // Include-only descent. `do`/`run` callees run in a fresh scope
    // and leave no bindings behind for the caller's end-of-execution
    // state — promoting them to `include` is a separate fix from the
    // one this helper's blame rewrite suggests.
    if (my_call.type !== 'include') continue;
    the_events.push({
        line: my_call.call_site_line,
        character: my_call.range.start.character,
        kind: 'call',
        call: my_call,
    });
}
```

- [ ] **Step 2: Update the helper's docstring**

Rewrite the docstring above `compute_effective_end_state_locals` to reflect the include-only semantic. Replace the existing multi-paragraph comment with:

```typescript
/**
 * Walk a callee's top-level local definitions and nested `include` calls
 * in source order to compute the effective end-of-file local-macro state
 * assuming the caller's `do`/`run` of this callee were promoted to
 * `include`. `do`/`run` calls FROM this callee are NOT descended — they
 * are still blocking boundaries after the single-boundary promotion, so
 * their bindings are not exposed by this one-line fix.
 *
 * - Own `local X` statements overwrite prior bindings.
 * - `include` events merge the nested callee's effective end state
 *   (recursively computed) into the walk.
 * - `do`/`run` events contribute nothing.
 *
 * Used to populate `ForwardCallSite.excluded_locals` for `do`-called
 * sites so OUT_OF_SCOPE_SYMBOL diagnostics point at the callee whose
 * local actually wins under a single-boundary promotion.
 */
```

- [ ] **Step 3: Run the effective-end-state unit tests — they should now pass**

Run: `bun test tests/unit/forward-scope-resolver-effective-end-state.test.ts`
Expected: PASS on all tests including `nested do is opaque`.

- [ ] **Step 4: Run the oracle counterfactual unit tests (should also pass — they only depend on the oracle)**

Run: `bun test tests/unit/stata-execution-oracle-counterfactual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forward-scope-resolver/index.ts
git commit -m "Restrict end-state walk to include-only descent

do/run callees were previously walked under a counterfactual-all-
include model, which produced blame that pointed at files the suggested
one-line fix (promote the outer do to include) would not actually
expose. The helper now matches its docstring: promote only this one
boundary, ask include-only what's bound."
```

---

### Task 5: Production — unconditional strip of nested excluded_locals

**Files:**
- Modify: `src/forward-scope-resolver/index.ts:390-409` (nested-site flattening inside `resolve()`)

- [ ] **Step 1: Strip nested excluded_locals unconditionally**

Find the comment block `// Add nested call sites with adjusted call lines...` and the subsequent `for (const nested_site of nested_result.call_sites)` loop. Replace it with:

```typescript
// Add nested call sites with adjusted call lines. Nested sites inherit
// the parent call_line for visibility filtering, but their
// `excluded_locals` are ALWAYS stripped: each nested site's blame
// target represents a different one-line fix (promoting that deeper
// do/run to include) than the one the outer reference's diagnostic is
// about to suggest. Only the direct-child site's excluded_locals claim
// applies to the user's visible "do X" they could edit.
for (const nested_site of nested_result.call_sites) {
    the_call_sites.push({
        ...nested_site,
        call_line: my_call.call_site_line,
        excluded_locals: undefined,
    });
}
```

- [ ] **Step 2: Run the regression fixtures — Bug B and codex audit should now pass**

Run: `bun test tests/property/forward-call-out-of-scope-oracle.prop.test.ts --test-name-pattern="regression"`
Expected: PASS on Bug B (generic fallback) and codex audit (defs1.do).

- [ ] **Step 3: Commit**

```bash
git add src/forward-scope-resolver/index.ts
git commit -m "Strip nested excluded_locals when flattening call sites

Each nested do/run site represents a distinct one-line fix. Bubbling
its excluded_locals claim up to the outer iteration lets a deeper
boundary's blame pick a file the outer diagnostic's suggested include
promotion would not actually expose."
```

---

### Task 6: Production — remove `boundary_only` variant

**Files:**
- Modify: `src/types/index.ts:856-866` (`DuplicateCallDecision`)
- Modify: `src/forward-scope-resolver/index.ts:229-267` (the `boundary_only` branch in `resolve()`) and `src/forward-scope-resolver/index.ts:468-494` (`should_process_call`)

- [ ] **Step 1: Remove the `boundary_only` variant from the type**

Replace the `DuplicateCallDecision` definition with the pre-branch shape:

```typescript
export type DuplicateCallDecision =
  | { action: 'skip' }
  | { action: 'process' }
  | { action: 'add_locals_only' };
```

- [ ] **Step 2: Revert `should_process_call` to return `skip` on a duplicate do-after-do**

Replace the trailing comment + `return { action: 'boundary_only' };` in `should_process_call` with the pre-branch skip:

```typescript
should_process_call(
    callee_uri: string,
    call_type: ForwardCallType,
    visited: Map<string, EffectiveCallType>
): DuplicateCallDecision {
    const previous_type = visited.get(callee_uri);

    if (previous_type === undefined) {
        return { action: 'process' };
    }

    if (previous_type === 'include') {
        return { action: 'skip' };
    }

    // previous_type === 'do': symbol accumulation is unchanged on a
    // re-visit, and the first direct-child site already carries the
    // include-only end-state claim for the blame rewrite. A second
    // do/run re-entry of the same callee produces the same include-only
    // end-state, so there is nothing new to contribute.
    if (call_type === 'include') {
        return { action: 'add_locals_only' };
    }

    return { action: 'skip' };
}
```

- [ ] **Step 3: Remove the `boundary_only` branch from `resolve()`**

Delete the entire block starting with `if (decision.action === 'boundary_only') {` through its matching `continue;`. After `decision.action === 'skip'` handling, the next remaining branch is `const callee_result = await this.get_callee_scope(...)`.

- [ ] **Step 4: Run typecheck and the full test suite**

Run: `bun run typecheck`
Expected: PASS (no remaining references to `boundary_only`).

Run: `bun test tests/unit/ tests/property/forward-call-out-of-scope-oracle.prop.test.ts tests/property/forward-scope-resolution.prop.test.ts tests/integration/current-file-forward-call-diagnostics.test.ts`
Expected: PASS across the board.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/forward-scope-resolver/index.ts
git commit -m "Remove boundary_only DuplicateCallDecision variant

Under single-boundary semantics a do/run re-visit produces the same
include-only end-state the first visit already claimed, so there is no
new blame to surface. Returning to 'skip' restores the simpler pre-
branch dedup contract."
```

---

### Task 7: Refresh documentation comments

**Files:**
- Modify: `src/types/index.ts:823-837` (`ForwardCallSite.excluded_locals` docstring)

- [ ] **Step 1: Rewrite the `excluded_locals` docstring**

The current comment mentions "double-claim" filtering between direct-child and nested sites — no longer relevant, because nested sites are unconditionally stripped. Replace with:

```typescript
// Effective end-of-execution top-level local macros of the callee,
// computed as the include-only end state of the callee's sub-chain.
// Populated ONLY on direct-child `do`/`run` sites (calls made from the
// file being resolved whose original type is `do`/`run`). A blame entry
// represents "if this one call were promoted to `include`, the
// referenced local would be bound here" — so the diagnostic can point
// at the file whose `local` statement actually wins under that one-line
// fix. Nested sites flattened from a deeper `resolve()` always arrive
// with `excluded_locals: undefined`; their blame would correspond to a
// different boundary promotion than the one the outer diagnostic's
// message suggests.
excluded_locals?: Map<string, MacroSymbol>;
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Refresh ForwardCallSite.excluded_locals docstring"
```

---

### Task 8: Full test suite + cleanup verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `bun run test`
Expected: PASS — no failures.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Grep for any remaining `boundary_only` or `counterfactual-all` references**

Run: grep across `src/` and `tests/` for `boundary_only` and `counterfactual-all` and `promote every` (multiple matches expected to be zero except in commit-log-style messages or the oracle's new docstrings).

Expected: no production references to `boundary_only`; oracle docstring may still mention "counterfactual" for the `is_visible_at` vs `blame_target_for` contrast.

- [ ] **Step 4: Final review commit (if anything stray was found)**

If the grep uncovered leftover commentary or references, clean them up in a final commit. Otherwise this step is a no-op.

---

## Self-Review checklist

**Spec coverage:**
- User's stated goal — generic fallback for complex cases, specific rewrite for the one-level-fix case — is Task 4 (include-only descent) + Task 5 (strip nested). ✓
- Codex audit finding (diagnostic names a file the suggested fix wouldn't expose) — addressed by Task 4 (the walk no longer descends `do`). ✓
- `boundary_only` + nested-strip conditional no longer needed — Tasks 5 and 6. ✓
- Oracle independence — new oracle models single-fix semantics without referring to resolver internals (Task 1). ✓

**Placeholder scan:** None detected. Every step includes the actual code or exact command.

**Type consistency:** `DuplicateCallDecision` variants used in `should_process_call` (`skip`/`process`/`add_locals_only`) match the updated type (Task 6). `compute_include_only_end_state` (new oracle method) matches its call sites. `excluded_locals: undefined` assignment matches the optional type.

**Behavior regressions acknowledged:** Bug B no longer emits a specific rewrite (intentional — user accepted generic fallback). The `codex-gap-5 dedup-revisit` fixture is deleted (its narrative was specific to `boundary_only`).
