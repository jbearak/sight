# Spec: Handle case-only do/run/include path mismatches without diagnostic cascades

Issue: #205 — "Handle case-only do/run/include path mismatches without
diagnostic cascades"
Raven precedent: jbearak/raven#533 (forward), jbearak/raven#540 (backward)
Date: 2026-06-26

## Problem

A path whose spelling differs from the on-disk file only by case
(`do helpers/clean` for an on-disk `helpers/Clean.do`) currently behaves badly,
and the behavior splits by host filesystem:

- **Case-sensitive FS (Linux/CI):** the path fails the exact existence check,
  the target is **dropped from the cross-file graph**, and every symbol it
  defined cascades into false undefined-macro / undefined-variable warnings. A
  single one-character typo can produce a large cascade of bogus diagnostics.
- **Case-insensitive FS (macOS/Windows):** `existsSync` succeeds silently, so
  the same code works locally but breaks later in Linux CI, with **no signal**
  that anything is wrong.

Sight has this risk for Stata `do`, `run`, and `include` chains and for the
cross-file directives. Current resolution uses exact `existsSync` / URI
conversion in `src/utils/file-path-utils.ts`, `src/forward-scope-resolver/`,
`src/scope-resolver/`, and `src/dependency-graph/`.

Note: this issue is **only** about path *spelling against the filesystem*.
Stata language tokens remain fully case-sensitive and are out of scope.

## Goal / non-goals

**Goal:** add a shared rich path resolver that classifies a static path as
exact / unique case-only / ambiguous / missing; route every static-path
consumer through it so a unique case-only match resolves into the graph (no
cascade); and emit exactly one targeted `path-case-mismatch` diagnostic at the
call/directive site, governed by a new configurable severity with an `auto`
mode keyed to the host filesystem. Cover forward calls/directives **and**
backward header directives in a single PR.

**Non-goals:**

- Changing which **base directories** a path is resolved against. Forward calls
  keep their working-directory + `.do`-fallback chain; backward directives keep
  resolving against the file's own directory (no `@lsp-cd`, no workspace-root
  fallback — the Raven invariant). We add case-leniency on top of the existing
  base resolution; we do not introduce new fallback bases.
- Case-folding beyond ASCII. Matching folds only `A–Z`/`a–z`; non-ASCII bytes
  compare exactly (matches Raven).
- Resolving paths that contain macro interpolation. Only static paths (no
  macro references) become edges / get resolved, exactly as today.
- Making the new diagnostic suppressible by `@lsp-ignore` /
  `@lsp-ignore-next`. It is governed solely by its severity setting.
- Touching `use`/`save`/`merge`/`import`/`export`/`adopath` data-file paths.
  Scope is the cross-file execution graph: `do`/`run`/`include` and their
  directive equivalents.

## Decisions (locked)

1. **Setting:** `crossFile.diagnostics.caseMismatch` (public, camelCase),
   internal `cross_file.diagnostics.case_mismatch`. Values
   `auto | error | warning | information | off`, **default `auto`**. Lives
   alongside the existing `crossFile.diagnostics.*` severities (`missingFile`,
   `maxDepth`, `callSiteIdentification`).
2. **Suppressibility:** **not** suppressible by `@lsp-ignore` /
   `@lsp-ignore-next`. Silence via `caseMismatch = "off"` or by fixing the
   path casing.
3. **PR scope:** **single PR** covering forward calls/directives and backward
   header directives.

## Core: shared rich path resolver

New API in `src/utils/file-path-utils.ts` (sits beside, and is used by, the
existing `resolvePathWithDoFallback`):

```ts
export type PathCaseOutcome =
  | { kind: 'exact';     path: string }                          // on-disk casing == requested
  | { kind: 'case_only'; path: string;   requested: string }     // unique case-insensitive match
  | { kind: 'ambiguous'; requested: string; matches: string[] }  // 2+ case-insensitive matches
  | { kind: 'missing';   requested: string };                    // no match

export interface RichResolveOptions {
  /** Append `.do` when the final component has no extension (Stata semantics). */
  try_do_fallback?: boolean;          // default true
  /** Directories within these roots may be case-insensitively scanned. */
  workspace_roots?: string[];
  /** Injected for tests. */
  fs?: { existsSync(p: string): boolean; readdirSync(p: string): string[] };
}

export function resolve_path_rich(
  resolved_fs_path: string,           // already joined against the correct base dir
  options?: RichResolveOptions,
): PathCaseOutcome;
```

`resolve_path_rich` receives a path that the **caller** has already joined
against the correct base directory (working dir for forward, file's own dir for
backward). It does **not** decide base directories — that stays with each
consumer, preserving non-goal #1.

### Algorithm — component-wise, exact-before-case at every level

