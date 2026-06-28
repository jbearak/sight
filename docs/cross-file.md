# Cross-File Awareness

The LSP provides cross-file symbol awareness so that diagnostics, completions,
hover, and go-to-definition work across files in your project. By default, no
configuration is needed — the LSP automatically discovers parent–child
relationships by scanning your workspace for `do`, `run`, and `include`
commands.

## How It Works

### Automatic mode (default)

At startup the LSP scans eligible Stata files in your workspace folders
(subject to configured max file size and file count limits) and builds a
**dependency graph** of which files call which other files via `do`, `run`, and
`include` commands. When you open a child file, the LSP looks up its parents in
the graph and inherits the appropriate symbols — no directives required.

For example, given this project:

```text
project/
├── main.do
└── scripts/
    └── analysis.do
```

```stata
// main.do
global data_path "/data"
do "scripts/analysis.do"
```

```stata
// scripts/analysis.do
display "$data_path"   // ✓ No warning — inherited from main.do automatically
```

The LSP sees that `main.do` calls `do "scripts/analysis.do"`, so it
automatically makes `$data_path` (and other non-local symbols defined before
the call site) available in `analysis.do`. Completions, hover, and
go-to-definition all work across the two files with zero setup.

**What auto mode resolves:**

- **Backward dependencies**: If `parent.do` calls `do "child.do"`, the LSP
  automatically makes the parent's symbols available in the child (equivalent
  to adding `@lsp-done-by: "parent.do"` to the child's header).
- **Forward calls**: `do`, `run`, and `include` commands in the current file
  are also followed, making callee symbols available after the call site.

**Limitations of auto mode:**

- Paths containing macro references (e.g., `` do "`path'/file.do" ``) cannot
  be resolved statically and are skipped. Use explicit directives for these.
- Auto mode only works for files within your workspace folders.

**Startup behavior:** During the initial workspace scan, undefined-symbol
diagnostics are deferred for files that have not yet been indexed. Once the scan
completes, all open files are re-validated with the full dependency graph.

### Explicit mode

If you prefer full manual control, set `crossFile.backwardDependencies` to
`"explicit"`. You can set this globally via the VS Code setting
`sight.crossFile.backwardDependencies`, or per-project in `sight.toml`:

```toml
[crossFile]
backwardDependencies = "explicit"
```

In this mode the LSP will not auto-discover parent files — you must add
`@lsp-done-by` or `@lsp-included-by` directives to each child file's header.

**Per-file opt-out:** Even in auto mode, adding an explicit backward directive
to a file's header causes the LSP to skip auto-discovery for that file and use
only the directives you specified.

## What the LSP Reads (Open Files vs Workspace)

When you open a Stata file in VS Code, there are two separate mechanisms at
work:

### 1) Open files (what you have in editor tabs)

For every Stata file that is currently *open* in the editor, the LSP receives
the full text via the LSP protocol (`didOpen` / `didChange`). It then
lexes/parses/analyzes that document and keeps an in-memory cache of the parsed
state for *open documents*.

This open-document cache is used for features that are inherently
document-centric (diagnostics, formatting, document symbols, etc.). Closing a
tab removes that document from the open-document cache.

### 2) Workspace indexing (files on disk)

Independently of which files are open, the LSP **scans your workspace folders
on disk** and builds a workspace symbol index. This is enabled by default via
the VS Code setting `sight.indexWorkspace: true`. If you are using a workspace
`sight.toml`, cross-file indexing is controlled separately via
`crossFile.indexWorkspace`. Workspace indexing runs only when both
`indexWorkspace` and `crossFile.indexWorkspace` are enabled.

At startup (after the server is initialized), the indexer recursively scans the
workspace folders for Stata-related files and reads them from disk to extract
symbols. This index is used for cross-file features like workspace-wide symbol
search and go-to-definition across files.

The indexer is *best-effort* and intentionally bounded:
- It skips files larger than `sight.indexing.maxFileSizeBytes` (default ~500KB)
- It stops after `crossFile.maxIndexedFiles` (default 1000)
- It updates the index when files change on disk (via the VS Code file watcher)

#### Symlinks

