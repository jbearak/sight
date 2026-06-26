# Case-Only do/run/include Path Mismatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `do`/`run`/`include` and cross-file directive paths that differ from the on-disk filename only by case into the cross-file graph (no undefined-symbol cascade), emitting exactly one `path-case-mismatch` diagnostic at the call/directive site, governed by a new `crossFile.diagnostics.caseMismatch` severity with an `auto` host-keyed mode.

**Architecture:** A shared rich resolver (`resolve_path_rich`) classifies a path as exact / unique-case-only / ambiguous / missing by reading directory listings (the sole source of casing truth) and walking components from the containing workspace root. Every static-path consumer (dependency graph, forward-scope resolver, scope resolver, go-to-definition) routes through it. The diagnostic flows through the existing `DirectiveDiagnostic` channel shared by the LSP and `sight check`.

**Tech Stack:** TypeScript (ESM), Bun test runner, `vscode-languageserver`/`vscode-uri`, Node `fs`/`path`.

**Spec:** `docs/superpowers/specs/2026-06-26-case-only-path-mismatch-design.md` (read it; it has file:line anchors for every touch point).

## Global Constraints

- **Case folding is ASCII-only** (`A–Z`/`a–z`); non-ASCII bytes compare exactly.
- **Casing truth = directory listing.** Never use `existsSync` to classify a component's casing — only to confirm the workspace-root prefix the walk starts from.
- **Walk starts at the containing workspace root**; verify every component below it. Paths outside all workspace roots get no case handling (existing exact/missing, no diagnostic).
- **Single emission:** a forward-call `path_case_mismatch` is published only when the file containing the call is the diagnosed file and the call is at resolution `depth === 0`.
- **Diagnostic is NOT suppressible** by `@lsp-ignore`/`@lsp-ignore-next`; silence only via `caseMismatch = "off"`. Independent of `missingFile` severity.
- **Backward directives** gain case-leniency but never the workspace-root fallback and never read `@lsp-cd` (Raven invariant); their message makes no Stata-execution claim.
- **Only static paths** (no macro interpolation) are resolved/diagnosed.
- Naming: `snake_case` locals with `my_`/`the_` prefixes per CLAUDE.md; 4-space indent; 80-col code / 72-col comments. Stata tokens are case-sensitive elsewhere — this feature is *only* about path spelling vs the filesystem.
- Run `bun run test` (typecheck + `bun test`) before each commit.

---

### Task 1: Rich path resolver core

**Files:**
- Modify: `src/utils/file-path-utils.ts`
- Test: `tests/unit/path-resolve-rich.test.ts` (create)

**Interfaces:**
- Consumes: nothing (leaf utility).
- Produces:
  ```ts
  export type PathCaseOutcome =
    | { kind: 'exact';     path: string }
    | { kind: 'case_only'; path: string; requested: string }
    | { kind: 'ambiguous'; requested: string; matches: string[] }
    | { kind: 'missing';   requested: string };

  export interface RichResolveFs {
    readdirSync(p: string, opts: { withFileTypes: true }):
      Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
    existsSync(p: string): boolean;
  }
  export interface RichResolveOptions {
    try_do_fallback?: boolean;     // default true
    workspace_roots?: string[];
    fs?: RichResolveFs;
  }
  export function resolve_path_rich(
    resolved_fs_path: string,
    options?: RichResolveOptions,
  ): PathCaseOutcome;
  ```

**Algorithm (from spec "Algorithm" + "Workspace-bounded scanning"):**
1. Normalize `resolved_fs_path` (absolute, OS separators).
2. Pick the `workspace_roots` entry that contains it (longest matching prefix; deterministic). If none contains it and `workspace_roots` is non-empty → return plain existence outcome (`exact` if file exists, else `missing`); no enumeration. If `workspace_roots` is empty/undefined → treat the path's filesystem root as the start (test/standalone ergonomics).
3. Confirm the start root exists with `existsSync`. Split the remainder into components.
4. Walk components; at each, `readdirSync(dir, { withFileTypes: true })`:
   - non-final: exact-cased **directory** entry → descend; else ASCII-ci directory matches: 1 → `case_only` (record, descend real-cased); 2+ → `ambiguous`; 0 → `missing`.
   - final: candidate names `{name}` + (`try_do_fallback` && no ext) `{name.do}`; only **file** entries count; exact `name` then exact `name.do` → `exact`; else distinct ci file matches over the candidate set: 1 → `case_only`; 2+ → `ambiguous`; 0 → `missing`. A directory named `name` never beats a unique file `Name.do`.