Split `resolved_fs_path` into directory components below the deepest existing
ancestor. Walk components left → right starting from that ancestor:

1. `readdirSync(current_dir)` (only when the exact child does not exist —
   exact match short-circuits with a cheap `existsSync`).
2. If an entry equals the requested component **with exact casing** → exact for
   this component; descend.
3. Else collect entries equal to the requested component **case-insensitively
   (ASCII fold)**:
   - exactly **1** → `case_only`; record the mismatch and descend into the
     real-cased entry.
   - **2+** → return `ambiguous` (stop).
   - **0** → return `missing` (stop).
4. **Final component, `.do` fallback:** when `try_do_fallback` and the final
   component has no extension, the candidate names are *both* `name` and
   `name.do`. Tier ordering at the final component:
   - exact `name`, then exact `name.do` → `exact`;
   - else case-insensitive over `{name, name.do}`: exactly one distinct on-disk
     file → `case_only`; 2+ distinct → `ambiguous`; none → `missing`.

The overall outcome is `exact` iff every component matched exactly; `case_only`
if at least one component (or the final `.do` candidate) needed ci-resolution
and all were unique and the final target exists; `ambiguous` / `missing` from
the first component that is.

`case_only.path` is the fully real-cased on-disk path; `case_only.requested` is
the original as-typed resolved path (for the diagnostic message).

### Why not trust `existsSync` for the exact tier

`fs.existsSync('helpers/clean.do')` returns **true** on macOS/Windows even when
the file is `Clean.do`. Relying on it would mask the mismatch on case-insensitive
hosts — defeating the "warn before Linux CI" requirement. So the resolver
**compares requested casing against the actual `readdirSync` entry casing** at
each component. This yields the correct classification uniformly on both
regimes. `existsSync` is used only as a fast-path *exact* short-circuit (and a
case-insensitive `existsSync` hit still gets verified against the real entry
casing before being reported `exact`).

### Workspace-bounded scanning

The case-insensitive `readdirSync` scan only runs for directories **inside a
`workspace_roots` entry** (perf + privacy). A component whose directory is
outside every workspace root requires an exact match (falls to `missing` if the
exact child is absent). With no `workspace_roots` supplied, scanning is allowed
for any directory (preserves test ergonomics and standalone-CLI use where the
file under analysis is the root).

### Host regime → `auto` severity

New cached helper (e.g. `src/utils/file-path-utils.ts` or a small
`host-filesystem.ts`):

```ts
export function host_is_case_sensitive(
  fs?: { existsSync(p: string): boolean },
): boolean;   // cached after first probe
```