Features that **analyze** files — the persistent workspace index and
`sight check` — follow neither symlinked directories nor symlinked files; they
process **real files only**. The index holds entries keyed by file path (the
file watcher invalidates by the changed path), so a symlinked-file alias the
index never indexed would be a stranger to the cross-file graph: analyzing it
gives unreliable scope and (in `sight check`, past the index cap) a spurious
"file not indexed". So the alias is not analyzed. If a symlink's target is
inside your workspace its content is already analyzed via the real path, so
cross-file go-to-definition, workspace-symbol search, and diagnostics still
work. If the target is *outside* your workspace (for example a shared library
elsewhere on disk), add that location as a workspace folder (or, for `.ado`
help/programs, an ado-path) to have it analyzed directly. This also keeps a
stray symlinked directory from making a walk crawl an arbitrary external tree.

(A `do`/`include` that references a file *through* a symlink path is a separate,
pre-existing matter handled by path resolution, not by these directory walks.)

Symlink-following *is* applied in the features that only **list or look up**
paths (no path-keyed analysis state to keep consistent):

- **Path completion** offers symlinked directories (as navigable folders) and
  symlinked files, so you can complete and open them.
- **Help (`.sthlp`) lookup** follows a symlinked help file.

### Cross-file scope resolution

Cross-file *scope* (which symbols are considered "in scope" at a particular
point in a file) is determined by the **scope resolver**.

In auto mode, the scope resolver uses the dependency graph built during the
workspace scan. In explicit mode, it uses directive headers. In both cases,
the resolver reads referenced parent files from disk (even if they are not
open) and **recursively follows the chain** to build a scope. Results are
cached and invalidated when relevant files change.

Importantly, your editor tab state does not change the *meaning* of the
analysis for a file: what you see for a given file is determined by that file's
contents plus its parent chain (and, separately, whatever symbols exist in the
workspace index). Opening or closing unrelated tabs may affect
performance/caching, but should not change results for the file you are
viewing.

## Inheritance Rules

The type of call determines which symbols are inherited:

- **`do` / `run`**: Inherit programs, globals, scalars, matrices, and
  variables. Local macros are **not** inherited.
- **`include`**: Inherit **all** symbols, including local macros.

These rules apply identically whether the parent relationship was
auto-discovered or declared with an explicit directive.

## Forward Scope Resolution

In addition to backward resolution (parent → child), the LSP follows `do`,
`run`, and `include` commands *within* the current file to inherit symbols
from called files.

**Automatic detection:**

The LSP automatically detects `do`, `run`, and `include` commands in your code
and follows them for scope resolution. Paths containing macro references (e.g.,
`` do "`path'/file.do" ``) are not followed.

**Forward call directives:**

For cases where auto-detection doesn't work, you can use explicit forward
directives anywhere in a file's comments:

- `@lsp-do: "path.do"` — Follow a `do` call (excludes locals)
- `@lsp-run: "path.do"` — Follow a `run` call (excludes locals)
- `@lsp-include: "path.do"` — Follow an `include` call (includes locals)

**Scope visibility:**

Forward-resolved symbols become visible only **after** the call site where
they are defined. Backward resolution is performed first, then forward calls
are processed in execution order. Current file symbols always override
inherited ones.

## Backward Directives

When auto mode is insufficient (e.g., paths with macros, files outside the
workspace), you can declare parent relationships explicitly.

**Recommended (spec) syntax:**

- `@lsp-done-by: "<path>"` — Parent calls this file via `do` (inherits
  globals, scalars, matrices, programs; **not** locals)
- `@lsp-run-by: "<path>"` — Synonym for `@lsp-done-by`; use when the parent
  calls via `run`
- `@lsp-included-by: "<path>"` — Parent calls this file via `include`
  (inherits all symbols including locals)

Notes:
- Backward directives are only read from the **top of the file** (header).
  Parsing stops at the first line that is not a comment and not blank after
  trimming whitespace (so whitespace-only lines still count as blank). Forward
  directives (`@lsp-do`, `@lsp-run`, `@lsp-include`) can appear anywhere in
  file comments.
- The parser also accepts an alternative form without the colon and/or without
  quotes (e.g. `// @lsp-done-by parent.do`), but the spec form above is
  preferred.
- `@lsp-run-by` and `@lsp-done-by` are functionally identical; use whichever
  matches the actual Stata command (`run` vs `do`) for semantic clarity.

## Working Directory

By default, the LSP resolves relative paths in `do`, `run`, and `include`
commands relative to the script's containing directory. However, Stata scripts
are often executed from a different working directory than where they reside.
The `@lsp-working-directory` directive allows you to specify this working
directory context.

