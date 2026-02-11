# Cross-File Awareness

The LSP provides cross-file symbol awareness through comment directives that inform the analyzer about symbols defined in other files.

## What the LSP Reads (Open Files vs Workspace)

When you open a Stata file in VS Code, there are two separate mechanisms at work:

### 1) Open files (what you have in editor tabs)

For every Stata file that is currently *open* in the editor, the LSP receives the full text via the LSP protocol (`didOpen` / `didChange`). It then lexes/parses/analyzes that document and keeps an in-memory cache of the parsed state for *open documents*.

This open-document cache is used for features that are inherently document-centric (diagnostics, formatting, document symbols, etc.). Closing a tab removes that document from the open-document cache.

### 2) Workspace indexing (files on disk)

Independently of which files are open, the LSP can also **scan your workspace folders on disk** and build a workspace symbol index. This is enabled by default via the VS Code setting `sight.indexWorkspace: true`. If you are using a workspace `.sight.json`, cross-file indexing is controlled separately via `crossFile.indexWorkspace`.

At startup (after the server is initialized), the indexer recursively scans the workspace folders for Stata-related files and reads them from disk to extract symbols. This index is used for cross-file features like workspace-wide symbol search and go-to-definition across files.

The indexer is *best-effort* and intentionally bounded:
- It skips files larger than `sight.indexing.maxFileSizeBytes` (default ~500KB)
- It stops after `crossFile.maxIndexedFiles` (default 1000)
- It updates the index when files change on disk (via the VS Code file watcher)

### Cross-file scope resolution via directives

Cross-file *scope* (which symbols are considered "in scope" at a particular point in a file) is handled by the **directive-based scope resolver**.

If an open file contains `@lsp-done-by` and/or `@lsp-included-by` directives in its header, the scope resolver will read the referenced parent file(s) from disk (even if they are not open) and **recursively follow directives** to build a scope chain. Results are cached and invalidated when relevant files change.

Importantly, your editor tab state does not change the *meaning* of the analysis for a file: what you see for a given file is determined by that file's contents plus any files it references via directives (and, separately, whatever symbols exist in the workspace index). Opening or closing unrelated tabs may affect performance/caching, but should not change results for the file you are viewing.

## Directives

Use these comment directives to declare which files call the current file (cross-file scope awareness).

**Recommended (spec) syntax:**

- `@lsp-done-by: "<path>"` - Parent file calls this file via `do` (inherits globals, scalars, matrices, programs; **not** locals)
- `@lsp-run-by: "<path>"` - Synonym for `@lsp-done-by`; use when the parent calls this file via `run` instead of `do`
- `@lsp-included-by: "<path>"` - Parent file calls this file via `include` (inherits locals, globals, scalars, matrices, programs)

Notes:
- Directives are only read from the **top of the file** (header). Parsing stops at the first line that is not a comment and not blank after trimming whitespace (so whitespace-only lines still count as blank).
- The parser also accepts an alternative form without the colon and/or without quotes (e.g. `// @lsp-done-by parent.do`), but the spec form above is preferred.
- `@lsp-run-by` and `@lsp-done-by` are functionally identical; use whichever matches the actual Stata command (`run` vs `do`) for semantic clarity.

## Forward Scope Resolution

In addition to backward directives, the LSP can follow `do`, `run`, and `include` commands to inherit symbols from called files.

**Forward Call Directives:**

- `@lsp-do: "path.do"` - Follow a do command to inherit symbols (excludes locals)
- `@lsp-run: "path.do"` - Follow a run command to inherit symbols (excludes locals)
- `@lsp-include: "path.do"` - Follow an include command to inherit all symbols including locals

**Automatic Detection:**

The LSP also automatically detects `do`, `run`, and `include` commands in your code and follows them for scope resolution. Paths containing macro references (e.g., ``do "`path'/file.do"``) are not followed.

**Inheritance Rules:**

- `do` and `run`: Inherit programs, globals, scalars, matrices, and variables (NOT local macros)
- `include`: Inherit all symbols including local macros

**Scope Visibility:**

Forward-resolved symbols become visible only after the call site where they are defined. Backward directives (`@lsp-done-by`/`@lsp-included-by`) are resolved first, then forward calls are processed in execution order. Current file symbols always override inherited ones.

**Diagnostics:**

- Exceeding `maxBackwardDepth` emits a diagnostic about backward directive chain depth
- Exceeding `maxForwardDepth` emits a diagnostic about forward resolution depth
- Exceeding `maxChainDepth` emits a diagnostic about combined resolution depth
- Cycles in forward resolution are detected and emit a warning

**Configuration:**

| Option                        | Type   | Default | Description                                            |
| ----------------------------- | ------ | ------- | ------------------------------------------------------ |
| `crossFile.maxBackwardDepth`  | number | `10`    | Maximum depth for backward directive chains            |
| `crossFile.maxForwardDepth`   | number | `10`    | Maximum recursion depth for forward scope resolution   |
| `crossFile.maxChainDepth`     | number | `20`    | Maximum combined depth for forward + backward resolution |

