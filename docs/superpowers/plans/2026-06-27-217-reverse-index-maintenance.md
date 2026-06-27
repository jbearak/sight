# Eliminate redundant `forward_caller_to_callees` index (#217) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the redundant `forward_caller_to_callees` reverse index that the live-edit path fails to maintain, removing the memory-hygiene leak described in #217.

**Architecture:** `forward_caller_to_callees` duplicates information already in `caller_to_callees` (a caller's callee set is `caller_to_callees.get(caller)?.keys()`), is never read for any decision, and its only reader is self-maintenance. We remove the field and every site that touches it, and migrate tests to assert against the authoritative `caller_to_callees`. A new deterministic regression test reproduces the issue repro and asserts no stale callee URI remains in `reverse_deps`.

**Tech Stack:** TypeScript, Bun test runner, `vscode-uri`.

## Global Constraints

- Stata is fully case-sensitive — not relevant to this change, but do not introduce any `toLowerCase()` normalization.
- New comments ≤72 chars; new code ≤80 chars.
- New locals: `snake_case` with `my_`/`the_` prefixes per CLAUDE.md.
- Gates (both must be clean): `bun run test` (typecheck + full suite) and `bun run lint` (eslint — not in CI, run manually).
- Spec: `docs/superpowers/specs/2026-06-27-217-reverse-index-maintenance-design.md` (option B).

---

### Task 1: Add the regression test (red)

Reproduce the issue repro deterministically and prove it fails on the current (unmodified) code, before removing anything. The test does a generic structural scan of `reverse_deps`, so it never names the field being deleted and therefore compiles both before and after removal.

**Files:**
- Test: `tests/unit/scope-resolver/forward-call-relationships.test.ts`

**Interfaces:**
- Consumes: `ScopeResolver`, `register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols)`, `update_reverse_dependencies(caller_uri, forward_calls, symbols)`, `remove_uri_from_reverse_deps(uri)` (all via `(resolver as any)`), and the existing `make_forward_call` / `create_empty_symbol_table` / `create_mock_content_provider` helpers in this file.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a `describe` block + the regression test at the end of the file (before the final closing `});` of the top-level `describe`).**

Place a module-level helper above the top-level `describe('Forward Call Relationship Tracking', ...)` block (after the existing helpers, near line 45):

```typescript
// Recursively scan an arbitrary value for any string === target.
// Used to assert no stale callee URI lingers anywhere in reverse_deps
// without naming any specific map (so it survives field removal).
function value_references_uri(value: unknown, target: string): boolean {
    if (typeof value === 'string') {
        return value === target;
    }
    if (value instanceof Map) {
        for (const [my_key, my_val] of value) {
            if (value_references_uri(my_key, target)) return true;
            if (value_references_uri(my_val, target)) return true;
        }
        return false;
    }
    if (value instanceof Set) {
        for (const my_member of value) {
            if (value_references_uri(my_member, target)) return true;
        }
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(my_item =>
            value_references_uri(my_item, target));
    }
    if (value && typeof value === 'object') {
        return Object.values(value).some(my_val =>
            value_references_uri(my_val, target));
    }
    return false;
}
```

Add this test as a new `describe` block inside the top-level `describe`, after the `clear_forward_call_relationships` block:

```typescript
    describe('issue #217: live-edit then delete leaves no stale callee', () => {
        it('removes all references to a callee dropped via live edit '
            + 'then deleted', () => {
            const caller_uri = 'file:///caller.do';
            const a_uri = 'file:///a.do';
            const b_uri = 'file:///b.do';
            const symbols = create_empty_symbol_table();

            // 1. Register caller -> {a, b} via the cache path.
            const both_calls = [
                make_forward_call(
                    URI.parse(a_uri).fsPath, true, 'do', 1, 'a.do'),
                make_forward_call(
                    URI.parse(b_uri).fsPath, true, 'do', 2, 'b.do'),
            ];
            (resolver as any)
                .register_forward_call_relationships_from_cache(
                    caller_uri, both_calls, symbols);

            // 2. Live edit deletes `do b` -> only `do a` remains.
            const a_only = [
                make_forward_call(
                    URI.parse(a_uri).fsPath, true, 'do', 1, 'a.do'),
            ];
            (resolver as any).update_reverse_dependencies(
                caller_uri, a_only, symbols);

            const reverse_deps = (resolver as any).reverse_deps;

            // Authoritative maps no longer reference b.
            expect(reverse_deps.caller_to_callees.get(caller_uri)
                ?.has(b_uri)).toBeFalsy();
            expect(reverse_deps.callee_to_callers.has(b_uri))
                .toBe(false);

            // 3. Delete b.do.
            (resolver as any).remove_uri_from_reverse_deps(b_uri);

            // 4. No reference to b remains anywhere in reverse_deps.
            expect(value_references_uri(reverse_deps, b_uri))
                .toBe(false);
        });
    });
```

- [ ] **Step 2: Run the test and verify it FAILS on the unmodified code.**

Run: `bun test tests/unit/scope-resolver/forward-call-relationships.test.ts -t "issue #217"`
Expected: FAIL on the final assertion — `value_references_uri(reverse_deps, b_uri)` is `true` because the phantom `b` lingers in `forward_caller_to_callees[caller]` (the live-edit path never removed it, and the delete cleanup never visited the caller). The two authoritative-map assertions should PASS.

- [ ] **Step 3: Commit the red test.**

```bash
git add tests/unit/scope-resolver/forward-call-relationships.test.ts
git commit -m "test: reproduce #217 stale-callee leak (red)

Live-edit removal of a callee followed by deleting that callee's
file leaves a phantom entry in forward_caller_to_callees. Generic
reverse_deps scan catches it; passes once the redundant map is gone."
```

---

### Task 2: Remove the field and all its sites (green)

Delete `forward_caller_to_callees` from the type, the initializer, and every mutator/clear/read in `ScopeResolver`. Each removed line sits beside the equivalent authoritative-map operation, so removal is subtractive.

**Files:**
- Modify: `src/types/index.ts` (field decl + doc comment)
- Modify: `src/scope-resolver/index.ts` (initializer + 5 sites)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `ReverseDependencyIndex` without `forward_caller_to_callees`.

- [ ] **Step 1: Remove the field from `ReverseDependencyIndex`.**

In `src/types/index.ts`, delete these lines (the comment block + field):

```typescript
  // Forward call specific bidirectional tracking
  // Maps caller_uri -> Set<callee_uri> for forward calls specifically
  // This enables O(M) cleanup where M = number of callees for a file
  forward_caller_to_callees: Map<string, Set<string>>;

```

- [ ] **Step 2: Remove the initializer.**

In `src/scope-resolver/index.ts` (in the `reverse_deps` object literal, ~line 205), delete:

```typescript
            forward_caller_to_callees: new Map(),
```

- [ ] **Step 3: Remove the `reset_reverse_deps` clear.**

In `reset_reverse_deps` (~line 2926), delete:

```typescript
        this.reverse_deps.forward_caller_to_callees.clear();
```

- [ ] **Step 4: Remove the `remove_caller_from_reverse_deps` delete.**

In `remove_caller_from_reverse_deps` (~lines 2954-2955), delete the comment + line:

```typescript
        // Remove forward_caller_to_callees entry (prevents memory leak)
        this.reverse_deps.forward_caller_to_callees.delete(caller_uri);

```

- [ ] **Step 5: Remove the read/delete block in `remove_uri_from_reverse_deps`.**

In `remove_uri_from_reverse_deps` (~lines 2983-2990), delete the entire block (the preceding `caller_to_callees` deletion already performs the real cleanup):

```typescript
                // Also update forward_caller_to_callees to remove the deleted callee
                const forward_callees = this.reverse_deps.forward_caller_to_callees.get(my_caller_uri);
                if (forward_callees) {
                    forward_callees.delete(uri);
                    if (forward_callees.size === 0) {
                        this.reverse_deps.forward_caller_to_callees.delete(my_caller_uri);
                    }
                }
```

- [ ] **Step 6: Remove the build + set in `register_forward_call_relationships_from_cache`.**

In `register_forward_call_relationships_from_cache`:

Delete the `my_callees` Set declaration (~lines 3235-3236, keep the `callee_edges_map` line that follows):

```typescript
        // Track callees in a Set for this caller (for forward_caller_to_callees)
        const my_callees = new Set<string>();
```

Delete the `.add` inside the loop (~lines 3275-3276):

```typescript
            // Track this callee for forward_caller_to_callees
            my_callees.add(my_callee_uri);

```

Delete the `.set` block (~lines 3289-3292):

```typescript
        // Store in forward_caller_to_callees map (for O(M) clear)
        if (my_callees.size > 0) {
            this.reverse_deps.forward_caller_to_callees.set(caller_uri, my_callees);
        }

```

- [ ] **Step 7: Remove the `clear_forward_call_relationships` delete.**

In `clear_forward_call_relationships` (~lines 3331-3332), delete the comment + line:

```typescript
        // Delete the forward_caller_to_callees entry
        this.reverse_deps.forward_caller_to_callees.delete(caller_uri);

```

- [ ] **Step 8: Verify no references remain in production code.**

Run: `grep -rn "forward_caller_to_callees" src/`
Expected: no output (zero matches).

- [ ] **Step 9: Run the regression test and verify it now PASSES.**

Run: `bun test tests/unit/scope-resolver/forward-call-relationships.test.ts -t "issue #217"`
Expected: PASS — `reverse_deps` no longer contains the field, so nothing references `b`.

- [ ] **Step 10: Commit.**

```bash
git add src/types/index.ts src/scope-resolver/index.ts
git commit -m "fix: remove redundant forward_caller_to_callees index (#217)

The map duplicated caller_to_callees, was never read for any
decision, and the live-edit path never maintained it, so it
leaked stale callees. Removing it eliminates the drift class."
```

---

### Task 3: Migrate existing tests off the deleted map

The unit and property tests assert on `forward_caller_to_callees`; migrate each to the authoritative `caller_to_callees`. Because `reverse_deps` is accessed via `(resolver as any)`, `.forward_caller_to_callees` would silently be `undefined` at runtime (failing tests), so these must be updated.

**Files:**
- Modify: `tests/unit/scope-resolver/forward-call-relationships.test.ts`
- Modify: `tests/property/forward-call-relationships.prop.test.ts`

**Interfaces:**
- Consumes: `reverse_deps.caller_to_callees` (`Map<caller, Map<callee, CallEdge[]>>`) — `.get(caller)?.has(callee)` checks a callee key; `.get(caller)?.size` counts callees; `.has(caller)` checks the caller.
- Produces: nothing.

- [ ] **Step 1: Migrate the unit-test assertions.**

In `tests/unit/scope-resolver/forward-call-relationships.test.ts`, replace each `forward_caller_to_callees` occurrence with `caller_to_callees`:

Line ~71:
```typescript
            expect(reverse_deps.caller_to_callees.get(caller_uri)?.has(callee_uri)).toBe(true);
```

Line ~101:
```typescript
            expect(reverse_deps.caller_to_callees.get(caller_uri)?.size).toBe(2);
```

Line ~118:
```typescript
            expect(reverse_deps.caller_to_callees.has(caller_uri)).toBe(false);
```

Line ~154 (test title) — rename to reflect the authoritative map:
```typescript
        it('should update both callee_to_callers and caller_to_callees', () => {
```

Line ~171:
```typescript
            expect(reverse_deps.caller_to_callees.get(caller_uri)?.has(callee_uri)).toBe(true);
```

Line ~207:
```typescript
            expect(reverse_deps.caller_to_callees.has(caller_uri)).toBe(false);
```

- [ ] **Step 2: Migrate the property-test assertions.**

In `tests/property/forward-call-relationships.prop.test.ts`:

Lines ~125-126 (comment + lookup):
```typescript
                    // Check caller registered in caller_to_callees with all callees
                    const caller_callees = reverse_deps.caller_to_callees.get(caller_uri);
```

Lines ~169-170 (comment + assertion):
```typescript
                    // Check caller_to_callees entry is removed
                    expect(reverse_deps.caller_to_callees.has(caller_uri)).toBe(false);
```

Line ~299:
```typescript
                    const caller_callees = reverse_deps.caller_to_callees.get(caller_uri);
```

Note: at lines ~134/~306 the test calls `caller_callees?.size` and `caller_callees?.has(...)`. Both work unchanged on a `Map<callee, CallEdge[]>` (`.size` = callee count; `.has(callee)` checks keys).

- [ ] **Step 3: Verify no references remain anywhere.**

Run: `grep -rn "forward_caller_to_callees" src/ tests/`
Expected: no output.

- [ ] **Step 4: Run both migrated test files.**

Run: `bun test tests/unit/scope-resolver/forward-call-relationships.test.ts tests/property/forward-call-relationships.prop.test.ts`
Expected: PASS (all tests, including the new #217 regression test).

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/scope-resolver/forward-call-relationships.test.ts tests/property/forward-call-relationships.prop.test.ts
git commit -m "test: migrate forward-call tests to caller_to_callees (#217)

The redundant forward_caller_to_callees map is gone; assert against
the authoritative caller_to_callees, whose keys are the callees."
```

---

### Task 4: Full gate + cleanup

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite + typecheck.**

Run: `bun run test`
Expected: PASS (typecheck clean, full suite green, ~6171 tests).

- [ ] **Step 2: Run eslint.**

Run: `bun run lint`
Expected: clean (no new warnings in `src/scope-resolver/index.ts`, `src/types/index.ts`, or the test files).

- [ ] **Step 3: Final reference sweep across the whole repo.**

Run: `grep -rn "forward_caller_to_callees" --include="*.ts" .`
Expected: no output. (The gitignored `client/server/server.js` bundle is regenerated by the build and is not tracked — ignore it.)

- [ ] **Step 4: If any gate failed, fix and re-run before proceeding to review.**

---

## Self-Review

- **Spec coverage:** All 7 production-code removals (Changes §1-7) → Task 2 Steps 1-7. Test migration (spec §Tests) → Task 3. Regression test (spec §Regression test) → Task 1. Verification (spec §Verification) → Task 4. Out-of-scope items (preserve flag, CLAUDE.md) deliberately untouched.
- **Placeholder scan:** No TBD/TODO; every code step shows exact code or exact command + expected output.
- **Type consistency:** `caller_to_callees` is `Map<caller, Map<callee, CallEdge[]>>` throughout; `.has`/`.size`/`.get(...).has` usages match. `value_references_uri` signature is consistent between definition and call.