**Directive Syntax:**

```stata
// @lsp-working-directory: "/path/to/working/dir"
```

**Synonym Forms:**

All of the following are equivalent:
- `@lsp-working-directory`
- `@lsp-working-dir`
- `@lsp-current-directory`
- `@lsp-current-dir`
- `@lsp-cd`
- `@lsp-wd`

**Path Resolution:**

- Paths starting with `/` are treated as **workspace-root-relative** (e.g.
  `/data/load.do` resolves to `<workspaceRoot>/data/load.do`). This is *not*
  a filesystem-absolute path.
- Other paths are resolved relative to the **script's containing directory**

**Limitations:**
- Filesystem-absolute paths (e.g. `/Users/alice/project/file.do`) are not
  currently supported by `@lsp-working-directory` because leading `/` is
  reserved for workspace-root-relative paths.

**Examples:**

```stata
// Script in /project/scripts/analysis.do
// Executed from /project (workspace root)

// @lsp-working-directory: "/"
// Paths in do/run/include resolve relative to /project

do "data/load_data.do"  // Resolves to /project/data/load_data.do
```

```stata
// Script in /project/scripts/analysis.do
// Executed from /project/data

// @lsp-working-directory: "../data"
// Paths resolve relative to /project/data

do "clean.do"  // Resolves to /project/data/clean.do
```

**Fallback Behavior:**

When no `@lsp-working-directory` directive is present:
1. The LSP first tries to resolve paths relative to the script's containing
   directory
2. If the file is not found, it tries resolving relative to the workspace root
3. If still not found, an informational diagnostic suggests adding a working
   directory directive

**Important Notes:**

- The backward directive must appear in the file **header** (before any
  non-comment, non-blank code)
- If multiple working directory directives are present, the **last one** is
  used (with a warning)
- The directive only affects path resolution for `do`, `run`, and `include`
  **commands in Stata code**
- Other `@lsp-*` directives (`@lsp-do`, `@lsp-run`, `@lsp-include`,
  `@lsp-done-by`, `@lsp-included-by`) always resolve paths relative to the
  script's containing directory, unaffected by the working directory directive

**Common Use Case:**

Many Stata projects have a structure like:
```text
project/
├── main.do           # Run from project root
├── scripts/
│   ├── analysis.do   # Called via: do "scripts/analysis.do"
│   └── helpers.do
└── data/
    └── load.do
```

When `analysis.do` calls `do "../data/load.do"`, the path is relative to
`scripts/`. But if you want paths to resolve as if running from the project
root:

```stata
// scripts/analysis.do
// @lsp-working-directory: "/"
do "data/load.do"  // Resolves to /project/data/load.do
```

**Working Directory Inheritance:**

When a file has a parent (whether auto-discovered or declared via backward
directives), it can automatically inherit the working directory from that
parent. This eliminates the need to redundantly specify a working directory
directive when the parent already establishes the working directory context.

**Inheritance Rules:**

- If a child file has a parent but **no own** working directory directive, it
  inherits the working directory from its parent file
- If a child file has its **own** working directory directive, it takes
  precedence over any inherited working directory
- When multiple parent files have working directory directives, the **nearest
  parent** (smallest depth in the directive chain) wins
- The inherited working directory is resolved relative to the **parent file's**
  containing directory, not the child's

**Example:**

```text
project/
├── scripts/
│   ├── loop.do       # Has @lsp-cd: "../" (sets wd to project/)
│   └── dhs/
│       └── survey.do # Inherits working directory from loop.do
└── data/
    └── load_data.do
```

```stata
// scripts/loop.do
// @lsp-cd: "../"
// Working directory is now project/ (parent of scripts/)
global survey_list "dhs"
foreach survey of global survey_list {
    do "scripts/dhs/survey.do"
}
```

```stata
// scripts/dhs/survey.do
// No directives needed — auto mode discovers that loop.do calls this file
// Inherits working directory from loop.do (project/)
do "data/load_data.do"  // Resolves to project/data/load_data.do
```

In this example, `survey.do` inherits the working directory from `loop.do`,
so paths in `survey.do` resolve relative to `project/` rather than
`scripts/dhs/`.

## Call Site Parameters

Backward directives (`@lsp-done-by`, `@lsp-run-by`, `@lsp-included-by`) and
forward call directives (`@lsp-do`, `@lsp-run`, `@lsp-include`) support
optional call-site parameters. These parameters control the **effective call
site line** used for call-site filtering and scope visibility.