## Working Directory

By default, the LSP resolves relative paths in `do`, `run`, and `include` commands relative to the script's containing directory. However, Stata scripts are often executed from a different working directory than where they reside. The `@lsp-working-directory` directive allows you to specify this working directory context.

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

- Paths starting with `/` are treated as **workspace-root-relative** (e.g. `/data/load.do` resolves to `<workspaceRoot>/data/load.do`). This is *not* a filesystem-absolute path.
- Other paths are resolved relative to the **script's containing directory**

**Limitations:**
- Filesystem-absolute paths (e.g. `/Users/alice/project/file.do`) are not currently supported by `@lsp-working-directory` because leading `/` is reserved for workspace-root-relative paths.

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
1. The LSP first tries to resolve paths relative to the script's containing directory
2. If the file is not found, it tries resolving relative to the workspace root
3. If still not found, an informational diagnostic suggests adding a working directory directive

**Important Notes:**

- The directive must appear in the file **header** (before any non-comment, non-blank code)
- If multiple working directory directives are present, the **last one** is used (with a warning)
- The directive only affects path resolution for `do`, `run`, and `include` **commands in Stata code**
- Other `@lsp-*` directives (`@lsp-do`, `@lsp-run`, `@lsp-include`, `@lsp-done-by`, `@lsp-included-by`) always resolve paths relative to the script's containing directory, unaffected by the working directory directive

**Common Use Case:**

Many Stata projects have a structure like:
```
project/
├── main.do           # Run from project root
├── scripts/
│   ├── analysis.do   # Called via: do "scripts/analysis.do"
│   └── helpers.do
└── data/
    └── load.do
```

When `analysis.do` calls `do "../data/load.do"`, the path is relative to `scripts/`. But if you want paths to resolve as if running from the project root:

```stata
// scripts/analysis.do
// @lsp-working-directory: "/"
do "data/load.do"  // Resolves to /project/data/load.do
```

**Working Directory Inheritance:**

When a file uses backward directives (`@lsp-done-by`, `@lsp-run-by`, or `@lsp-included-by`) to declare a parent file, it can automatically inherit the working directory from that parent file. This eliminates the need to redundantly specify both the backward directive and a working directory directive when the parent already establishes the working directory context.

**Inheritance Rules:**

- If a child file has a backward directive but **no own** working directory directive, it inherits the working directory from its parent file
- If a child file has its **own** working directory directive, it takes precedence over any inherited working directory
- When multiple parent files have working directory directives, the **nearest parent** (smallest depth in the directive chain) wins
- The inherited working directory is resolved relative to the **parent file's** containing directory, not the child's

**Example:**

```
project/
├── scripts/
│   ├── loop.do       # Has @lsp-cd: "../" (sets working directory to project/)
│   └── dhs/
│       └── survey.do # Has @lsp-done-by: "../loop.do" (inherits working directory)
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
// @lsp-done-by: "../loop.do"
// Inherits working directory from loop.do (project/)
// No need to add @lsp-cd here!
do "data/load_data.do"  // Resolves to project/data/load_data.do
```

In this example, `survey.do` inherits the working directory from `loop.do`, so paths in `survey.do` resolve relative to `project/` rather than `scripts/dhs/`.

## Call Site Parameters

Backward directives (`@lsp-done-by`, `@lsp-run-by`, `@lsp-included-by`) and forward call directives (`@lsp-do`, `@lsp-run`, `@lsp-include`) support optional call-site parameters. These parameters control the **effective call site line** used for call-site filtering and scope visibility.

- `line=<number>`
  - Backward directives: treat the current file as being called at this line in the *parent* file (1-indexed)
  - Forward directives: treat the callee as being called at this line in the *current* file (1-indexed)
- `match="<string>"`
  - Backward directives: treat the current file as being called at the first line in the *parent* file containing the string
  - Forward directives: treat the callee as being called at the first line in the *current* file containing the string

Notes:
- For forward directives, `line=`/`match=` are useful when you want to keep directives near documentation (or grouped in one place) but the call happens elsewhere; the directive can override where forward-resolved symbols become visible.
- If `match=` is not found, the LSP emits a warning and falls back to the directive line as the call site.

### Automatic Call Site Inference

When no explicit `line=` or `match=` parameter is provided, the LSP automatically infers the call site by searching the parent file for `do`, `include`, or `run` statements that reference the current file.

**How it works:**
1. The LSP extracts the filename from the current file's URI
2. It searches the parent file for statements like `do "filename.do"`, `include filename`, or `run filename.do`
3. If found, the first matching line is used as the call site
4. If not found, the `assumeCallSite` config setting is used as fallback (`"end"` by default)

