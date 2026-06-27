# Design: Eliminate the redundant `forward_caller_to_callees` reverse index (#217)

**Date:** 2026-06-27
**Issue:** [#217](https://github.com/jbearak/sight/issues/217)
**Status:** Proposed

## Problem

`ScopeResolver` maintains three reverse-dependency maps inside
`reverse_deps` (`ReverseDependencyIndex`, `src/types/index.ts:795`):

| Map | Shape | Authoritative? |
|---|---|---|
| `caller_to_callees` | `Map<caller, Map<callee, CallEdge[]>>` | yes |
| `callee_to_callers` | `Map<callee, Set<caller>>` | yes |
| `forward_caller_to_callees` | `Map<caller, Set<callee>>` | **no — redundant** |

`forward_caller_to_callees` is a strict subset of the information in
`caller_to_callees`: for any caller, its callee set is exactly
`caller_to_callees.get(caller)?.keys()`.

Two code paths mutate the reverse-dep maps:

- **Parse/cache path** —
  `register_forward_call_relationships_from_cache`
  (`src/scope-resolver/index.ts:3227`, called from `:2249`) updates all
  three maps, including `forward_caller_to_callees`
  (`:3289`–`:3291`).
- **Live-edit path** — `update_reverse_dependencies` (`:2788`, called on
  every `didChange` via `src/server-factory.ts:1026`) updates
  `caller_to_callees` and `callee_to_callers` but **never** touches
  `forward_caller_to_callees`.

So on every live edit, `forward_caller_to_callees` drifts out of sync
with the authoritative maps.

### Concrete bug (the leak)

1. `caller.do` contains `do a` and `do b`; both registered via the cache
   path → `forward_caller_to_callees[caller] = {a, b}`.
2. User deletes the `do b` line. `didChange` →
   `update_reverse_dependencies` removes `b` from `caller_to_callees`
   and `callee_to_callers`, but leaves `forward_caller_to_callees[caller]
   = {a, b}` (stale `b`).
3. User later deletes `b.do`. `remove_uri_from_reverse_deps(b)` walks
   `callee_to_callers[b]` to find callers to clean — but that link is
   already gone, so `caller` is never visited and the phantom `b` in
   `forward_caller_to_callees[caller]` is never removed.

The stale entry is never cleaned → the map grows monotonically over a
long editing session. Adding a callee via live edit undercounts
(harmless). Impact is **low / non-correctness**: the map is never read
for diagnostics, invalidation, or scope resolution — only for its own
cleanup. It is a slow memory-hygiene leak, pre-existing on `main`.

## Where the map is touched (full sweep at `36dfedb`)

Verified repo-wide via `grep -rn "forward_caller_to_callees"`. Every
site is in `src/scope-resolver/index.ts` (plus the type decl and tests):

| Site | Kind | Line |
|---|---|---|
| `ReverseDependencyIndex` field decl | type | `src/types/index.ts:805` |
| `reverse_deps` initializer | init | `:205` |
| `reset_reverse_deps` (bulk clear) | clear | `:2926` |
| `remove_caller_from_reverse_deps` (per-caller delete) | clear | `:2955` |
| `remove_uri_from_reverse_deps` (the ONLY functional read) | read+delete | `:2984` |
| `register_forward_call_relationships_from_cache` (build + set) | write | `:3235`, `:3275`–`:3276`, `:3289`–`:3291` |
| `clear_forward_call_relationships` (per-caller delete) | clear | `:3332` |

Crucially:

- The sole functional **read** (`:2984`, inside
  `remove_uri_from_reverse_deps`) is dead weight. The block deletes the
  removed callee from `forward_caller_to_callees[caller]` — mirroring the
  immediately preceding deletion from `caller_to_callees[caller]`
  (`:2976`–`:2982`). Nothing downstream consumes the result; it only
  keeps the redundant map internally consistent.
- The "O(M) cleanup" rationale in the field's doc comment is already
  bogus. `clear_forward_call_relationships` (`:3313`) does its O(M)
  per-callee work by iterating `caller_to_callees.get(caller).keys()`,
  then deletes the `forward_caller_to_callees` entry with a plain O(1)
  `Map.delete`. `caller_to_callees` already provides O(M) per-caller
  access; the dedicated index buys nothing.
- `get_reverse_deps_debug_info` (`:3345`) prints `callee_to_callers` and
  `caller_to_callees` only — it never references the redundant map.

## Decision: Option B — eliminate the map

The issue offers two candidate fixes:

- **(A) Maintain it consistently** — mirror the
  `caller_to_callees` add/remove logic into `update_reverse_dependencies`
  so all three maps stay in sync. Smallest diff, but keeps redundant
  state and a standing class of "did every mutator update all three?"
  drift bugs.
- **(B) Eliminate it as redundant** — delete the field and derive its one
  functional read from `caller_to_callees`. Removes the redundant state
  and the entire drift class.

**We choose (B).** It is the correct altitude for this codebase's
simplify/DRY ethos: the map is provably redundant with
`caller_to_callees`, is never read for any decision, and its only reader
is self-maintenance. Removing it is purely subtractive and
behavior-preserving for diagnostics, invalidation, and resolution.
Option (A) would preserve a map that has no consumer.

### Why this is safe (behavior-preserving)

- **No decision depends on the map.** The only functional read (`:2984`)
  feeds nothing — it mutates the map and stops. Deleting the map and its
  read changes no observable behavior.
- **Cleanup semantics are reproduced exactly.** The `:2984` block's
  intent (drop the deleted callee from the caller's callee set) is
  already performed on the authoritative `caller_to_callees` at
  `:2976`–`:2982`. After that runs, `caller_to_callees.get(caller)?.keys()`
  is exactly the desired post-cleanup callee set — no separate map
  needed.
- **All clears become unnecessary, not broken.** Each
  `forward_caller_to_callees.clear()/.delete()` sits beside the
  equivalent operation on `caller_to_callees`; removing the redundant
  line leaves the authoritative cleanup intact.

## Changes

### Production code (`src/scope-resolver/index.ts`, `src/types/index.ts`)

1. **Remove the field** from `ReverseDependencyIndex`
   (`src/types/index.ts:805`) and its doc comment.
2. **Remove the initializer** at `:205`.
3. **`reset_reverse_deps`** (`:2926`): delete the `.clear()` line.
4. **`remove_caller_from_reverse_deps`** (`:2954`–`:2955`): delete the
   comment + `.delete(caller_uri)` line.
5. **`remove_uri_from_reverse_deps`** (`:2983`–`:2990`): delete the
   entire `forward_callees` read/delete block. The preceding
   `caller_to_callees` deletion (`:2976`–`:2982`) already performs the
   real cleanup.
6. **`register_forward_call_relationships_from_cache`** (`:3227`): delete
   the `my_callees` Set (`:3235`), its `.add` (`:3275`–`:3276`), and the
   `forward_caller_to_callees.set` block (`:3289`–`:3291`).
7. **`clear_forward_call_relationships`** (`:3331`–`:3332`): delete the
   comment + `.delete(caller_uri)` line.

No other production file references the map (verified by grep). The
`preserve_forward_call_relationships` flag in
`invalidate_file_cache`/`server-factory.ts:1073` is unrelated — it gates
whether `clear_forward_call_relationships` runs at all, governing the
authoritative maps; its behavior and (loosely-worded) comment are
unaffected by removing the redundant index. We leave that flag and its
comment as-is (out of scope).

### Tests

Existing tests assert directly on the removed map and must migrate to the
authoritative `caller_to_callees` (semantically identical: a caller's
callee set is `caller_to_callees.get(caller)?.keys()`):

- `tests/unit/scope-resolver/forward-call-relationships.test.ts`
  (lines 71, 101, 118, 154 (title), 171, 207)
- `tests/property/forward-call-relationships.prop.test.ts`
  (lines 125–126, 169–170, 299)

Migration mapping:

| Old assertion | New assertion |
|---|---|
| `forward_caller_to_callees.get(c)?.has(callee)` | `caller_to_callees.get(c)?.has(callee)` |
| `forward_caller_to_callees.get(c)?.size` | `caller_to_callees.get(c)?.size` |
| `forward_caller_to_callees.has(c)` | `caller_to_callees.has(c)` |

These migrations preserve each test's intent; `caller_to_callees` is the
authoritative source the tests were really validating through the
redundant mirror.

### Regression test (the leak scenario)

Add a deterministic unit test to
`tests/unit/scope-resolver/forward-call-relationships.test.ts` driving
the resolver methods directly (no scan/timing dependence):

1. Register `caller → {a, b}` via
   `register_forward_call_relationships_from_cache`.
2. Simulate the live edit that deletes `do b` by calling
   `update_reverse_dependencies(caller, [call to a only], symbols)`.
3. Assert the authoritative maps are consistent: `caller_to_callees` and
   `callee_to_callers` no longer reference `b`, and `b`'s
   `callee_to_callers` entry is gone.
4. Delete `b.do` via `remove_uri_from_reverse_deps(b)` and assert clean
   teardown leaves no reference to `b` anywhere in `reverse_deps`.

Note on framing: because Option B removes the leaking map, this is a
**post-fix invariant test**, not a test that fails on `main`. The bug on
`main` lived entirely inside the now-deleted map; the meaningful,
enduring guarantee is that the surviving authoritative maps stay
consistent across the live-edit-then-delete sequence. A
"fails-on-`main`" assertion is impossible without asserting on a field we
are deleting, so we assert the invariant the fix establishes instead.

## Out of scope

- The `preserve_forward_call_relationships` flag/comment wording
  (`server-factory.ts:1073`). It refers to the authoritative maps, not
  the redundant index; behavior is correct. Not touched.
- `CLAUDE.md`'s stale "Workspace Config" reference to `.sight.json` (the
  project config is now `sight.toml`). Separate doc fix.

## Verification

- `bun run test` (typecheck + full suite) clean.
- `bun run lint` (eslint, not in CI) clean.
- New comments reflowed to ≤72 chars; code ≤80.