- `line=<number>`
  - Backward directives: treat the current file as being called at this line
    in the *parent* file (1-indexed)
  - Forward directives: treat the callee as being called at this line in the
    *current* file (1-indexed)
- `match="<string>"`
  - Backward directives: treat the current file as being called at the first
    line in the *parent* file containing the string
  - Forward directives: treat the callee as being called at the first line in
    the *current* file containing the string

Notes:
- For forward directives, `line=`/`match=` are useful when you want to keep
  directives near documentation (or grouped in one place) but the call happens
  elsewhere; the directive can override where forward-resolved symbols become
  visible.
- If `match=` is not found, the LSP emits a warning and falls back to the
  directive line as the call site.

### Automatic Call Site Inference

When no explicit `line=` or `match=` parameter is provided (including for
auto-discovered parents), the LSP automatically infers the call site by
searching the parent file for `do`, `include`, or `run` statements that
reference the current file.

**How it works:**
1. The LSP extracts the filename from the current file's URI
2. It searches the parent file for statements like `do "filename.do"`,
   `include filename`, or `run filename.do`
3. If found, the first matching line is used as the call site
4. If not found, the `assumeCallSite` config setting is used as fallback
   (`"end"` by default)

**Matching rules:**
- Matches both quoted and unquoted paths: `do "analysis.do"` and
  `do analysis.do`
- Matches with or without `.do` suffix: `do analysis` matches `analysis.do`
- Uses the first match if multiple calls exist

**Example:**

```stata
// parent.do
global setup_var = 1
do "child.do"        // <-- Call site automatically detected here
global after_var = 2
```

```stata
// child.do
// No directives needed in auto mode
local result $setup_var   // OK - defined before call site
local other $after_var    // Warning - defined after call site
```

## Execution Order Checking

The LSP validates that symbols are defined before they're used in execution
order, accounting for cross-file relationships and call sites.

**How execution order checking works:**
1. **Within-file analysis**: Symbols must be defined before use in the same
   file
2. **Cross-file call sites**: Only symbols defined on or before the call site
   in the parent file are considered available
3. **Out-of-scope rewrites**: When a referenced symbol exists but is
   unreachable, the generic undefined-symbol diagnostic is replaced with a
   more specific `OUT_OF_SCOPE_SYMBOL` message

**Out-of-scope symbol handling:**
- Symbols defined after the call site remain available for completions and
  hover, but diagnostics rewrite the base undefined-symbol warning into a more
  specific out-of-scope message
- Same-file later definitions use `used before it is defined (line N)`
- `do`/`run` chains that would only expose a local under `include` report that
  locals are not inherited via `do`/`run`
- Use `line=` or `match=` parameters to specify exact call sites when
  automatic detection is incorrect

## Examples

### Zero-Configuration (Auto Mode)

```stata
// setup.do
global data_path "/data/survey"
global output_path "/output"
do "analysis.do"
```

```stata
// analysis.do
// No directives needed — auto mode discovers the parent
use "$data_path/main.dta", clear
save "$output_path/results.dta", replace
```

### Explicit Directives

```stata
// @lsp-done-by: "setup.do"
local result `global_from_setup'
```

```stata
// @lsp-included-by: "common.do"
local shared_local `local_from_common'
```

### Line-Specific Directives

```stata
// @lsp-done-by: "config.do" line=5
local data_path `root_path'  // Symbols on or before line 5 are available
local other `undefined'      // This will still warn
```

### Call Site Matching