Probe: take a known-existing path (the module's own `__dirname`), flip the case
of its first ASCII letter, and test `existsSync` of the flipped variant. If the
flipped path does **not** exist → case-sensitive. If no ASCII letter to flip →
assume case-sensitive (conservative: surfaces the warning). The result is
cached at module scope; the optional `fs` injection is for tests only and
bypasses the cache.

`auto` maps to **`information`** on a case-insensitive host and **`warning`** on
a case-sensitive host. Because `sight check --max-severity` defaults to `Info`
(`src/cli/check.ts:129`), the same code is silent on a dev's Mac and **fails
Linux CI** — the intended asymmetry.

## The diagnostic

A new `path-case-mismatch` diagnostic, emitted **once** at the call/directive
site, flowing through the existing `DirectiveDiagnostic` channel so the LSP and
`sight check` share one authoritative emission path.

### Structured discriminator (no prose-matching)

`convert_directive_diagnostic` (`src/providers/diagnostics.ts:1021`) currently
keys severity off the message substring `'Cannot read file'`. That brittleness
must not spread. Add a structured discriminator to `DirectiveDiagnostic`:

```ts
export interface DirectiveDiagnostic {
  message: string;
  range: Range;
  severity: 'error' | 'warning' | 'information';
  source?: DiagnosticSource;
  kind?: 'missing_file' | 'path_case_mismatch';  // NEW — structured severity routing
  code?: StataDiagnosticCode;                     // NEW — stable code for the diagnostic
}
```

`convert_directive_diagnostic` routes on `kind`:

- `kind === 'path_case_mismatch'` → severity from
  `cross_file.diagnostics.case_mismatch` (resolving `auto` via
  `host_is_case_sensitive()`); `off` → return `null` (drop). Independent of
  `missing_file` severity — `missingFile = "off"` does **not** silence it.
- `kind === 'missing_file'` (or legacy `'Cannot read file'` message) → existing
  `missing_file` policy, unchanged.

Add a new `StataDiagnosticCode` in a fresh cross-file range. The existing
ranges are lexer 1xxx, semantic 2xxx, parser 3xxx, indentation 5xxx, operator
6xxx; 7xxx is unused, so:

```ts
// Cross-file diagnostics
PATH_CASE_MISMATCH = 7001,
```

### Messages

- **Forward** (`do`/`run`/`include`, `@lsp-do`/`@lsp-run`/`@lsp-include`): notes
  Stata will not find the file on case-sensitive systems; shows requested vs
  on-disk spelling. e.g.
  `Path "helpers/clean" does not match the file on disk "helpers/Clean.do"; Stata will not find it on case-sensitive filesystems (Linux). Update the path to match.`
- **Backward** (`@lsp-done-by`/`@lsp-run-by`/`@lsp-included-by`): Stata never
  *executes* a backward header directive, so the message makes no execution
  claim. e.g.
  `Directive path "parent" does not match the file on disk "Parent.do"; update the directive to match the file's casing.`

Range: the path token of the call (forward command/directive) or the directive
path (backward header). For auto-discovered forward `do`/`run`/`include`
commands (no explicit directive), the range is the path argument of the command.

### Ambiguous and missing

- `ambiguous` (2+ ci matches): stays **unresolved** — no graph edge, no scope
  inheritance. Falls through to the existing missing-file handling. **No**
  `path-case-mismatch` is emitted (there is no unique target to name). Issue AC:
  "leave 2+ case-insensitive matches unresolved as ambiguous."
- `missing`: unchanged from today (existing missing-file diagnostic where
  applicable).

## Consumers routed through the shared resolver

Every static-path resolution site routes through `resolve_path_rich` so the
real-cased file enters the graph and the diagnostic fires once.

1. **Dependency graph** — `src/dependency-graph/index.ts` `update_caller`
   (~:48–112) / `path_to_uri` (~:328). Today static-call paths become URIs
   without case normalization, so on a case-sensitive FS the
   `callee_to_callers` reverse key never matches the real file's URI and
   backward auto-discovery fails → cascade. Resolve the callee with
   `resolve_path_rich`; on `exact`/`case_only` key the edge by the **real-cased**
   resolved URI; on `ambiguous`/`missing` keep today's behavior (no real-file
   edge). The dep-graph build itself emits no diagnostic (diagnostics belong to
   the resolver phase); it only needs the corrected URI so reverse lookup works.
2. **Forward scope resolver** — `src/forward-scope-resolver/index.ts`
   `resolve_call_path` (~:80) and `get_callee_scope` (~:691). Replace the
   ad-hoc `existsSync` + `.do` chain with `resolve_path_rich`. On `case_only`,
   read the real-cased file and push a `path_case_mismatch` `DirectiveDiagnostic`
   at the call site (replacing the would-be "Cannot read file" miss — no double
   emission). On `ambiguous`/`missing`, keep the existing cannot-read-file
   diagnostic.