5. Outcome aggregation: `case_only` if any component needed ci-resolution and all unique and final target found; `exact` if all exact; first `ambiguous`/`missing` wins.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'bun:test';
import { resolve_path_rich } from '../../src/utils/file-path-utils';

// In-memory fs: map of dir -> entries (name + isFile)
function make_fs(tree: Record<string, Array<[string, boolean]>>) {
  const dirs = new Set(Object.keys(tree));
  return {
    existsSync: (p: string) => dirs.has(p) ||
      Object.values(tree).some(es => es.some(([n]) => /* file path */ false)) ||
      Object.keys(tree).some(d => tree[d]?.some(([n]) => `${d}/${n}` === p)),
    readdirSync: (p: string) => (tree[p] ?? []).map(([name, is_file]) => ({
      name, isFile: () => is_file, isDirectory: () => !is_file,
    })),
  };
}

describe('resolve_path_rich', () => {
  const roots = ['/ws'];
  it('exact match', () => {
    const fs = make_fs({ '/ws': [['Clean.do', true]] });
    expect(resolve_path_rich('/ws/Clean.do', { workspace_roots: roots, fs }))
      .toEqual({ kind: 'exact', path: '/ws/Clean.do' });
  });
  it('unique case-only with .do fallback', () => {
    const fs = make_fs({ '/ws': [['Clean.do', true]] });
    const out = resolve_path_rich('/ws/clean', { workspace_roots: roots, fs });
    expect(out.kind).toBe('case_only');
    if (out.kind === 'case_only') expect(out.path).toBe('/ws/Clean.do');
  });
  it('ambiguous (2+ ci matches)', () => {
    const fs = make_fs({ '/ws': [['Clean.do', true], ['CLEAN.do', true]] });
    expect(resolve_path_rich('/ws/clean.do', { workspace_roots: roots, fs }).kind)
      .toBe('ambiguous');
  });
  it('missing', () => {
    const fs = make_fs({ '/ws': [['other.do', true]] });
    expect(resolve_path_rich('/ws/clean.do', { workspace_roots: roots, fs }).kind)
      .toBe('missing');
  });
  it('multi-component directory case-only', () => {
    const fs = make_fs({ '/ws': [['Helpers', false]], '/ws/Helpers': [['clean.do', true]] });
    const out = resolve_path_rich('/ws/helpers/clean.do', { workspace_roots: roots, fs });
    expect(out.kind).toBe('case_only');
    if (out.kind === 'case_only') expect(out.path).toBe('/ws/Helpers/clean.do');
  });
  it('exact-before-case: exact sibling wins', () => {
    const fs = make_fs({ '/ws': [['clean.do', true], ['Clean.do', true]] });
    expect(resolve_path_rich('/ws/clean.do', { workspace_roots: roots, fs }))
      .toEqual({ kind: 'exact', path: '/ws/clean.do' });
  });
  it('ASCII-only: non-ASCII not folded', () => {
    const fs = make_fs({ '/ws': [['café.do', true]] });
    // requested differs by a non-ASCII letter case -> not folded -> missing
    expect(resolve_path_rich('/ws/cafÉ.do', { workspace_roots: roots, fs }).kind)
      .toBe('missing');
  });
  it('directory named like leaf does not beat unique .do file', () => {
    const fs = make_fs({ '/ws': [['clean', false], ['Clean.do', true]] });
    const out = resolve_path_rich('/ws/clean', { workspace_roots: roots, fs });
    expect(out.kind).toBe('case_only');
    if (out.kind === 'case_only') expect(out.path).toBe('/ws/Clean.do');
  });
  it('outside workspace roots: no case handling', () => {
    const fs = make_fs({ '/other': [['Clean.do', true]] });
    expect(resolve_path_rich('/other/clean.do', { workspace_roots: roots, fs }).kind)
      .toBe('missing');
  });
});
```

(Adjust the `make_fs` helper so `existsSync` answers correctly for both directory paths and file paths — the implementer should make it a small, correct in-memory fs.)

- [ ] **Step 2: Run tests, verify they fail** — `bun test tests/unit/path-resolve-rich.test.ts` → FAIL (`resolve_path_rich` not exported).
- [ ] **Step 3: Implement `resolve_path_rich`** in `src/utils/file-path-utils.ts` per the algorithm above. Add a module-private `ascii_ci_equal(a, b)` helper (lowercases only ASCII A–Z). Default `fs` to Node `fs` with `{ withFileTypes: true }`. Keep `resolvePathWithDoFallback` as-is.
- [ ] **Step 4: Run tests, verify pass** — all green; `bun run typecheck` clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(path-resolve): rich case-only path resolver (#205)"`