```stata
// @lsp-done-by: "orchestrator.do" match="do \"analysis.do\""
local result `setup_global'  // Symbols before the do call are available
```

## Tie-Breaking / Precedence

When multiple parent files contribute symbols to the same child file,
precedence is resolved deterministically.

Rules:
- **Depth wins first**: symbols from nearer parents (direct parents) override
  symbols from more distant ancestors.
- **Same-depth conflicts**: if multiple parents at the same depth define the
  *same* symbol, the definition from the parent referenced by the
  **lattermost directive in the child file header** wins.

Example (same depth, lattermost wins):

```stata
// @lsp-done-by: "analysis.do"
// @lsp-done-by: "setup.do"
local path "$data_path"  // Uses definition from setup.do (lattermost)
```

Notes:
- This rule applies consistently across completion, hover, go-to-definition,
  and diagnostics.
- The `included-by` vs `done-by` distinction controls *which kinds of symbols
  are inherited* (locals are only inherited via `included-by`), but for symbols
  that both directive types can inherit (e.g., globals/programs/scalars/
  matrices), header order controls same-depth conflicts.

## Find References Across Files

Find References returns different result sets depending on the symbol kind, so
the list reflects how Stata actually scopes each construct:

- **Programs, scalars, matrices, and macros** — returned only for files that
  share a dependency-graph edge with the current file (ancestors or
  descendants via `do`, `run`, `include`, or their `@lsp-*` directive
  equivalents, transitively). Same-named symbols in unrelated modules are
  almost always coincidental, so they are omitted.
- **Variables** — returned for the entire workspace. Stata variables are
  dataset column names rather than file-bound symbols, so name matches in
  unrelated analyses are often legitimate. Results from files related by
  dependency edges are listed first; unrelated files follow.

Isolated files with no `do`/`run`/`include` edges are considered related only
to themselves, so Find References on a program in such a file returns just the
current file's matches.

## Case-Only Path Mismatch Handling

When a `do`, `run`, or `include` path — or a cross-file directive path —
differs from the on-disk file by letter case only, the LSP resolves the
target into the cross-file graph so that symbols are still inherited.
A single `path-case-mismatch` diagnostic is emitted at the call or
directive site pointing out the discrepancy.

**Why this matters:** on a case-insensitive filesystem (macOS, Windows)
the wrong-cased path silently resolves at runtime, but the same path
fails on a case-sensitive filesystem (Linux / CI). The diagnostic gives
you a clear signal before the code reaches Linux CI, without producing a
cascade of false undefined-symbol warnings.

### Forward calls and directives

For `do`, `run`, and `include` commands in Stata code — and for the
explicit forward-call directives `@lsp-do`, `@lsp-run`, `@lsp-include`
— the diagnostic message notes that Stata will not find the file on
case-sensitive systems and shows the as-written path alongside the
on-disk spelling. For example, `do helpers/clean` resolving on-disk
`helpers/Clean.do` produces:

```text
Path "helpers/clean" does not match the file on disk
"helpers/Clean.do"; Stata will not find it on case-sensitive
filesystems (Linux). Update the path to match.
```

The diagnostic is attached to the path argument of the command or
directive. For auto-discovered `do`/`run`/`include` commands (no
explicit directive), the range is the path token in the Stata source.

### Backward header directives

For `@lsp-done-by`, `@lsp-run-by`, and `@lsp-included-by` directives in
the file header, the LSP resolves paths relative to the **file's own
containing directory** — no `@lsp-cd` / working-directory is applied
here and there is no workspace-root fallback (backward directives have
never used them). The message makes no Stata-execution claim because
backward directives are not Stata commands; it simply asks you to fix
the directive casing:

```text
Directive path "parent" does not match the file on disk
"Parent.do"; update the directive to match the file's casing.
```

### Resolution rules

- **Only static paths** are handled. Paths that contain macro
  interpolation (e.g., `` do "`dir'/file.do" ``) are skipped, exactly
  as today.
- **Exact-before-case:** if a file exists with the exact casing written
  in the source, it wins; case-insensitive matching is only tried when
  no exact match is found.
- **Unique match required:** if two or more files differ only by case
  from the requested path (ambiguous), the path stays unresolved — no
  graph edge, no `path-case-mismatch` diagnostic, and the existing
  missing-file diagnostic applies. A unique case-insensitive match
  resolves and emits exactly one `path-case-mismatch` diagnostic.
- **ASCII case folding only.** Non-ASCII byte differences are compared
  exactly.
- **Workspace-bounded.** The case-insensitive scan runs only for paths
  inside a workspace folder. Paths that resolve outside all workspace
  roots get no case handling — existing exact-match/missing behavior.
- **Single emission per call site.** The diagnostic is emitted exactly
  once at the site in the file that contains the mismatched path. Nested
  callee resolution and ancestor-scope traversal resolve leniently but
  do not re-emit the diagnostic on behalf of the traversed file.

### Configuration

