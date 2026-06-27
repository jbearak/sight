# Centralize Path Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the analyzer's and directive parser's parallel
`existsSync`-based path resolvers into the shared case-aware
`resolve_path_rich` / `resolve_forward_call_rich` chokepoint, delete dead
helpers, and make the indexer stamp inherited working directories so
dependency-graph callee keys match the open-document path (#220 + #218).

**Architecture:** Forward calls stop carrying a producer-resolved `path`;
every consumer already re-resolves from `raw_path` + caller dir +
`working_directory` via `resolve_forward_call_rich`. Backward directives keep
`Directive.path` (consumers key parents by it) but the one case-handling
bypass (`discover_working_directory`) is routed through the existing
case-aware `compute_directive_real_path`. The indexer gains an inline,
non-re-entrant inherited-WD walk.

**Tech Stack:** TypeScript (ESM), Bun test runner, `vscode-uri`,
`vscode-languageserver` types.

## Global Constraints

- Stata is fully case-sensitive; use exact-case comparison for keywords and
  commands (never `toLowerCase()` for matching). Case-insensitive resolution
  is filesystem-level only and lives in `resolve_path_rich`.
- Package manager / runtime: **Bun**. `bun run test` = typecheck + full suite
  (the CI gate). `bun run lint` = eslint, **NOT in CI — run manually**.
- Comments ≤72 chars, code ≤80 chars. snake_case for new locals/functions;
  prefix loop/scoped vars with `my_`, iteration collections with `the_`;
  single letters `i`/`j`/`k` allowed.
- No `any`; use discriminated-union narrowing for `PathCaseOutcome`.
- End commit messages with:
  `Claude-Session: https://claude.ai/code/session_01QTiSfVjJzbn7u52aijpqJr`
- Spec: `docs/superpowers/specs/2026-06-26-centralize-path-resolution-design.md`

---

### Task 1: Delete dead path-resolution helpers

Two exported/private helpers have zero references (confirmed via grep).
Removing them is isolated and de-risks later tasks.

**Files:**
- Modify: `src/utils/file-path-utils.ts:64-86` (remove
  `resolvePathWithDoFallback`)
- Modify: `src/analyzer/index.ts:1277-1294` (remove the `@deprecated` private
  `resolve_path_with_fallback`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (pure deletion).

- [ ] **Step 1: Confirm zero references**

Run:
```bash
grep -rn "resolvePathWithDoFallback" src/ client/src/ tests/
grep -rn "resolve_path_with_fallback" src/analyzer/
```
Expected: `resolvePathWithDoFallback` appears only at its definition
(`src/utils/file-path-utils.ts:68`). In `src/analyzer/`,
`resolve_path_with_fallback` appears only at its definition (~:1281). (The
directive-parser method of the same name is unrelated and stays.)

- [ ] **Step 2: Delete `resolvePathWithDoFallback`**

Remove the whole block at `src/utils/file-path-utils.ts:64-86` (the doc
comment + the `export function resolvePathWithDoFallback(...) { ... }`).

- [ ] **Step 3: Delete the analyzer's deprecated helper**

Remove `src/analyzer/index.ts:1277-1294` — the doc comment and the
`private resolve_path_with_fallback(raw_path, containing_dir) { ... }` method.

- [ ] **Step 4: Verify typecheck + tests**

Run: `bun run test`
Expected: PASS (no references existed, so nothing breaks).

- [ ] **Step 5: Commit**

```bash
git add src/utils/file-path-utils.ts src/analyzer/index.ts
git commit -m "refactor: delete dead path-resolution helpers (#220)

Claude-Session: https://claude.ai/code/session_01QTiSfVjJzbn7u52aijpqJr"
```

---

### Task 2: Migrate forward-call consumers off `ForwardCall.path`

Stop every consumer from reading the producer-resolved `path`, while the field
still exists, so each step compiles and the existing suite stays green. Both
the dep-graph and scope-resolver "roots-empty" branches collapse into a single
`resolve_forward_call_rich` call (with possibly-empty `workspace_roots`).

**Files:**
- Modify: `src/dependency-graph/index.ts:99-136`
- Modify: `src/scope-resolver/index.ts:2618-2658` (`resolve_callee_uri`)
- Modify: `src/scope-resolver/index.ts:2759`, `:3201` (gates)
- Modify: `src/forward-scope-resolver/index.ts:270`, `:297`, `:812` (gate +
  basename)
- Modify: `src/server-factory.ts:1008`, `:1012` (gate + debug log)

**Interfaces:**
- Consumes: `resolve_forward_call_rich(raw_path, caller_dir,
  working_directory, { workspace_roots?, fs? }): PathCaseOutcome` from
  `src/utils/file-path-utils.ts`. `PathCaseOutcome` is a discriminated union;
  `path` exists only on `exact`/`case_only`, `requested` only on
  `ambiguous`/`missing`.
- Produces: no new exports. Behavior unchanged for the roots-set path.

- [ ] **Step 1: Unify `DependencyGraph.update_caller` resolution**

In `src/dependency-graph/index.ts`, replace the gate and the
`if (this.workspace_roots.length > 0) { ... } else { ... }` block
(`:99-136`) with a single resolution that no longer reads `my_call.path`:

```ts
for (const my_call of forward_calls) {
    if (!my_call.is_static) continue;

    // Single shared resolution. Empty workspace_roots → plain-existence
    // semantics (no case handling), matching the old early-startup path.
    const my_outcome = resolve_forward_call_rich(
        my_call.raw_path,
        my_caller_dir,
        my_call.working_directory,
        {
            workspace_roots: this.workspace_roots,
            fs: this.resolve_fs,
        },
    );
    const my_callee_fs_path =
        my_outcome.kind === 'exact' || my_outcome.kind === 'case_only'
            ? my_outcome.path
            : my_outcome.requested;
    const callee_uri = this.path_to_uri(my_callee_fs_path);

    if (!my_new_callees.has(callee_uri)) {
        my_new_callees.set(callee_uri, {
            caller_uri: my_caller_uri,
            call_type: my_call.type,
            call_site_line: my_call.call_site_line,
        });
    }
}
```

- [ ] **Step 2: Unify `ScopeResolver.resolve_callee_uri`**

In `src/scope-resolver/index.ts:2618-2658`, compute `caller_dir`
unconditionally and always call `resolve_forward_call_rich` (drop the
`my_call.path` fallback branch):

```ts
private resolve_callee_uri(
    my_call: ForwardCall,
    caller_uri_override?: string,
): string {
    const my_effective_caller_uri =
        caller_uri_override ?? my_call.caller_uri;
    const my_caller_dir = my_effective_caller_uri
        ? path.dirname(URI.parse(my_effective_caller_uri).fsPath)
        : path.dirname(URI.parse(my_call.caller_uri ?? '').fsPath);
    const my_outcome = resolve_forward_call_rich(
        my_call.raw_path,
        my_caller_dir,
        my_call.working_directory,
        {
            workspace_roots: this.workspace_roots,
            fs: this.resolve_fs,
        },
    );
    if (my_outcome.kind === 'exact' || my_outcome.kind === 'case_only') {
        return URI.file(my_outcome.path).toString();
    }
    return URI.file(my_outcome.requested).toString();
}
```

Note: the old code derived a fallback caller dir from `my_call.path` when
`caller_uri` was absent. `caller_uri` is now stamped by every producer
(analyzer sets it; document-store/indexer/scope-resolver mappers set it), so
the `?? ''` guard above is a defensive no-op; if `caller_uri` is genuinely
empty the result degrades to a relative resolution exactly as an empty path
would have. Update the method doc comment to drop the "fall back to
path.dirname(my_call.path)" sentences.

- [ ] **Step 3: Fix the remaining gates**

Replace `c.is_static && c.path` with `c.is_static` at:
- `src/scope-resolver/index.ts:2759` (`.filter(c => c.is_static && c.path)`)
- `src/scope-resolver/index.ts:3201` (`if (!my_call.is_static || !my_call.path)`
  → `if (!my_call.is_static)`)
- `src/forward-scope-resolver/index.ts:270`
  (`.filter(call => call.is_static && call.path)` → `.filter(call => call.is_static)`)
- `src/forward-scope-resolver/index.ts:812`
  (`if (!my_call.is_static || !my_call.path) continue;` →
  `if (!my_call.is_static) continue;`)
- `src/server-factory.ts:1008`
  (`.filter(c => c.is_static && c.path)` → `.filter(c => c.is_static)`)

- [ ] **Step 4: Fix the diagnostic basename and debug log**

- `src/forward-scope-resolver/index.ts:297`:
  `source_file: path.basename(my_call.path)` →
  `source_file: path.basename(my_call.raw_path)`
- `src/server-factory.ts:1012`: the debug log line currently interpolates
  `${my_call.path}` → change to `${my_call.raw_path}`.

- [ ] **Step 5: Verify typecheck + full suite**

Run: `bun run test`
Expected: PASS. The field still exists (producers still set it), but nothing
reads it now. If any forward-scope/dep-graph/scope-resolver test asserts on a
basename that was previously `.do`-suffixed via the depth-exceeded diagnostic,
update that assertion to the `raw_path` basename (document the change).

- [ ] **Step 6: Commit**

```bash
git add src/dependency-graph/index.ts src/scope-resolver/index.ts \
        src/forward-scope-resolver/index.ts src/server-factory.ts
git commit -m "refactor: resolve forward-call callees from raw_path, not ForwardCall.path (#220)

Claude-Session: https://claude.ai/code/session_01QTiSfVjJzbn7u52aijpqJr"
```

---

### Task 3: Remove `path` from `ForwardCall` / `ForwardCallDirective` + delete analyzer resolver

Now that no consumer reads it, drop the field, stop all producers/mappers from
computing it, and delete the analyzer's 3-tier resolver (the #216 churn root).

**Files:**
- Modify: `src/types/index.ts:859-873` (`ForwardCall`), `:850-857`
  (`ForwardCallDirective`)
- Modify: `src/analyzer/index.ts:1179-1201` (`detect_forward_call`),
  delete `resolve_forward_call_path` (~:1204-1254) and `resolve_with_do_fallback`
  (~:1256-1275); drop `workspace_root` from the analyzer config type + its read
- Modify: `src/directive-parser/index.ts:341,375-382`
  (`parse_forward_call_directives`)
- Modify the three `ForwardCallDirective` → `ForwardCall` mappers:
  `src/document-store.ts:795-805`, `src/scope-resolver/index.ts:1967-1977`,
  `src/indexer/index.ts:571-581`
- Modify: `src/indexer/index.ts:511-520` (drop `{ workspace_root }` arg to
  `analyze` if `workspace_root` is removed from the analyzer config)
- Test sweep: any test under `tests/` constructing a `ForwardCall` /
  `ForwardCallDirective` literal with `path:` (~56 sites, ~25 files)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ForwardCall` and `ForwardCallDirective` with **no** `path` field.
  `ForwardCall` retains `type`, `raw_path`, `call_site_line`, `range`,
  `source`, `is_static`, `caller_uri?`, `working_directory?`.
  `ForwardCallDirective` retains `type`, `raw_path`, `call_site_line`,
  `call_site?`, `range`.

- [ ] **Step 1: Remove the field from the types**

In `src/types/index.ts`, delete the `path: string;` line from `ForwardCall`
(:861) and from `ForwardCallDirective` (:852). Keep the surrounding comments
accurate (drop the "Resolved absolute path" references).

- [ ] **Step 2: Run typecheck to enumerate the producers/readers**

Run: `bun run typecheck`
Expected: FAIL with a list of `path` errors — exactly the producer/mapper
sites and any stray reader. Use this list to drive Steps 3-6.

- [ ] **Step 3: Stop the analyzer computing `path` and delete its resolver**

In `src/analyzer/index.ts` `detect_forward_call` (~:1179-1201): delete the
`let resolved_path = ''` block and the `if (!has_macro) { ... resolve_forward_call_path(...) }`
call. In the `this.forward_calls.push({ ... })`, remove `path: resolved_path,`.
Keep `raw_path`, `is_static: !has_macro`, `caller_uri: this.uri`,
`working_directory: this.config.working_directory`.

Delete the methods `resolve_forward_call_path` (~:1204-1254) and
`resolve_with_do_fallback` (~:1256-1275).

Remove the now-unused `workspace_root` field from the analyzer's config type
(`src/analyzer/index.ts:77`) and any remaining read. If `fs`/`path` imports
become unused, remove them (typecheck/lint will flag).

- [ ] **Step 4: Stop the directive parser computing forward-call `path`**

In `src/directive-parser/index.ts` `parse_forward_call_directives`: delete the
`const my_resolved_path = this.resolve_path_with_fallback(my_raw_path, containing_dir);`
line (:341) and remove `path: my_resolved_path,` from the
`the_forward_calls.push({ ... })` object (:375-382).

- [ ] **Step 5: Drop `path` from the three mappers**

Remove the `path: d.path,` line from each `ForwardCallDirective` → `ForwardCall`
map object:
- `src/document-store.ts:797`
- `src/scope-resolver/index.ts:1969`
- `src/indexer/index.ts:573`

Also remove the stamped analyzer-call mapping's reliance on `path` if present
(it spreads `...fc`, so no change needed there beyond the type).

- [ ] **Step 6: Fix the indexer analyze call if `workspace_root` was removed**

If Step 3 removed `workspace_root` from the analyzer config, update
`src/indexer/index.ts:515-520` to drop the `{ workspace_root }` 4th argument
(pass `undefined` or omit per the analyze signature). Keep the
`get_workspace_root_for_path` call only if `workspace_root` is still used
elsewhere in the loop (it is not, after this change — remove the dead local).

- [ ] **Step 7: Sweep the test literals**

Run: `bun run typecheck`
Expected: FAIL listing test files with `path:` in `ForwardCall` /
`ForwardCallDirective` literals and any `.path` assertion on a forward call.
For each: delete the `path:` property from the literal; for assertions that
checked a resolved forward-call path, either delete them or re-express against
`raw_path` (the literal no longer carries a resolved path). Example
transformation:

```ts
// before
const my_call: ForwardCall = {
    type: 'do', path: '/ws/child.do', raw_path: 'child.do',
    call_site_line: 0, range: R, source: 'command', is_static: true,
};
// after
const my_call: ForwardCall = {
    type: 'do', raw_path: 'child.do',
    call_site_line: 0, range: R, source: 'command', is_static: true,
};
```

- [ ] **Step 8: Verify typecheck + full suite + lint**

Run: `bun run test && bun run lint`
Expected: PASS. Investigate any test that fails on a *behavioral* (not
type-literal) basis — that signals a real consumer still depended on the
field. Grep to confirm zero `\.path` reads remain on forward calls:
```bash
grep -rn "\.path" src/dependency-graph src/forward-scope-resolver \
  src/scope-resolver/index.ts src/analyzer/index.ts | grep -i "call\|forward"
```
Expected: no forward-call `.path` reads.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: drop resolved path field from ForwardCall(Directive) (#220)

Remove the analyzer's case-unaware 3-tier resolver; all forward-call
consumers now resolve from raw_path + caller dir + working_directory
via resolve_forward_call_rich.

Claude-Session: https://claude.ai/code/session_01QTiSfVjJzbn7u52aijpqJr"
```

---

### Task 4: Route `discover_working_directory` through the case-aware resolver

The inherited-WD parent lookup currently keys the parent by the case-unaware
`Directive.path` and does a manual `.do` fallback, bypassing the case handling
the main `follow_directives` path gets via `compute_directive_real_path`. Fix
the bypass.

**Files:**
- Modify: `src/scope-resolver/index.ts:1315-1369`
  (`discover_working_directory`)
- Test: `tests/integration/` or `tests/unit/scope-resolver/` — add a focused
  case-only-inherited-WD test (place beside existing scope-resolver WD tests;
  find the file with `grep -rln "discover_working_directory\|inherited_working_directory" tests/`)

**Interfaces:**
- Consumes: `this.compute_directive_real_path(directive, child_uri):
  { real_path: string; outcome_kind: 'exact'|'case_only'|'ambiguous'|'missing'; ... }`
  (existing private method, `src/scope-resolver/index.ts:650`).
- Produces: no signature change; `discover_working_directory` now resolves
  parents case-awarely.

- [ ] **Step 1: Write the failing test**

Add a test that a child whose `@lsp-done-by` references a parent with
mismatched case (e.g. directive says `"Parent.do"`, on disk it is `parent.do`)
still inherits the parent's `@lsp-cd` working directory. Use the existing
scope-resolver test harness with an injected `resolve_fs` (mirror the setup in
the nearest existing `compute_directive_real_path` / case-mismatch test). Assert
the resolved scope's `inherited_working_directory` equals the parent's WD.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test <the new test file> -t "<test name>"`
Expected: FAIL — today `discover_working_directory` keys the parent by the
as-typed `Directive.path` (`Parent.do`), the file read misses on a
case-sensitive FS (or picks arbitrarily on a case-insensitive one), so no WD
is inherited.

- [ ] **Step 3: Resolve the parent through `compute_directive_real_path`**

In `discover_working_directory` (`:1315`), replace:

```ts
const my_parent_uri = URI.file(my_directive.path).toString();
```

with a case-aware resolution and an `ambiguous` skip:

```ts
const my_rich = this.compute_directive_real_path(
    my_directive, current_uri,
);
if (my_rich.outcome_kind === 'ambiguous') {
    continue;
}
const my_parent_uri = URI.file(my_rich.real_path).toString();
```

`current_uri` must be in scope here. `discover_working_directory` is called
with `directives` and a `visited` set; thread the current file URI into the
method (it is already available at every call site — `follow_directives` passes
`[my_directive]` and knows `current_uri`; the recursive call at :1404 passes
the parent URI as the new current). Add a `current_uri: string` parameter to
`discover_working_directory` and pass it at both call sites (`:1404` recursion
uses `my_parent_uri`; the top-level call at `:1523` uses `current_uri`).

Then delete the now-redundant manual `.do` fallback block (`:1346-1364`): the
single `get_parsed_file(my_parent_uri, my_rich.real_path, ...)` read replaces
it, because `compute_directive_real_path` already applied `try_do_fallback`.
Keep the `'error' in my_parent_result` warning path for genuine read failures.

- [ ] **Step 4: Run the new test + full suite**

Run: `bun test <the new test file>` then `bun run test`
Expected: PASS. The case-mismatched inherited WD now resolves; existing
discover/inherited-WD tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/scope-resolver/index.ts tests/
git commit -m "fix: case-aware parent resolution in discover_working_directory (#220)

Claude-Session: https://claude.ai/code/session_01QTiSfVjJzbn7u52aijpqJr"
```

---

### Task 5: Indexer stamps inherited working directory (#218)

Add a non-re-entrant inherited-WD walk and call it inline during indexing so a
WD-dependent file gets the same `working_directory` (and thus the same callee
key) whether it was indexed or opened.

**Files:**
- Modify: `src/scope-resolver/index.ts` — add public
  `resolve_inherited_working_directory(...)` wrapping `discover_working_directory`
- Modify: `src/indexer/index.ts:67-119` (add a `scope_resolver?` field +
  `set_scope_resolver`), `:522-544` (effective-WD computation in the per-file
  path)
- Modify: `src/server-factory.ts:1195-1244` (wire
  `workspace_indexer.set_scope_resolver(scope_resolver)`)
- Test: `tests/integration/` — indexed-but-not-open WD-dependent child has the
  same dep-graph callee key as the open-document path

**Interfaces:**
- Produces (ScopeResolver):
  ```ts
  async resolve_inherited_working_directory(
      backward_directives: Directive[],
      current_uri: string,
      config: ScopeResolverConfig,
  ): Promise<string | undefined>
  ```
  Returns the inherited WD (own-directive WD is the caller's concern), or
  `undefined`. Internally creates a fresh `visited` set + `request_cache` and
  calls the existing `discover_working_directory`.
- Produces (WorkspaceIndexer): `set_scope_resolver(resolver: ScopeResolver):
  void`. The inline walk is a no-op when no resolver is set (cli/check.ts path
  stays best-effort own-WD-only).
- Consumes: `resolve_working_directory_directive` (existing, own-WD) and
  `get_effective_backward_directives` semantics already used by the resolver.

- [ ] **Step 1: Write the failing integration test**

Create a workspace fixture (temp dir or injected fs per the existing indexer
integration-test pattern — `grep -rln "WorkspaceIndexer" tests/integration`):
- `parent.do` with `// @lsp-cd: "data"` and `do child.do`
- `child.do` with `// @lsp-done-by: "parent.do"` and `do sub.do`
- `data/sub.do` exists (so `child.do`'s `do sub.do` only resolves under the
  inherited WD `data/`).

Index the workspace (without opening `child.do`). Assert that the dependency
graph records an edge `child.do → data/sub.do` (the inherited-WD key), i.e.
`dependency_graph.get_callees(child_uri)` contains the `data/sub.do` URI —
matching what DocumentStore produces when `child.do` is opened.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test <the new test file> -t "<test name>"`
Expected: FAIL — the indexer stamps `working_directory: undefined` for
`child.do` (no own WD directive), so `do sub.do` resolves script-relative to
`child.do`'s dir, missing `data/sub.do`.

- [ ] **Step 3: Add `resolve_inherited_working_directory` to ScopeResolver**

In `src/scope-resolver/index.ts`, add a public method that reuses the walk:

```ts
/**
 * Resolve the working directory a file INHERITS from its backward
 * directive parents (own-directive WD is the caller's responsibility).
 * Non-re-entrant w.r.t. the indexer: reads parents via the resolver's
 * own file_cache / disk, never the indexer's symbol_index.
 */
async resolve_inherited_working_directory(
    backward_directives: Directive[],
    current_uri: string,
    config: ScopeResolverConfig,
): Promise<string | undefined> {
    if (backward_directives.length === 0) return undefined;
    const my_visited = new Set<string>();
    const my_request_cache = this.create_request_cache();
    return this.discover_working_directory(
        backward_directives,
        my_visited,
        0,
        config,
        my_request_cache,
        current_uri,
    );
}
```

Use the actual request-cache constructor the resolver uses internally (grep
`request_cache` / `RequestCache` in the file for the existing factory; if it is
built inline elsewhere, mirror that). The `current_uri` arg matches the new
parameter added in Task 4.

- [ ] **Step 4: Add the indexer field + setter**

In `src/indexer/index.ts`, add beside `dependency_graph?` (:98):
```ts
private scope_resolver?: ScopeResolver;
```
and a setter beside `set_dependency_graph` (:123):
```ts
/**
 * Provide a ScopeResolver so indexing can resolve inherited working
 * directories (#218). Optional: when unset, indexing stamps own-WD only.
 */
set_scope_resolver(resolver: ScopeResolver): void {
    this.scope_resolver = resolver;
}
```
Import `ScopeResolver` (already imported at :34) and `ScopeResolverConfig` /
`build_scope_resolver_config` (already imported at :34) as needed.

- [ ] **Step 5: Compute effective WD inline before stamping**

In `index_file`'s per-file body, replace the own-WD-only computation
(`src/indexer/index.ts:538-544`) with own ?? inherited:

```ts
const own_working_directory: string | undefined =
    directive_result.working_directory
        ? resolve_working_directory_directive(
              directive_result.working_directory,
              workspace_root,
          )
        : undefined;

let effective_working_directory = own_working_directory;
if (own_working_directory === undefined && this.scope_resolver) {
    const the_backward_directives = directive_result.directives.filter(
        d => d.type === 'done-by' || d.type === 'included-by',
    );
    if (the_backward_directives.length > 0) {
        const my_config = build_scope_resolver_config(undefined);
        effective_working_directory =
            await this.scope_resolver
                .resolve_inherited_working_directory(
                    the_backward_directives,
                    file_uri,
                    my_config,
                );
    }
}
```

The rest of the per-file path (`stamped_analyzer_calls`,
`directive_forward_calls`, `dependency_graph.update_caller`) already uses
`effective_working_directory`, so no further change is needed there.

- [ ] **Step 6: Wire the resolver in server-factory**

In `src/server-factory.ts`, after both `workspace_indexer` (:1195) and
`scope_resolver` (:1196) are constructed, add:
```ts
workspace_indexer.set_scope_resolver(scope_resolver);
```
Do NOT wire it in `cli/check.ts` — that path intentionally stays best-effort
(the walk no-ops without a resolver).

- [ ] **Step 7: Run the new test + full suite**

Run: `bun test <the new test file>` then `bun run test`
Expected: PASS. The indexed `child.do` now carries the inherited `data/` WD,
so its `do sub.do` edge keys to `data/sub.do`, matching the open path.

- [ ] **Step 8: Re-entrancy guard test**

Add (or extend the Step 1 test with) an assertion that indexing the fixture
completes without unbounded recursion / timeout — e.g. wrap the index call in
the suite's normal await and assert it resolves. If the implementation ever
re-enters `index_file`, this surfaces as a hang/stack overflow. If a hidden
coupling is found, fall back to spec §3.3 option (c): revert Steps 3-6, keep
own-WD-only, and document the indexer edge as best-effort.

- [ ] **Step 9: Lint + commit**

Run: `bun run lint`
```bash
git add src/scope-resolver/index.ts src/indexer/index.ts \
        src/server-factory.ts tests/
git commit -m "fix: indexer resolves inherited working directory (#218)

Inline, non-re-entrant inherited-WD walk so indexed and open-document
dependency-graph callee keys agree for WD-dependent files.

Claude-Session: https://claude.ai/code/session_01QTiSfVjJzbn7u52aijpqJr"
```

---

## Self-Review

**Spec coverage:**
- §3.1 forward-call field drop + analyzer resolver deletion + consumer
  migration → Tasks 2 (consumers) + 3 (field/producers/resolver).
- §3.1 three mappers (document-store, scope-resolver, indexer) → Task 3 Step 5.
- §3.1 gates, roots-empty fallback (kind-narrowed), basename, debug log →
  Task 2 Steps 1-4.
- §3.2 keep `Directive.path` / `resolve_path_with_fallback` as-is → no task
  touches them (intentional; called out here so a reviewer doesn't "fix" it).
- §3.2 migrate `discover_working_directory` case bypass → Task 4.
- §3.3 inline inherited-WD walk → Task 5.
- Dead helpers (`resolvePathWithDoFallback`, analyzer deprecated
  `resolve_path_with_fallback`) → Task 1.

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above".
New-behavior tasks (4, 5) carry concrete test descriptions; the test-literal
sweep (Task 3 Step 7) shows the exact transformation and is driven by
typecheck output rather than an enumerated 56-site list (mechanical, complete
via the compiler).

**Type consistency:** `resolve_inherited_working_directory` (Task 5) calls
`discover_working_directory` with the `current_uri` parameter added in Task 4 —
Task 5 depends on Task 4 (correct order). `PathCaseOutcome` narrowing is used
identically in Task 2 Steps 1-2. `set_scope_resolver` / `scope_resolver?`
names are consistent between Task 5 Steps 4 and 6.

**Ordering:** 1 (dead code) → 2 (readers off field) → 3 (drop field) → 4
(current_uri param + case fix) → 5 (reuses Task 4's param). Each task leaves
`bun run test` green.