---

### Task 2: Host filesystem case-sensitivity probe

**Files:**
- Modify: `src/utils/file-path-utils.ts` (or create `src/utils/host-filesystem.ts`)
- Test: `tests/unit/host-case-sensitive.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export function host_is_case_sensitive(
    seed_existing_dir: string,
    fs?: { existsSync(p: string): boolean },
  ): boolean;   // cached per seed dir; fs injection bypasses cache
  ```

**Behavior (spec "Host regime"):** flip the case of the first ASCII letter in `seed_existing_dir`; if the flipped path does NOT `existsSync` → case-sensitive (true). No ASCII letter → assume case-sensitive (true). Cache by seed path when no `fs` injected.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'bun:test';
import { host_is_case_sensitive } from '../../src/utils/file-path-utils';

describe('host_is_case_sensitive', () => {
  it('flipped variant exists -> case-insensitive', () => {
    const fs = { existsSync: (_p: string) => true };
    expect(host_is_case_sensitive('/Workspace/proj', fs)).toBe(false);
  });
  it('flipped variant absent -> case-sensitive', () => {
    const fs = { existsSync: (p: string) => p === '/Workspace/proj' };
    expect(host_is_case_sensitive('/Workspace/proj', fs)).toBe(true);
  });
  it('no ascii letter -> assume case-sensitive', () => {
    const fs = { existsSync: (_p: string) => true };
    expect(host_is_case_sensitive('/123/456', fs)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** with a `Map<string, boolean>` cache keyed by seed path (only used when `fs` is undefined).
- [ ] **Step 4: Run, verify pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(path-resolve): host case-sensitivity probe (#205)"`

---

### Task 3: Config — caseMismatch severity (type, default, schema, validator)

**Files:**
- Modify: `src/types/index.ts` (`CrossFileConfig.diagnostics`), `src/server-handlers.ts` (`DEFAULT_SETTINGS`), `src/config-file/schema.ts`, `src/utils/config-validator.ts`
- Test: `tests/unit/config-validator.test.ts` (extend or create), config-file schema test (find existing schema/parse test and extend)

**Interfaces:**
- Produces: `type CrossFileCaseMismatchSeverity = 'auto' | 'error' | 'warning' | 'information' | 'off'`; `CrossFileConfig.diagnostics.case_mismatch?: CrossFileCaseMismatchSeverity`.

**Details (spec "Configuration"):**
- `src/types/index.ts`: add the type and the optional field. Do NOT widen the existing cross-file severity type.
- `DEFAULT_SETTINGS`: `case_mismatch: 'auto'`.
- `src/config-file/schema.ts`: add `const CROSS_FILE_CASE_MISMATCH_SEVERITIES = new Set(['error','warning','information','off','info','auto'])`; map public `crossFile.diagnostics.caseMismatch` → `cross_file.diagnostics.case_mismatch` validated against that set only. Leave `CROSS_FILE_SEVERITIES` untouched.
- `src/utils/config-validator.ts`: validate `case_mismatch` against the five values (+`info`/`information`); invalid → fall back to `auto` with a warning.

- [ ] **Step 1: Write failing tests** — parse `caseMismatch = "auto"` maps to `cross_file.diagnostics.case_mismatch === 'auto'`; default when absent is `'auto'`; `caseMismatch = "warning"` maps through; an invalid value (`"bogus"`) falls back to `'auto'` with a warning; and `missingFile = "auto"` is still rejected (auto not allowed on other cross-file severities).

```ts
// in the existing schema-mapping test file (mirror its style):
it('maps crossFile.diagnostics.caseMismatch including auto', () => {
  const mapped = map_public_config({ crossFile: { diagnostics: { caseMismatch: 'auto' } } }, () => {});
  expect(mapped.cross_file.diagnostics.case_mismatch).toBe('auto');
});
it('rejects auto for missingFile', () => {
  const warnings: any[] = [];
  const mapped = map_public_config({ crossFile: { diagnostics: { missingFile: 'auto' } } }, w => warnings.push(w));
  expect(mapped.cross_file.diagnostics.missing_file).not.toBe('auto');
  expect(warnings.length).toBeGreaterThan(0);
});
```

(Use the real exported mapper name from `src/config-file/schema.ts`; the implementer reads it.)

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** type, default, schema set + mapping, validator.
- [ ] **Step 4: Run, verify pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(config): crossFile.diagnostics.caseMismatch severity with auto (#205)"`

---

### Task 4: Diagnostic plumbing — code, kind, seed dir, converter routing

**Files:**
- Modify: `src/types/index.ts` (`DirectiveDiagnostic`, `StataDiagnosticCode`), `src/providers/diagnostics.ts` (`convert_directive_diagnostic`)
- Test: `tests/unit/diagnostics-provider.test.ts` (extend)

**Interfaces:**
- Produces: `StataDiagnosticCode.PATH_CASE_MISMATCH = 7001`; `DirectiveDiagnostic` gains `kind?: 'missing_file' | 'path_case_mismatch'`, `code?: StataDiagnosticCode`, `case_mismatch_seed_dir?: string`.

**Details (spec "The diagnostic"):**
- `convert_directive_diagnostic` routes on `kind`:
  - `'path_case_mismatch'` → severity from `config.cross_file.diagnostics.case_mismatch`; `'auto'` → `host_is_case_sensitive(diagnostic.case_mismatch_seed_dir) ? warning : information`; `'off'` → return `null`. Independent of `missing_file`.
  - else (missing_file / legacy `'Cannot read file'`) → existing path, unchanged.
- The returned LSP `Diagnostic` now includes `code: diagnostic.code` (so `[PATH_CASE_MISMATCH]` reaches `sight check`). Missing-file diagnostics keep `code` undefined.

- [ ] **Step 1: Write failing tests** — feed a `DirectiveDiagnostic` with `kind: 'path_case_mismatch'`, `code: PATH_CASE_MISMATCH`, `case_mismatch_seed_dir: '/ws'` through `convert_directive_diagnostic` with: (a) `case_mismatch: 'off'` → returns null; (b) `case_mismatch: 'warning'` → severity Warning, code propagated; (c) `case_mismatch: 'auto'` + injected host probe → Warning vs Information; (d) `missingFile: 'off'` does NOT null a `path_case_mismatch`. (Inject `host_is_case_sensitive` via a seam — e.g. module mock or a thin internal indirection the test can stub.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** enum value, interface fields, converter routing + `code` propagation.
- [ ] **Step 4: Run, verify pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(diagnostics): path-case-mismatch code/kind + auto severity routing (#205)"`

---

### Task 5: ForwardCall resolution context fields + producers

**Files:**
- Modify: `src/types/index.ts` (`ForwardCall`), `src/analyzer/index.ts` (call extraction ~:1211–1240), `src/indexer/index.ts` (~:493–523), `src/scope-resolver/index.ts` (`parse_content` ~:1764), `src/document-store.ts` (~:790)
- Test: `tests/unit/forward-call-context.test.ts` (create) + extend analyzer/indexer tests

**Interfaces:**
- Produces: `ForwardCall` gains `raw_path: string`, `caller_uri: string`, `working_directory?: string`.

**Details (spec "Resolution-context prerequisite" + C2):** every producer sets the three fields explicitly. The indexer resolves each file's effective working-directory directive(s) **before** call extraction, then stamps `working_directory`. Producers with no WD set `working_directory: undefined` (explicit script-relative).

- [ ] **Step 1: Write failing tests** — analyzer-produced `ForwardCall` for `do sub/clean` carries `raw_path === 'sub/clean'` and `caller_uri`; indexer stamps `working_directory` from an `@lsp-cd` directive in the file.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the field additions and populate at every producer. Keep `path` (script-relative join) as today for backward compat.
- [ ] **Step 4: Run, verify pass; typecheck; run the full forward-scope + dependency-graph suites to catch fallout.**
- [ ] **Step 5: Commit** — `git commit -m "feat(forward-call): carry raw_path/caller_uri/working_directory (#205)"`

---

### Task 6: Dependency graph — real-cased edge URIs

**Files:**
- Modify: `src/dependency-graph/index.ts` (`update_caller` ~:48, `path_to_uri` ~:328, add `set_workspace_roots`); wire `set_workspace_roots` in `src/server-factory.ts` (~:1012) and the indexer + CLI init.
- Test: `tests/unit/dependency-graph.test.ts` (extend)

**Interfaces:**
- Consumes: `resolve_path_rich` (Task 1), `ForwardCall` context fields (Task 5).
- Produces: `DependencyGraph.set_workspace_roots(roots: string[]): void`; edges keyed by real-cased callee URI.

**Details (spec consumer #1):** join `(raw_path, dirname(caller_uri fsPath), working_directory)` like `resolve_call_path`, run `resolve_path_rich` with the graph's `workspace_roots`; on `exact`/`case_only` key the edge by the real-cased resolved URI; on `ambiguous`/`missing` keep today's behavior. Roots unset → today's behavior (no normalization). No diagnostic here.

- [ ] **Step 1: Write failing tests** — a wrong-cased static `do helpers/clean` (on-disk `helpers/Clean.do`) builds a `callee_to_callers` edge keyed by the real-cased `Clean.do` URI; ambiguous → no edge; cover script-relative and working-directory joins. Use a temp dir on disk (real `fs`) gated by `host_is_case_sensitive` for the case-sensitive assertion, OR inject the resolver fs.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `set_workspace_roots` + rich resolution in `update_caller`; wire callers.
- [ ] **Step 4: Run, verify pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(dep-graph): resolve case-only callee paths to real-cased URIs (#205)"`

---

### Task 7: Forward scope resolver — resolve + emit (owner/depth-0 guard)

**Files:**
- Modify: `src/forward-scope-resolver/index.ts` (`resolve_call_path` ~:80, `get_callee_scope` ~:691, `resolve` to thread `diagnostic_owner_uri` + `depth`)
- Test: `tests/unit/forward-scope-case-mismatch.test.ts` (create), extend `tests/property/forward-scope-error-diagnostics.prop.test.ts`

**Interfaces:**
- Consumes: `resolve_path_rich` (1), host probe (2), `DirectiveDiagnostic` fields (4), `ForwardCall` context (5).

**Details (spec consumer #2 + single-emission guard):** replace the ad-hoc `existsSync`+`.do` chain with `resolve_path_rich`. On `case_only`, read the real-cased file and push a forward-worded `DirectiveDiagnostic` (`kind: 'path_case_mismatch'`, `code: PATH_CASE_MISMATCH`, `case_mismatch_seed_dir` = containing workspace root) at the call site — but **only** when `current_file_uri === diagnostic_owner_uri && depth === 0`. Nested/ancestor resolution resolves leniently, suppresses the diagnostic. `ambiguous`/`missing` → existing cannot-read-file diagnostic. Forward message per spec.

- [ ] **Step 1: Write failing tests** — (a) case-only `do` resolves, no undefined-symbol cascade, exactly one `path_case_mismatch` at the call site; (b) grandparent→parent→child chain: grandparent's case-only `do` emits once (on grandparent), not on parent/child; (c) ambiguous → no resolution, cannot-read-file diagnostic.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** rich resolution + owner/depth gating.
- [ ] **Step 4: Run, verify pass; typecheck; run full forward-scope suite.**
- [ ] **Step 5: Commit** — `git commit -m "feat(forward-scope): case-only resolution + single path-case diagnostic (#205)"`

---

### Task 8: Scope resolver — backward directive resolution + real-cased keys

**Files:**
- Modify: `src/scope-resolver/index.ts` (`follow_directives` ~:1324; reverse-dependency/cache maps; `scope_resolver_config_for` ~:99 to thread `case_mismatch`)
- Test: `tests/unit/scope-resolver-case-mismatch.test.ts` (create), extend `tests/property/scope-resolver.prop.test.ts`

**Interfaces:**
- Consumes: `resolve_path_rich` (1), `DirectiveDiagnostic` fields (4).

**Details (spec consumer #3):** for explicit backward directives, build the absolute path from `Directive.raw_path` joined to the directive file's own dir (reuse DirectiveParser separator/UNC semantics, no `.do` fallback at that stage — rich resolver owns it), no `@lsp-cd`/workspace fallback. On `case_only`, resolve the parent and push a backward-worded `path_case_mismatch` at the directive range (message shows `raw_path` vs real-cased name, no execution claim). Route ScopeResolver's own reverse-dependency/cache map keys through the real-cased URI.

- [ ] **Step 1: Write failing tests** — (a) wrong-cased `@lsp-done-by`/`@lsp-included-by` resolves the parent, no cascade, one backward-worded diagnostic asserting no execution claim + shows raw_path; (b) ambiguous → unresolved; (c) invalidation: case-only callee registers under real-cased URI and a later edit invalidates the right cache entry.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, verify pass; typecheck; run full scope-resolver suite.**
- [ ] **Step 5: Commit** — `git commit -m "feat(scope-resolver): case-only backward directives + real-cased keys (#205)"`

---

### Task 9: Go-to-definition

**Files:**
- Modify: `src/providers/definition.ts` (`resolve_file_path` ~:1555)
- Test: `tests/unit/definition-*.test.ts` (extend the relevant include/definition test)

**Interfaces:** Consumes `resolve_path_rich` (1).

**Details (spec consumer #4):** route `resolve_file_path` through `resolve_path_rich`; `exact` and `case_only` both return the real-cased target; `ambiguous`/`missing` → null (no navigation). No diagnostic.

- [ ] **Step 1: Write failing test** — go-to-definition on a wrong-cased `do helpers/clean` navigates to `helpers/Clean.do`; ambiguous → no navigation.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, verify pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(definition): navigate case-only do/run/include paths (#205)"`

---

### Task 10: Completion regression guard

**Files:**
- Test only: `tests/unit/completion-path*.test.ts` (extend) or property test

**Details (spec consumer #5):** no behavior change; add/confirm a test that path completion still lists real-cased entries for its supported roots and does not regress.

- [ ] **Step 1: Write the test** asserting path completion returns the real on-disk entry names.
- [ ] **Step 2: Run, verify pass** (should already pass). If it fails, investigate before proceeding.
- [ ] **Step 3: Commit** — `git commit -m "test(completion): guard path completion casing (#205)"`

---

### Task 11: `sight check` end-to-end

**Files:**
- Test: `tests/integration/sight-check-path-case.test.ts` (create), mirroring existing `sight check` integration tests.

**Details (spec "`sight check`"):** run a project fixture with a case-only `do` typo and assert: (a) exactly one `path_case_mismatch` (code `PATH_CASE_MISMATCH`) at the regime-expected severity; (b) NO undefined-symbol cascade; (c) `missingFile = "off"` does NOT silence it. Gate case-sensitive-regime assertions via `host_is_case_sensitive` so they run for real in Linux CI and invert/skip on macOS.

- [ ] **Step 1: Write failing tests** per (a)/(b)/(c) with a temp-dir fixture.
- [ ] **Step 2: Run, verify fail** (or partially) → drive implementation gaps surfaced here back into Tasks 6–8.
- [ ] **Step 3: Make green.**
- [ ] **Step 4: Run full suite + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "test(check): end-to-end case-only path mismatch, no cascade (#205)"`

---

### Task 12: Documentation

**Files:**
- Modify: `docs/cross-file.md`, `docs/configuration.md`, `docs/diagnostics.md` (if present), settings-reference table, README cross-file section if it enumerates directives/diagnostics.

**Details (spec "Docs"):** document case-only resolution (forward vs backward, no-workspace-fallback backward invariant), the `crossFile.diagnostics.caseMismatch` setting + `auto` regime, and the `path-case-mismatch` diagnostic.

- [ ] **Step 1: Update docs** with the setting row, diagnostic entry, and behavior description (match existing table formatting; 72-col comments / prose wrapping per repo style).
- [ ] **Step 2: Verify** any settings-reference generator (if one exists) is regenerated; otherwise hand-edit consistently.
- [ ] **Step 3: Commit** — `git commit -m "docs: document case-only path mismatch handling + caseMismatch setting (#205)"`

---

## Self-Review

- **Spec coverage:** resolver (T1), host probe (T2), config incl. auto (T3), diagnostic code/kind/seed + converter (T4), ForwardCall producers (T5), dep-graph real-cased edges (T6), forward resolve+emit+single-emission (T7), backward directives + real-cased keys (T8), go-to-def (T9), completion guard (T10), sight check e2e incl. missingFile=off (T11), docs (T12). All spec sections mapped.
- **Type consistency:** `resolve_path_rich`/`PathCaseOutcome`/`RichResolveOptions` (T1) consumed unchanged in T6–T9; `host_is_case_sensitive(seed, fs?)` (T2) used in T4; `DirectiveDiagnostic` fields (`kind`/`code`/`case_mismatch_seed_dir`, T4) produced in T7/T8; `ForwardCall` fields (T5) consumed in T6/T7.
- **Ordering:** foundation (T1–T4) → producers/consumers (T5–T9) → guards/integration (T10–T11) → docs (T12). T11 may surface integration gaps that feed back into T6–T8.