Severity is controlled by `crossFile.diagnostics.caseMismatch` (see
[Configuration](#configuration) and
[docs/configuration.md](configuration.md)). The default `"auto"` maps
to `information` on a case-insensitive host (macOS/Windows) and
`warning` on a case-sensitive host (Linux/CI), so the mismatch is quiet
during local development but surfaces as a build warning in Linux CI.
The diagnostic is **not** suppressible by `@lsp-ignore` or
`@lsp-ignore-next`; silence it project-wide with `caseMismatch = "off"`
or by correcting the path casing.

## Call Site Diagnostics

The LSP provides informative diagnostics when processing cross-file
relationships to help you understand the resolution behavior.

### Information-Level Diagnostics

These diagnostics inform you about the resolution behavior without indicating
an error:

- **Call site not identified**: When the LSP cannot find a `do`/`run`/`include`
  statement in the parent file that references your file, it uses a default
  assumption (configurable via `assumeCallSite`). The diagnostic suggests using
  `line=` or `match=` parameters for explicit call site specification.

- **done-by with include mismatch**: When you use `@lsp-done-by` but the
  parent file actually uses `include`, the LSP informs you that full
  inheritance (including local macros) will occur.

### Warning-Level Diagnostics

These diagnostics indicate potential issues that may affect your code:

- **included-by with do/run mismatch**: When you use `@lsp-included-by` but
  the parent file uses `do` or `run`, local macros will NOT be inherited. This
  is a semantic issue that may cause undefined macro warnings.

- **Mixed call types**: When the parent file contains both `do`/`run` AND
  `include` statements referencing your file, the LSP warns about the
  ambiguity and suggests using `line=` or `match=` to specify which call site
  to use.

- **line= out of bounds**: When the specified `line=` parameter exceeds the
  parent file's line count.

- **line= invalid call statement**: When the specified `line=` points to a
  line that doesn't contain a `do`/`run`/`include` command or
  `@lsp-do`/`@lsp-run`/`@lsp-include` directive.

- **match= not found**: When the specified `match=` string is not found in the
  parent file.

### Diagnostic Configuration

Information-level diagnostics for call site identification can be configured
via the `crossFile.diagnostics.callSiteIdentification` setting:
- `"information"` (default): Show as information
- `"warning"`: Show as warning
- `"off"`: Suppress these diagnostics

Note: The `included-by` with `do`/`run` mismatch warning cannot be suppressed
as it indicates a semantic issue that affects symbol inheritance.

## Traversal Depth Limits and Truncation

Cross-file resolution is bounded by three caps (see
[Configuration](#configuration)): `maxBackwardDepth` (10), `maxForwardDepth`
(10), and `maxChainDepth` (20). When a workspace's `do`/`run`/`include` graph is
deep or dense enough to hit one of these caps, the LSP **stops walking** at that
point and emits a *truncation* diagnostic.

A truncation means "resolution was cut short here, so some cross-file symbols may
be missing" — it is **not** a genuine error, and it is distinct from an
undefined-symbol diagnostic. All three depth-cap diagnostics carry the stable
code **`7002` (`CROSS_FILE_TRUNCATED`)**:

- *Maximum backward directive depth (N) exceeded*
- *Maximum forward resolution depth (N) exceeded*
- *Maximum combined resolution depth (N) exceeded when resolving parent forward
  calls*

In `sight check`, truncations are surfaced like any other diagnostic but are
**excluded from the pass/fail tally by code** (not by severity). A deep-but-valid
project therefore never *fails* `sight check` merely because it reached a depth
cap — even under a strict `--max-severity`. The text report adds a dedicated
summary line, e.g.:

```text
3 cross-file traversal truncations (depth cap reached — results may be
incomplete; not undefined-symbol errors)
```

Truncation diagnostics honor the `crossFile.diagnostics.maxDepth` setting like
the other depth diagnostics: it sets their severity, and **`maxDepth = "off"`
suppresses them entirely** (no `CROSS_FILE_TRUNCATED` diagnostic is emitted).
The caps themselves still apply — resolution still stops at the cap — you just
opt out of being told about it.

If you see truncations, either the graph is legitimately deeper than the default
caps (raise `maxBackwardDepth` / `maxForwardDepth` / `maxChainDepth`) or there is
an unintended cycle/fan-out worth investigating. Undefined-symbol warnings for
symbols that were never reached because of a truncation still fire — the summary
line tells you *why* a symbol may be unresolved.

## Forward-Closure Caching Semantics

A file's **forward-call closure** is the set of symbols and call sites produced
by following its `do`/`run`/`include` chain. The LSP's design treats this closure
as a pure function of the file and its resolution context — **caller-independent**
by construction. Concretely, the closure depends only on:

- the callee file's content,
- the **effective call type** it is entered under (`do`/`run` vs `include`,
  which governs local-macro propagation),
- the **working directory** in force (which resolves the callee's relative
  `do`/`run`/`include` paths),
- the forward **depth budget** (raw depth + `maxForwardDepth`), and
- the dependency-graph version.

The *identity of the calling file* never varies the closure. Backward-walk state
and parent forward-call resolution are kept isolated (the parent's forward walk
runs against a *copy* of the backward `visited` set and a *fresh* forward visited
map), so an earlier-sourced sibling's symbols are always visible to a later
sibling in execution order — see
`tests/integration/hub-heavy-sibling-visibility.test.ts`.

**Interaction with a future per-file standalone opt-out.** A planned
`@lsp-standalone` directive would let a file resolve its own diagnostics as if it
had no parents (a *backward* concern). It does **not** introduce caller-dependence
into the *forward* closure: standalone can change the file's *inherited working
directory* and the *effective call type* it is entered under, but both are inputs
the closure already depends on (and would key on, were the closure cached).
Standalone introduces no other forward-closure variation, and never caller
identity. This is the assumption a caller-independent forward-closure cache relies
on; it is enforced by the memo correctness gate
(`tests/integration/forward-closure-memo-gate.test.ts`), which checks that a
file's forward closure is identical across distinct callers given the same inputs.

> Implementation status: the cache *key contract* and an enable/disable toggle
> (`set_forward_closure_memo_enabled`, default **off**) are in place; the cache
> store/serve path is deferred to a follow-up. The toggle is a behavioral no-op
> until then, guarded by the on/off correctness gate.

## Configuration

Cross-file resolution is configured via `sight.toml` in your project root.
Setting names use camelCase by convention, but the `snake_case` spelling is a
permanent equivalent alias for every key (e.g. `crossFile.maxChainDepth` ≡
`cross_file.max_chain_depth`). See
[Naming convention and case aliasing](configuration.md#naming-convention-and-case-aliasing).

```toml
[crossFile]
backwardDependencies = "auto"
indexWorkspace = true
maxIndexedFiles = 1000
maxBackwardDepth = 10
maxForwardDepth = 10
maxChainDepth = 20
maxCalleeRevalidations = 10
assumeCallSite = "end"

[crossFile.diagnostics]
missingFile = "warning"
callSiteIdentification = "information"
```

| Option                                        | Type     | Default         | Description                                            |
| --------------------------------------------- | -------- | --------------- | ------------------------------------------------------ |
| `crossFile.backwardDependencies`              | string   | `"auto"`        | `"auto"`: discover parents from workspace scan; `"explicit"`: require directives |
| `crossFile.indexWorkspace`                    | boolean  | `true`          | Enable workspace-wide file indexing                    |
| `crossFile.maxIndexedFiles`                   | number   | `1000`          | Maximum files to index                                 |
| `crossFile.maxBackwardDepth`                  | number   | `10`            | Maximum depth for backward resolution chains           |
| `crossFile.maxForwardDepth`                   | number   | `10`            | Maximum recursion depth for forward scope resolution   |
| `crossFile.maxChainDepth`                     | number   | `20`            | Maximum combined depth for forward + backward resolution |
| `crossFile.maxCalleeRevalidations`            | number   | `10`            | Maximum open callee documents to revalidate per change |
| `crossFile.assumeCallSite`                    | string   | `"end"`         | Where to assume call site when inference fails (`"end"` or `"start"`) |
| `crossFile.diagnostics.missingFile`           | severity | `"warning"`     | Severity for missing directive file diagnostics        |
| `crossFile.diagnostics.callSiteIdentification`| severity | `"information"` | Severity for call site identification diagnostics      |
| `crossFile.diagnostics.caseMismatch`          | severity or `"auto"` | `"auto"`        | Severity for case-only path mismatch diagnostics. `"auto"`: `information` on case-insensitive filesystems (macOS/Windows), `"warning"` on case-sensitive (Linux/CI) |

Severity options: `"error"`, `"warning"`, `"information"`, `"off"` (alias:
`"info"` for `"information"`). `crossFile.diagnostics.caseMismatch` also
accepts `"auto"` (not valid for other cross-file severity keys).