**Matching rules:**
- Matches both quoted and unquoted paths: `do "analysis.do"` and `do analysis.do`
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
// @lsp-done-by: "parent.do"
// No line= or match= needed - call site is inferred automatically
local result $setup_var   // OK - defined before call site
local other $after_var    // Warning - defined after call site
```

## Execution Order Checking

The LSP validates that symbols are defined before they're used in execution order, accounting for cross-file relationships and call sites.

**How execution order checking works:**
1. **Within-file analysis**: Symbols must be defined before use in the same file
2. **Cross-file call sites**: When using directives, only symbols defined on or before the call site in the parent file are considered available
3. **Out-of-scope warnings**: References to symbols defined after the call site generate warnings

**Automatic call site detection:**
- The LSP scans parent files for `do`, `run`, or `include` statements matching the current filename
- Matches both quoted (`do "file.do"`) and unquoted (`do file`) forms
- Uses the first matching statement as the effective call site
- Falls back to `assumeCallSite` setting (`"end"` by default) if no match found

**Out-of-scope symbol handling:**
- Symbols defined after the call site are flagged as "out-of-scope"
- These symbols appear in completions but generate warnings when used
- Use `line=` or `match=` parameters to specify exact call sites when automatic detection fails

## Examples

### Basic Usage

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
local data_path `root_path'  // Symbols defined on or before line 5 are available
local other `undefined'      // This will still warn
```

### Call Site Matching

```stata
// @lsp-done-by: "orchestrator.do" match="do \"analysis.do\""
local result `setup_global'  // Symbols defined before the do call are available
```

## Inheritance Rules

- **@lsp-done-by** / **@lsp-run-by**: Covers most symbols, except for local macros (covers programs, scalars, matrices, and global macros)
- **@lsp-included-by**: Covers all symbols including local macros

Use `@lsp-done-by` (or `@lsp-run-by`) for files that define globals/programs, and `@lsp-included-by` for files that are literally included (like with `include` command).

## Call Site Diagnostics

The LSP provides informative diagnostics when processing cross-file directives to help you understand the resolution behavior.

### Information-Level Diagnostics

These diagnostics inform you about the resolution behavior without indicating an error:

- **Call site not identified**: When the LSP cannot find a `do`/`run`/`include` statement in the parent file that references your file, it uses a default assumption (configurable via `assumeCallSite`). The diagnostic suggests using `line=` or `match=` parameters for explicit call site specification.

- **done-by with include mismatch**: When you use `@lsp-done-by` but the parent file actually uses `include`, the LSP informs you that full inheritance (including local macros) will occur.

### Warning-Level Diagnostics

These diagnostics indicate potential issues that may affect your code:

- **included-by with do/run mismatch**: When you use `@lsp-included-by` but the parent file uses `do` or `run`, local macros will NOT be inherited. This is a semantic issue that may cause undefined macro warnings.

- **Mixed call types**: When the parent file contains both `do`/`run` AND `include` statements referencing your file, the LSP warns about the ambiguity and suggests using `line=` or `match=` to specify which call site to use.

- **line= out of bounds**: When the specified `line=` parameter exceeds the parent file's line count.

- **line= invalid call statement**: When the specified `line=` points to a line that doesn't contain a `do`/`run`/`include` command or `@lsp-do`/`@lsp-run`/`@lsp-include` directive.

- **match= not found**: When the specified `match=` string is not found in the parent file.

### Examples: Explicit Call Site Selection

When automatic call site inference fails or you need precise control, use `line=` or `match=` parameters:

```stata
// child.do - Using line= to specify exact call site
// @lsp-done-by: "parent.do" line=15
local result $setup_var  // Only symbols defined on/before line 15 of parent.do are visible
```

```stata
// child.do - Using match= to find call site by content
// @lsp-included-by: "orchestrator.do" match="include \"child.do\""
local shared `parent_local'  // Symbols defined before the matched line are visible
```

```stata
// analysis.do - Combining with quoted paths
// @lsp-done-by: "../scripts/setup.do" line=42
// @lsp-included-by: "common/macros.do" match="include \"analysis.do\""
local data_path "$root_path"
local helper `shared_macro'
```

### Configuration

Information-level diagnostics for call site identification can be configured via the `crossFile.diagnostics.callSiteIdentification` setting:
- `"information"` (default): Show as information
- `"warning"`: Show as warning
- `"off"`: Suppress these diagnostics

Note: The `included-by` with `do`/`run` mismatch warning cannot be suppressed as it indicates a semantic issue that affects symbol inheritance.

## Tie-Breaking / Precedence

When multiple parent files contribute symbols to the same child file, precedence is resolved deterministically.

Rules:
- **Depth wins first**: symbols from nearer parents (direct parents) override symbols from more distant ancestors.
- **Same-depth conflicts**: if multiple parents at the same depth define the *same* symbol, the definition from the parent referenced by the **lattermost directive in the child file header** wins.

Example (same depth, lattermost wins):

```stata
// @lsp-done-by: "analysis.do"
// @lsp-done-by: "setup.do"
local path "$data_path"  // Uses definition from setup.do (because its directive is lattermost)
```

Notes:
- This rule applies consistently across completion, hover, go-to-definition, and diagnostics.
- The `included-by` vs `done-by` distinction controls *which kinds of symbols are inherited* (locals are only inherited via `included-by`), but for symbols that both directive types can inherit (e.g., globals/programs/scalars/matrices), header order controls same-depth conflicts.