3. **Scope resolver** — `src/scope-resolver/index.ts`: **explicit backward
   directive** resolution (`follow_directives`, ~:1324). The wrong casing lives
   in the directive's own path string, so resolve it with `resolve_path_rich`
   against the file's own directory (no `@lsp-cd`/workspace-root fallback). On
   `case_only`, resolve the parent and push a backward-worded
   `path_case_mismatch` at the directive range. On `ambiguous`/`missing`,
   existing behavior.

   Note — **auto-discovered parents** (synthetic directives from the dep graph,
   ~:277) need no resolution or diagnostic here: their `caller_uri` is already
   the real-cased URI of an existing parent file (corrected at consumer #1). In
   the auto-discovery case the casing typo, if any, is in the **parent's
   forward `do`/`run`/`include` statement**, which is reported by the forward
   resolver (consumer #2) when that parent is analyzed — not at the child.
4. **Go-to-definition** — `src/providers/definition.ts` `resolve_file_path`
   (~:1555). Route through `resolve_path_rich`; `exact` and `case_only` both
   navigate to the real-cased target; `ambiguous`/`missing` → no navigation.
5. **Path completion** — `src/providers/completion.ts` path-completion context.
   Completion already lists real directory entries via `readdirSync`, so it
   surfaces correct casing intrinsically; the requirement is only that it not
   regress. No diagnostic from completion.

Diagnostics are emitted **only** in the resolver phase (forward-scope-resolver /
scope-resolver) so each mismatch is reported exactly once regardless of how many
consumers touch the path.

## Configuration

- **Type** (`src/types/index.ts` `CrossFileConfig.diagnostics`): add
  `case_mismatch?: 'auto' | 'error' | 'warning' | 'information' | 'off'`.
- **Default** (`DEFAULT_SETTINGS` in `src/server-handlers.ts`):
  `case_mismatch: 'auto'`.
- **Schema mapping** (`src/config-file/schema.ts`): accept public
  `crossFile.diagnostics.caseMismatch`; add `'auto'` to the accepted severity
  set for this key only (the other cross-file severities keep their existing
  value set). Map camelCase → `cross_file.diagnostics.case_mismatch`. The
  existing `normalize_name` machinery already accepts both camelCase and
  snake_case spellings.
- **Validation** (`src/utils/config-validator.ts`): accept the five values for
  `case_mismatch`; invalid values fall back to `auto` with a warning, matching
  the existing severity-validation pattern.
- **Mapping into resolver config** (`scope_resolver_config_for`,
  `src/scope-resolver/index.ts:99`): thread `case_mismatch` so the resolver
  phase knows the configured severity. `host_is_case_sensitive()` resolves
  `auto` at emission time.

## `sight check`

`sight check` already shares the diagnostics phase with the LSP (scope-resolver
→ forward-scope-resolver → diagnostics provider). No new wiring beyond the
diagnostic flowing through. The `[code]` suffix in text output
(`src/cli/shared.ts`) shows `[PATH_CASE_MISMATCH]` (or its code), consistent
with other diagnostics. `--max-severity` gating is automatic.

## Edge cases / invariants

- **Exact-before-case at every level** — an exact-cased file always wins over a
  differently-cased sibling, even when both exist.
- **`.do` fallback + case** — `do helpers/clean` resolves on-disk
  `helpers/Clean.do` as `case_only` (the issue's motivating example).
- **Directory-component mismatch** — `do Helpers/clean.do` for on-disk
  `helpers/clean.do` resolves `case_only` via component-wise scanning, bounded
  to workspace roots.
- **Macro paths** — paths with macro interpolation are still skipped entirely
  (no resolution, no diagnostic).
- **Backward never executes** — backward directives gain leniency but never the
  workspace-root fallback and never read `@lsp-cd` (Raven invariant); message
  makes no Stata-execution claim.
- **Single emission** — exactly one diagnostic per mismatched call/directive,
  emitted in the resolver phase, never duplicated across consumers.

## Testing (TDD; test-first)

Bun tests, `describe`/`it`. Mirror Raven's structure.

**Resolver unit tests** (`tests/unit/path-resolve-rich.test.ts` or beside
existing file-path-utils tests), with `fs` injected:
- exact; unique case-only; ambiguous (2+); missing.
- `.do` fallback case-only (`helpers/clean` → `helpers/Clean.do`).
- multi-component directory case-only; ambiguous mid-path.
- ASCII-only (non-ASCII byte differences are not folded).
- exact-before-case (sibling with exact casing wins).
- workspace-boundary: outside-root component requires exact.
- `host_is_case_sensitive()` true/false via injected `fs`.

**Host-regime-gated assertions:** a shared `host_is_case_sensitive()` probe
gates the case-sensitive-only end-to-end assertions so they run for real in
Linux CI and are skipped (or inverted) on macOS, mirroring Raven's
`host_is_case_sensitive()` test helper.

**Forward integration:**
- dependency graph: a wrong-cased static `do` builds the edge to the
  real-cased file URI; ambiguous → no edge.
- forward-scope-resolver: case-only call resolves; **no** undefined-symbol
  cascade; **exactly one** `path_case_mismatch` at the call site.
- go-to-definition navigates a wrong-cased `do` path; ambiguous → no nav.

**Backward integration:**
- scope-resolver: wrong-cased `@lsp-done-by`/`@lsp-included-by` resolves the
  parent; no cascade; one backward-worded `path_case_mismatch` (asserts the
  message makes no execution claim); ambiguous → unresolved.

**Config:**
- parse/validate/map `crossFile.diagnostics.caseMismatch` including `auto`;
  default is `auto`; invalid value falls back to `auto` with a warning.

**`sight check` end-to-end:**
- exactly one `path_case_mismatch` at the regime-expected severity, with **no**
  undefined-symbol cascade.
- an integration test proving `missingFile = "off"` does **not** silence
  `path_case_mismatch` (independent policy) — mirrors Raven.

## Docs

- `docs/cross-file.md` — case-only resolution behavior, forward vs backward,
  the no-workspace-fallback backward invariant.
- `docs/configuration.md` — `crossFile.diagnostics.caseMismatch` row + the
  `auto` regime explanation.
- `docs/diagnostics.md` (if present) / settings-reference table —
  `path-case-mismatch` entry.
- README cross-file section if it enumerates directives/diagnostics.

## Out of scope (documented)

- Data-file path commands (`use`/`save`/`merge`/`import`/`export`/`adopath`).
- `@lsp-cd`/working-directory *directive* path casing (only the execution graph
  paths are covered here).
- Non-ASCII case folding.
- Macro-interpolated paths.
