# Development Guidelines

## Overview

Sight is a Language Server Protocol (LSP) implementation for the Stata programming language, providing modern IDE features like semantic analysis, cross-file symbol resolution, and intelligent macro tracking. The LSP brings features like Go-to-Definition, Autocomplete, and Real-time Diagnostics to Stata development.

**Key Features:**
- Workspace-wide symbol resolution across `.do`, `.ado`, `.doh`, and `.mata` files
- Automatic cross-file scope awareness (auto-discovers `do`/`run`/`include` relationships), with optional explicit directives
- Forward reference detection and undefined macro warnings
- Intelligent completion for commands, options, macros, and variables
- Real-time diagnostics that trace execution through `do` and `include` chains
- Code formatting with comment style normalization
- Embedded language support (Mata, Python blocks)

## Stata Language Characteristics

**IMPORTANT: Stata is fully case-sensitive.** This affects all aspects of the LSP:

- Commands: `display` works, `Display` is "unrecognized"
- Keywords: `if`, `in`, `foreach`, `end`, `mata`, `python` must be lowercase
- Variable names: `myVar` ≠ `myvar`
- Macro names: `myMacro` ≠ `mymacro`
- Program names: `MyProgram` ≠ `myprogram`

When implementing features, use exact string comparison for Stata keywords and
commands. Do NOT use `toLowerCase()` for keyword/command matching.

Exceptions where case-insensitivity is acceptable:
- File extensions (`.do`, `.DO` - filesystem dependent)
- LSP directives (`@lsp-done-by` - our convention, not Stata syntax)
- Command database lookups for completion/hover (user convenience): when
  matching a single piece of user-typed text against the canonical command
  database (e.g., `command_db.get_command(word)`), lowercasing the user input
  is fine — the database itself normalizes on entry.

The exception is narrow. The following are NOT covered and must use exact-case
comparison:
- Hardcoded lists of canonical command names in provider code (e.g., prefix-
  command arrays like `['by', 'bysort', 'quietly', ...]`). Stata rejects
  `BY x: reg ...`, so treating `BY` as a prefix produces misleading hover and
  completion for code that won't run.
- Comparisons between two pieces of source text at the same position (e.g.,
  `token.value.toLowerCase() === hovered_word.toLowerCase()` where both sides
  came from the same document). Lowercasing both sides is redundant when
  positional overlap is already checked; it adds noise and can mask bugs if
  the positional check is later weakened.

## Architecture Overview

The architecture follows a pipeline pattern:

```
Source Code → Lexer → Parser → Analyzer → Providers → LSP Response
```

At runtime, the LSP server entrypoint is `src/server.ts` (Node IPC transport),
and request/notification logic is factored into handler factories in
`src/server-handlers.ts`. A VS Code client extension lives in `client/`.

**Data Flow:**
1. Document changes trigger re-lexing and re-parsing (debounced via `DocumentDebounceManager`)
2. Providers receive document state + tokens/AST/symbols (via `DocumentStore`)
3. Context tracker provides position-aware language context
4. Providers filter/adjust behavior based on context (e.g., suppress Stata completions inside Mata/Python blocks)
5. Workspace indexer scans workspace folders (and ado-paths) to provide a best-effort workspace symbol index
6. If cross-file directives are present, `ScopeResolver` reads referenced parent files from disk and builds a cached scope chain for precise inheritance

## Core Systems

### Language Processing

**Lexer** (`src/lexer/`): Tokenizes Stata source code. Handles:
- Delimiter modes (`#delimit cr` vs `#delimit ;`)
- Embedded language contexts (Mata, Python)
- Strings, macros, comments, operators
- Comment disambiguation for `*` (comment vs multiplication), based on position and context

**Parser** (`src/parser/`): Builds AST from tokens. Produces:
- Command nodes, macro definitions, program definitions
- Control flow (if/else, foreach, forvalues, while, frame blocks)
- Embedded language blocks
- Trivia attachment (comments, continuations)
- Syntax command nodes (used for program signature extraction)

**Analyzer** (`src/analyzer/`): Semantic analysis. Builds symbol tables and
detects undefined macro/variable references. Includes forward reference
detection and supports LSP directives for manual overrides. Recognizes
`c_local` calls in programs to provide completions to callers, and detects
macro-creating options like `local()` and `global()` in built-in commands
(`levelsof`, `glevelsof`) as well as user-defined programs (via `c_local `option'`
and `global `option'` patterns that match syntax declarations). Also recognizes
the two-argument Mata setter forms `st_local("name", value)` /
`st_global("NAME", value)` (inline `mata:` and `mata`/`end` and `mata { }`
blocks) as macro definitions when the name is a literal double-quoted
identifier; the one-argument read form `st_local("name")` declares nothing.
See `extract_mata_st_local_declarations`.

**Forward Reference Detection**: The analyzer tracks the preorder traversal
index where each macro is defined. When checking references, it compares the
reference position against the definition position:
- If a macro is referenced before it's defined → warning
- If a macro is defined before it's referenced → no warning
- Positional args (`0`, `1`...) bypass position checking
- First definition wins for multiple definitions of the same macro

Note: The analyzer only knows about symbols defined in the current file. Symbols
from other files (via workspace indexing) are available for completions and
go-to-definition, but do NOT suppress undefined macro warnings. To suppress
warnings for cross-file symbols, the LSP uses two mechanisms: (1) auto backward
discovery via the DependencyGraph (default, `backward_dependencies: 'auto'`),
which scans the workspace for `do`/`run`/`include` commands and builds parent
chains automatically; and (2) forward scope resolution via ForwardScopeResolver,
which follows `do`/`run`/`include` commands within each file. Explicit directives
(`@lsp-done-by`, `@lsp-included-by`, `@lsp-do`, `@lsp-run`, `@lsp-include`) can
be used for cases where auto-detection doesn't work (e.g., dynamic paths with
macros).

**Context Tracker** (`src/context-tracker/`): Tracks language context
(Stata/Mata/Python) for position-aware features. Validates block structure.

### Cross-file Resolution

**Directive Parser** (`src/directive-parser/`): Parses cross-file directives
from the file header and declaration directives from comment lines:
- Cross-file directives are only read from the top-of-file header: parsing stops
  at the first line that is not blank and not a comment (after trimming).
- Preferred (spec) syntax uses a colon and quotes:
  - `@lsp-done-by: \"path.do\"`
  - `@lsp-run-by: \"path.do\"` (synonym for `@lsp-done-by`)
  - `@lsp-included-by: \"path.do\"`
  Alt forms without `:` and/or without quotes are also accepted.
- Cross-file directives support optional call-site parameters:
  - `line=<number>` (1-indexed in the directive)
  - `match=\"<string>\"` (first line containing the string)
- If no call site is provided, the resolver attempts to infer it by scanning the
  parent file for `do`/`include`/`run` statements referencing the current file.

**Supported Directives** (recognized in comment tokens; see `README.md` for
user-facing examples):
- `@lsp-ignore`, `@lsp-ignore-next`: Suppress undefined-symbol diagnostics.
  `@lsp-ignore` targets the same line; `@lsp-ignore-next` targets the next
  non-trivia token / next statement line.
- `@lsp-variables`: Declare variables (e.g., loaded from data files)
- `@lsp-local`, `@lsp-global`: Declare macros manually (forward-only: suppress
  warnings at-or-after the directive line)
- `@lsp-scalar`, `@lsp-matrix`, `@lsp-program`: Declare other symbols (single-argument)
- `@lsp-done-by`, `@lsp-included-by`: Cross-file scope linking (header-only)
- `@lsp-do`, `@lsp-run`, `@lsp-include`: Forward call directives (can appear
  anywhere in file comments, unlike header-only backward directives)
- `@lsp-standalone` / `sight: standalone`: Header-only, no-argument marker
  that opts a file out of ALL inherited backward parent scope and inherited
  working directory (issue #208). Wins over explicit backward directives
  (each ignored line gets a warning, emitted by resolve()'s root path).
  Cut-everywhere: also honored when the file is walked as a mid-chain
  ancestor. Forward calls, DependencyGraph edges, and find-references
  connectivity are unchanged. See docs/cross-file.md "Standalone Files".

**Dependency Graph** (`src/dependency-graph/`): Maintains a bidirectional graph
of `do`/`run`/`include` relationships across the workspace. Populated during the
workspace scan by the indexer. Key features:
- `callee_to_callers` reverse index for auto backward discovery
- `caller_to_callees` forward index for O(M) cleanup on re-index
- Monotonic `version_counter` (folded into scope cache keys for invalidation)
- `scan_complete` flag (gates diagnostic deferral during startup)
- Only static paths (no macro interpolation) become edges

**Scope Resolver** (`src/scope-resolver/`): Resolves cross-file scopes. In auto
mode (default), it synthesizes directives from the dependency graph when no
explicit directives are present. In explicit mode, it uses only header
directives. Features:
- Auto backward discovery: when `backward_dependencies === 'auto'` and a file
  has no explicit directives, `dependency_graph.get_parents()` edges are
  converted to synthetic `done-by`/`included-by` directives with call-site lines
- Per-file opt-out: files with explicit directives skip auto-discovery
- Recursive resolution with cycle detection and a configurable max chain depth
- Two-level caching (file parse cache + resolved-scope cache) with hash-based validation and cascading invalidation
- Call-site filtering: only include parent symbols defined on/before the call site; collect out-of-scope symbols separately
- Inheritance rules:
  - `done-by` / `run-by` / `do` / `run` inherits non-local symbols (programs, globals, scalars, matrices, variables)
  - `included-by` / `include` inherits all symbols (including local macros)
- Deterministic precedence when multiple parents contribute:
  - nearer parents (smaller depth) override more distant ancestors
  - same-depth conflicts: the lattermost directive in the child file header wins
  - the current file always overrides inherited symbols

**Forward Scope Resolver** (`src/forward-scope-resolver/`): Resolves forward
call directives (`@lsp-do`, `@lsp-run`, `@lsp-include`) and auto-detected
`do`/`run`/`include` commands. Features:
- Parses callee files and extracts symbols with caching (shares file parse cache with ScopeResolver)
- Caches forward_calls extraction per file
- Symbols become visible only after the call site in execution order
- Backward directives resolved first, then forward calls processed in order
- Cycle detection and configurable max depth (`cross_file.max_backward_depth`, `cross_file.max_forward_depth`, `cross_file.max_chain_depth`, defaults 10, 10, 20; user-facing `crossFile.maxBackwardDepth`, `crossFile.maxForwardDepth`, `crossFile.maxChainDepth`)
- Paths containing macro references are skipped
- Caller-independent forward-closure memo (#234, on by default): nested
  closures cached by semantic inputs (callee content hash, effective call type,
  inherited working directory, depth caps, and dependency-graph version), not
  caller identity. Only standalone, diagnostic-free closures are stored. Serves
  require disjoint caller dedup state, replay the cached visited-delta, and are
  evicted with ScopeResolver's scope cache. Standalone files affect the inherited
  working-directory input but do not otherwise make the forward closure
  caller-dependent.

### LSP Features

**Providers** (`src/providers/`): LSP feature implementations:
- `completion.ts` - Auto-complete for commands, options, macros, variables
- `completion/macro-completion.ts` - Specialized macro completion logic
- `definition.ts` - Go-to-definition for macros, programs, and included files
- `references.ts` - Find references for macros, programs, variables, and other symbols
- `diagnostics.ts` - Error/warning reporting
- `formatter.ts` - Code formatting (PrettyPrinter + optional comment normalization; preserves embedded blocks)
- `hover.ts` - Hover information
- `symbols.ts` - Document/workspace symbols

**Completion Provider Architecture**: The completion provider (`src/providers/completion.ts`) determines symbols based on two modes:

1.  **Scope-Resolved Mode** (when auto-discovered parents or explicit directives
    provide a resolved scope):
    - Uses `ScopeResolver` to build a precise scope chain.
    - In auto mode, the dependency graph provides parent relationships; in
      explicit mode, `@lsp-done-by` / `@lsp-included-by` directives are used.
    - Local macros are visible if inherited via `include` (auto or directive).
    - The resolved scope applies call-site filtering (on/before call site) and
      emits additional directive diagnostics + out-of-scope symbol info.

2.  **Global Mode** (fallback when no parents are found):
    - Merges **Fresh Document Symbols** (in-memory) with **Workspace Symbols** (indexed from disk).
    - Workspace globals are visible in completions (but do NOT suppress undefined macro warnings in diagnostics).
    - Local macros are only visible from the current file.

Note: The workspace symbol index is used for completions, go-to-definition, and
workspace symbol search. It does NOT suppress undefined macro warnings — only
resolved scope (via auto-discovery or explicit directives) suppresses them.

In both modes, completion ordering is made deterministic via `sortText` keys
computed from multiple ranking factors (scope depth, directive type, symbol type,
priority tiers for built-in commands, etc.).

**Symbol Merging Strategy (Global Mode)**:
To ensure completions reflect immediate edits (additions, renames, deletions), we employ a specific merging strategy:
-   **Filter Step**: Before merging, we filter out any symbols from the `workspace_symbols` that originate from the *current* document's URI. This prevents stale symbols (e.g., deleted macros) that still exist in the slower disk-based index from polluting the completion list.
-   **Merge Step**: We overlay the fresh `document.symbols` onto the filtered `workspace_symbols`.

This ensures that:
-   New symbols appear immediately.
-   Deleted symbols disappear immediately (because the stale copy is filtered out).
-   Renamed symbols update correctly (old name removed, new name added).

**Concurrency Handling**:
Completion requests are race-prone against document updates. The `server-handlers.ts` uses `document_store.wait_for_update(uri)` to ensure any pending `textDocument/didChange` processing completes before serving completions.

Diagnostic publication uses an explicit per-open/per-tab lifecycle trigger in
`DiagnosticsPublishGate`. For clients that provide editor diagnostic ownership,
an eligible `didOpen` or tab re-addition begins the lifecycle; tab removal,
`didClose`, and shutdown retire it. Clients without the ownership extension keep
normal LSP behavior, where every `didOpen` is eligible. Validation captures the
trigger before debounce and the provider rechecks it after asynchronous
computation, so retired work cannot publish into a close/reopen, tab
remove/re-add, or after a newer edit is scheduled. The trigger carries the
document version, lifecycle identity, and a separate force epoch that authorizes
one same-version republish after dependency or configuration changes.

Tab removal does **not** close the LSP document or remove its `DocumentStore`,
index, or dependency state. Hidden documents opened by other extensions remain
parse/index inputs for cross-file analysis; only their own push diagnostics are
suppressed. The validation-current predicate therefore permits hidden work but
becomes fail-closed again if the URI is re-added under a new lifecycle. The
server also checks `TextDocuments` object identity and version after awaited
validation stages so an active stale callback cannot reopen or overwrite
`DocumentStore` from its retired snapshot.

**Find References — Three-Tier Scoping**: The references provider uses three
distinct scoping tiers by design: (1) **local macros** — include-chain files
only (Stata locals don't propagate through `do`/`run`); (2) **global macros,
programs, scalars, matrices** — dep-graph-reachable files (all do/run/include
edges), further filtered to dep-graph-reachable, cursor-visible files, with
same-name conflicts resolved by effective scope precedence so only the active
visible symbol's files participate; (3) **variables** — entire workspace (dataset columns like
`id`, `year`, `analysis_sample` are legitimately shared across unrelated
analyses). If this looks like a bug: it is not. See
[docs/find-references.md](docs/find-references.md). Implementation:
`src/providers/references.ts::collect_references`.

### Infrastructure

**Server** (`src/server.ts`): Thin wrapper that starts the LSP server with Node
IPC transport for VS Code compatibility. Imports from `server-factory.ts`.

**Server Factory** (`src/server-factory.ts`): Core server implementation that
supports both stdio and Node IPC transports. Contains all provider initialization,
configuration loading, and LSP handler wiring.

**CLI** (`src/cli.ts`): Command-line interface for standalone usage. Parses
arguments (`--stdio`, `--node-ipc`, `--quiet`, `--help`, `--version`) and starts the server
with the appropriate transport. Default transport is stdio for standalone usage.

**Server Handlers** (`src/server-handlers.ts`): Factory functions for
`initialize`, `completion`, `hover`, `definition`, formatting, etc. (kept
separate from connection wiring for testability). Contains DEFAULT_SETTINGS for server configuration.

**Document Store** (`src/document-store.ts`): Manages open document state.
Stores tokens, AST, symbols, diagnostics, context ranges, and line offsets.
Includes LRU eviction and `wait_for_update(uri)` to avoid race conditions between
`didChange` processing and requests. Cross-file directive side effects
(backward-directive registration + indexer overlay) are transactional (#184):
staged during the parse and applied only after `commit_state`'s guards pass,
with a non-registering working-directory probe and a disk re-sync on close.
Maintainer invariant: discarded parses, failed parses, and stale close/dispose
races must not mutate shared cross-file state, so no stale edge is added and no
valid edge is dropped. Ancestor reads register **effective** directives for the
active mode: auto mode preserves dependency-graph parents for directive-less
files, explicit mode registers raw directives only, and standalone files have
empty effective backward directives. Because parse-cache entries vary by
working directory but backward registration is per URI, auto-mode cache hits for
directive-less files must re-sync registration instead of trusting a prior stamp;
memo serves do not register and rely on normal cache eviction/content changes to
refresh registrations.

**Debounce Manager** (`src/utils/debounce-manager.ts`): Batches rapid document
changes with backpressure handling and metrics.

**Workspace Config** (`src/config-file/`, `src/utils/config-validator.ts`):
`src/config-file/` discovers and loads the workspace-root project config
(`sight.toml`, the `PROJECT_CONFIG_FILE` in `src/config-file/types.ts`) via
`discovery.ts`/`toml-loader.ts`, and maps the public schema (README) into the
internal config shape with `schema.ts` (`map_public_config_to_partial_config`)
and `merge.ts`. `src/utils/config-validator.ts` validates the resolved
`StataLSPConfig` and applies default/fallback values.

**Indexer** (`src/indexer/`): Workspace-wide symbol indexing for cross-file
navigation. Scans `.do`, `.ado`, `.doh`, and `.mata` files, with size and
count limits.

**Command Database** (`src/command-database/`): Stores Stata command metadata
(syntax, abbreviations) loaded from pre-generated JSON caches.
Includes priority tiers for completion ordering and SMCL extractors for parsing
help files. Features:
- **Priority Tiers** (`priority-tiers.ts`): Commands categorized into 3 tiers for completion ordering
- **SMCL Extractor** (`smcl-extractor.ts`): Extracts command metadata from Stata help files
- **Command Info**: Name, syntax, minimum abbreviations, options, subcommands (for prefix commands), and priority
- **Abbreviation Mapping**: Fast lookup from abbreviations to full command names
- **Subcommands Metadata**: Dedicated subcommand lists for prefix commands (stored separately from options; e.g., `frame create`, `mi estimate`)

Used by completion and hover providers. The Commands module (src/commands/) provides
backward-compatible access to the command database and contains `BUILTIN_COMMANDS`
(hardcoded command metadata as fallback).

**Commands** (`src/commands/`): Command database and built-in commands for Stata.

### Formatting and Analysis

**Pretty Printer** (`src/pretty-printer/`): Converts AST back into formatted
Stata source (respects `#delimit` mode and preserves trivia). Used by the
formatter.

**Dual Formatter Architecture**: The LSP supports two formatter implementations:
- **Source-Preserving Formatter** (default): Preserves original source structure
  while applying formatting. Uses AST-based depth computation for accurate
  indentation levels. Best for maintaining code style consistency.
- **AST Formatter**: Rebuilds code from the AST using the Pretty Printer. May
  normalize certain constructs but preserves semantic meaning.

Both formatters require a valid AST for proper indentation depth computation.
The `IndentationDiagnosticAnalyzer` also uses AST-based depth analysis to detect
unnecessary and missing indentation issues.

The formatter mode is configurable via `formatting.mode` setting (`"source-preserving"`
or `"ast"`). Both formatters share common infrastructure for comment normalization
and embedded language block preservation.

**Formatter Testing Requirements**: All formatter tests MUST run against both
formatter implementations to ensure consistent behavior. Use the dual-mode test
helpers in `tests/property/helpers/formatter-test-utils.ts`:
- `for_each_formatter_mode()` - Runs a unit test for each formatter mode
- `for_each_formatter_mode_property()` - Runs a property test for each mode
- `create_formatter_config(mode)` - Creates config for a specific mode
- `skip_for_mode()` / `mode_specific_assertion()` - Handle mode-specific behavior

Example usage:
```typescript
import { for_each_formatter_mode_property, create_formatter_config } from './helpers/formatter-test-utils';

for_each_formatter_mode_property(
    'should preserve tokens',
    fc.constantFrom('display "hello"', 'gen x = 1'),
    (mode, source) => {
        const config = create_formatter_config(mode);
        // ... test logic
    }
);
```

**Comment Processor** (`src/comment-processor/`): Comment analysis and
transformations (comment-style normalization + toggle helpers). Includes:
- **comment-analysis.ts**: Data models and helper functions for analyzing and classifying comments
- **comment-processor.ts**: Core comment processing logic and transformations  
- **comment-toggle.ts**: Comment-style toggle functionality
- **code-generator.ts**: Code snippet generation (templates, documentation, TODO comments)

**SMCL Parser** (`src/smcl-parser/`): Parses Stata Markup Control Language
(SMCL) help files to provide formatted documentation for hover and completion.
Includes extractors for cross-references, options, stored results, and syntax
extraction, plus a tokenizer and pretty-printer.

**Extractors** (`src/smcl-parser/extractors/`): Specialized modules for parsing
different types of SMCL content:
- `cross-reference-extractor.ts` - Cross-reference parsing
- `option-extractor.ts` - Command option parsing
- `stored-results-extractor.ts` - Stored results parsing  
- `syntax-extractor.ts` - Command syntax extraction

### Client Extension

**Client Extension** (`client/`): VS Code extension that launches the bundled
server and wires up file watching. Includes:
- **quote-auto-close.ts**: Document change listener for Stata quote auto-closing
- **quote-auto-close-core.ts**: Core logic for computing quote auto-close actions
- **depth-colors.ts**: Automatic configuration of nesting depth colors

**Bundling Architecture**: The main project uses modern ESM (`"type": "module"`), but the VS Code extension bundles the server using CommonJS format (`--format=cjs`) due to `vscode-languageserver` dependency limitations. The LSP library uses dynamic `require()` calls for Node.js built-ins that are incompatible with ESM bundling. This hybrid approach maintains modern architecture while ensuring VS Code compatibility.

**Quote Auto-Close** (`client/src/quote-auto-close.ts`, `client/src/quote-auto-close-core.ts`):
Implements intelligent auto-closing for Stata's unique quoting conventions. Uses
`onDidChangeTextDocument` listener (not `type` command interceptor) to avoid
conflicts with other extensions. Features:
- Local macro: `` ` `` → `` `|' ``
- Nested local macro: `` `` `` → `` ``|'' ``
- Compound string: `` `" `` → `` `"|"' ``
- Standalone double quote: `"` → `"|"`
- Skip-over behavior: typing closing characters (`'`, `"`) skips over existing
  auto-inserted closers instead of duplicating them

**Send to Stata Module** (`client/src/send-to-stata/`): Provides commands to execute Stata code from VS Code in either the Stata GUI (macOS) or terminal sessions.

**Core Components:**
- **commands.ts**: Main command handlers for all send operations. Coordinates statement detection, temp file creation, working directory resolution, cursor advancement, and execution (AppleScript or terminal). Implements the 4 send modes (statement, upward, downward, file) × 2 execution commands (do, include) × 2 targets (app, terminal) = 16 command handlers.

- **statement-detector.ts**: Detects complete Stata statements including multi-line statements with `///` continuation markers. Searches backward/forward from cursor position to find statement boundaries.

- **applescript.ts**: Executes AppleScript commands to communicate with Stata GUI. Properly escapes backslashes and quotes for AppleScript string literals.

- **terminal.ts**: Sends commands to VS Code's active integrated terminal. Reveals terminal pane without stealing focus.

- **stata-detector.ts**: Auto-detects installed Stata variant on macOS by checking `/Applications/Stata/` and `/Applications/StataNow/` (the StataNow subscription channel) for StataMP, StataSE, StataBE, StataIC, or Stata (in priority order). Results are cached.

- **temp-file.ts**: Creates temporary `.do` files in system temp directory with unique names. Required to support `///` continuation markers which Stata only recognizes in do-files.

- **cursor-advance-core.ts**: Implements cursor advancement logic. Only activates for single-line sends (statement mode without selection). Positions cursor at column 0 of next line, clears selection, ensures visibility.

- **cd-commands.ts**: Executes manual CD commands to change Stata's working directory to workspace folder or file folder.

- **cd-context.ts**: Manages VS Code context variable `sight.cdMenuVisible` to control conditional menu item visibility based on `sight.sendToStata.workingDirectory` setting.

- **index.ts**: Module registration. Called from `extension.ts` to register all commands and set up configuration listeners.

**LSP Integration:**
The send-to-stata module integrates with the LSP server for working directory resolution:
- Custom LSP request: `sight/getWorkingDirectory` returns the working directory for a document URI
- Server handler: `server-handlers.ts` implements the custom request handler
- Working directory sources:
  - `@lsp-cd`, `@lsp-working-directory`, `@lsp-wd` directives in current file
  - Inherited from parent files via `@lsp-done-by` or `@lsp-included-by` directives
  - Returns `null` if no working directory is set

When `sight.sendToStata.workingDirectory` is set to "lsp" (default), commands query the LSP before execution and prepend `cd` commands as needed.

**Configuration Settings:**
- `sight.sendToStata.stataApp`: Override Stata variant name (macOS only)
- `sight.sendToStata.saveBeforeSend`: Auto-save before sending (default: true)
- `sight.sendToStata.advanceCursorOnSend`: Auto-advance cursor after single-line send (default: true)
- `sight.sendToStata.workingDirectory`: Working directory mode - "lsp" (default), "none", "file", or "workspace"

**Testing:**
Comprehensive test coverage including:
- Property tests (`tests/property/send-to-stata-*.prop.test.ts`):
  - AppleScript escaping (backslashes, quotes, special characters)
  - Statement detection (multi-line, continuations, edge cases)
  - Temp file creation
  - CD command formatting and path escaping
  - LSP working directory content transformation
  - LSP server responses
- Unit tests (`tests/unit/send-to-stata/cursor-advance.test.ts`):
  - Cursor advancement edge cases (last line, selection mode, file mode)
- Integration tests (`tests/integration/lsp-working-directory-option.test.ts`):
  - End-to-end LSP working directory resolution scenarios

### Utilities and Support

**Utilities** (`src/utils/`): Shared helpers for runtime and performance:
logging, LRU caches, parse timeouts, workspace config mapping/validation, and
file rename handling.

**Scripts** (`scripts/`): Build and maintenance tooling:
- `generate-cache.ts` - Command database cache generation from Stata SMCL files
- `bump-version.ts` - Package version bumping utility
- `build-binary.ts` - Bundled JS and native binary compilation

**Index Module** (`src/index.ts`): Barrel export file that re-exports all major modules for easy importing.

**Key Types** (`src/types/index.ts`):
- `Token`, `TokenType` - Lexer output
- `StataNode`, `StataAST` - Parser output
- `SymbolTable` - Analyzer output
- `Directive`, `CallSite`, `ResolvedScope` - Cross-file directive + resolved scope types
- `LanguageContext`, `ContextRange` - Language context tracking
- `LexerState` - Tracks delimiter mode and language context
- `SightConfig` - User configuration
- `CommandMetadata`, `CommandCache` - Command database structure
- `CrossFileConfig` - Cross-file resolution settings (includes `backward_dependencies: 'auto' | 'explicit'`)
- `CompletionRankingFactors` - Completion ordering logic
- `DocumentStoreMetrics`, `IndexerMetrics` - Performance/telemetry-friendly metrics snapshots

## Development Workflow

### Package Manager & Runtime

Use Bun instead of Node.js/npm:
- `bun install` instead of `npm install`
- `bun run <script>` instead of `npm run <script>`
- `bunx <package>` instead of `npx <package>`
- `bun <file>` instead of `node <file>`
- `bun test` instead of `jest`

### Testing

Tests are in `tests/`:
- `unit/` - Component-level tests
- `integration/` - Cross-component tests
- `property/` - Property-based tests (fast-check)
- `repro_issue.test.ts` - Issue reproduction test case

#### Property-test generator note (reserved keywords)

Stata treats `if` and `in` as qualifiers in many statement contexts, so generating them as "ordinary identifiers" can produce misleading property-test failures.

When you need an identifier that appears in varlist/expression positions and should *not* be parsed as a qualifier, prefer the shared helpers:
- `tests/property/generators/primitives.ts`: `arbitrary_non_reserved_identifier()` and `RESERVED_QUALIFIER_KEYWORDS`
- import via `tests/property/generators/index.ts` (from tests: `import { arbitrary_non_reserved_identifier } from './generators'`)

Run tests: `bun run test` (runs `bun run typecheck`, then `bun test`)

Some tests intentionally trigger error paths (e.g., missing parent files in
`ScopeResolver`) and suppress warnings by default.
To enable noisy test logs while debugging, set:
- `SIGHT_TEST_LOG=1`

### Reviewing changes before a PR

CI (`.github/workflows/ci.yml`) runs only `bun run typecheck` and `bun test`.
`bun run lint` (eslint) is NOT in CI — run it yourself before opening a PR, or
its warnings ship unnoticed:

```bash
bun run test   # typecheck + tests (the CI gate)
bun run lint   # eslint src client/src — NOT in CI, run manually
```

When reviewing a diff (human or LLM/agent review), these checks have repeatedly
caught real bugs that a logic-only read missed. Apply them in addition to "does
the new logic look right":

- **Replaced-primitive contract check.** When a change swaps one primitive for
  another (`existsSync` -> `readdirSync`+`Dirent`, sync -> async, one API for
  another), enumerate the OLD primitive's full contract and verify each property
  survives - not just the behavior you were targeting. Example that bit us:
  `existsSync` *follows symlinks*; `readdirSync` + `Dirent.isFile()/isDirectory()`
  does *not* (a symlink is neither), so swapping them silently dropped symlinked
  `do`/`include` resolution. List the old behavior; check each survives.
- **Sweep the whole pattern, not the instance.** When a fix establishes an
  invariant (e.g. "an `ambiguous` `PathCaseOutcome` must never fall through to a
  concrete path"), grep for ALL consumers of that type/function and verify each,
  rather than fixing only the call site in front of you. Multiple review rounds
  here each surfaced one more unswept instance of an already-"fixed" pattern.
- **Run at least one un-primed review pass.** Targeted review against a known
  list of invariants is efficient but confirmation-biased - it finds the failure
  modes you already suspect and misses orthogonal ones. Also review (or have a
  reviewer review) the diff cold, with no list of expected issues, asking "what
  could be wrong here that the author wasn't thinking about?"
- **When replacing existing behavior, spec what the old code did.** The design's
  "out of scope" list should be derived from the old code's actual contract, so
  dropping a capability (e.g. symlink support) shows up as an explicit, reviewed
  decision instead of a silent regression with no test.

### Version Bumping

Use the version bump script to update package versions and optionally commit, tag, and push:

```bash
# Bump version, commit, and tag (default)
bun scripts/bump-version.ts 0.1.19

# Also push commits and tags to remote
bun scripts/bump-version.ts 0.1.19 --push

# Only update version files, skip git operations
bun scripts/bump-version.ts 0.1.19 --no-git

# Use semantic versioning shortcuts
bun scripts/bump-version.ts patch    # 0.1.18 → 0.1.19
bun scripts/bump-version.ts minor    # 0.1.18 → 0.2.0
bun scripts/bump-version.ts major    # 0.1.18 → 1.0.0
```

The script updates both `package.json` and `client/package.json`, then optionally commits with message "Bump version to X.Y.Z", creates a git tag `vX.Y.Z`, and pushes.

### Command Cache Management

The LSP uses pre-generated JSON caches for Stata command metadata. Caches are
generated manually and committed to the repository.

**When to regenerate the cache:**
- When supporting a new Stata version
- When command metadata extraction logic changes
- When adding new commands to the database

**How to regenerate:**
```bash
# Generate cache for Stata 18 (requires Stata installation)
bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json

# Generate smaller test cache (50 commands)
bun scripts/generate-cache.ts 18 src/command-database/caches/test.json 50
```

Cache files live in `src/command-database/caches/` and should be committed.
The repository may include multiple cache variants (e.g., `v18.json`,
`v18-parallel.json`, `test.json`). See `src/command-database/README.md` for
details.

**Adding hardcoded options or subcommands to builtin-commands.ts:**
When adding options or subcommands to commands in `src/commands/builtin-commands.ts`, you must
also update the JSON cache files.

Notes:
- Options are stored under `commands.COMMAND.options`.
- Prefix-command subcommands are stored under `commands.COMMAND.subcommands`.

The cache generator applies hardcoded metadata as a fallback, but if the cache already exists, you need to either:
1. Regenerate the cache (may fail if command count shrinks), or
2. Manually update the cache JSON using `jq`.

Example (options):
```bash
cat src/command-database/caches/v18.json | jq '.commands.COMMAND.options = [
  {"name": "option1", "min_abbreviation": 3, "has_argument": false},
  {"name": "option2", "min_abbreviation": 4, "has_argument": true}
]' > /tmp/updated.json && mv /tmp/updated.json src/command-database/caches/v18.json
```

Example (subcommands):
```bash
cat src/command-database/caches/v18.json | jq '.commands.COMMAND.subcommands = [
  {"name": "sub1", "min_abbreviation": 3},
  {"name": "sub2", "min_abbreviation": 4}
]' > /tmp/updated.json && mv /tmp/updated.json src/command-database/caches/v18.json
```

**Note:** The TextMate grammar (`client/syntaxes/stata.tmLanguage.json`) is
manually maintained with a rich structure including nested depth highlighting,
categorized commands, Mata blocks, operators, and types. Regenerating the cache
does not affect the grammar.

## Code Style Guidelines

PREFER:
- Clear variable names with units (e.g., `age_years`, `income_usd`)
- Simple, readable code over clever optimizations

CORE RULES:
- Naming: match the existing file/module conventions. In this codebase, local
  variables often follow `snake_case` with `my_` / `the_` prefixes, while many
  exported APIs and class methods use `camelCase` (common TypeScript convention).
- snake_case for variables/functions (when adding new local helpers):
  `calculate_mean()`, `age_years`
- UPPER_SNAKE_CASE for constants: `MAX_ITERATIONS`
- Include units: `height_meters`, `time_seconds`, `age_years`
- Clear names over abbreviations: `temperature` > `temp` (common abbreviations
  like `avg` are OK)
- Loop variables: prefix iterators and scoped variables with `my_`, except
  single letters such as `i`, `j`, `k`
- Loop collections: use `the_` prefix for arrays/vectors that exist solely
  for iteration (e.g., `for (my_thing of the_things)`). Do not use `the_`
  for other variables.
- Array dimensions: underscores (`matrix_ij`)
- 4 spaces indentation (unless file uses 2 spaces), no tabs
- Space after commas: `func(a, b, c)`
- Space before opening parenthesis in control: `for (let i = 0; i < 10; i++)`
- 80 char line limit, 72 for comments

GOOD EXAMPLES:
```typescript
// Variable naming with units and clarity
const response_time_ms = measure_response(participant_id);
const avg_score = calculate_mean(test_scores);
const MAX_PARTICIPANTS = 100;

// Proper loop structure
for (const my_participant of the_participants) {
    const my_age_years = calculate_age(my_participant.birth_date);
    const my_scores = test_results[my_participant.id];
}

// Single letter exception
for (let i = 0; i < num_trials; i++) {
    const my_reaction_time_ms = the_trials[i].reaction_time_ms;
}

// Matrix operations
for (let i = 0; i < num_rows; i++) {
    for (let j = 0; j < num_cols; j++) {
        correlation_matrix_ij[i][j] = calculate_correlation(
            the_data[i],
            the_data[j]
        );
    }
}

// Variable creation with clear names
const household_income_annual_usd = wage_hourly_usd * hours_worked_weekly * 52;
const POVERTY_THRESHOLD_USD = 12880;

// Proper loop with my_ prefix
for (const my_state of the_states) {
    // Calculate statistics by state
    const my_unemployment_stats = summarize_unemployment_rate(
        data.filter(my_record => my_record.state === my_state)
    );
}

// Array operations and data handling
const the_exchange_rates_usd: number[] = new Array(5);
const the_countries = ["UK", "France", "Germany", "Japan", "Canada"];
const the_raw_exchange_rates_usd = [1.28, 1.08, 1.09, 0.0063, 0.73];
for (let i = 0; i < the_countries.length; i++) {
    the_exchange_rates_usd[i] = the_raw_exchange_rates_usd[i];
}
```

BAD EXAMPLES:
```typescript
// WRONG: wrong case, missing units
// Should be: const avg_age_years = calculate_mean(ages_years)
const avgAge = mean(ages);
for (const participant of participants)  // Should be: for (const my_participant of the_participants)

// WRONG: missing units, unclear naming
const distance = 5.2;  // Should be: const distance_kilometers = 5.2

// WRONG: missing my_ prefix and missing space before parenthesis
const keys = Object.keys(vars);  // Should be: const the_keys = Object.keys(variables);
for (const name of keys) {  // Should be: for (const my_name of the_keys) {
    // Should be: const my_variable = variables[my_name]
    const variable = vars[name];
}

// WRONG: missing units
const inc = wage * hours;  // Should be: const income_usd = wage_usd * hours

// WRONG: missing my_/the_ prefixes
for (const state of stateList)  // Should be: for (const my_state of the_states)
```

## Performance Patterns

Avoid common O(n²) patterns that degrade performance on large inputs.

### Array Lookups in Loops

**BAD** - O(n²) with `.some()`/`.includes()`/`.find()` inside loops:
```typescript
for (const my_item of the_items) {
    if (the_results.some(r => r.name === my_item.name)) continue;  // O(n) per iteration
    the_results.push(my_item);
}
```

**GOOD** - O(n) with Set for lookups:
```typescript
const seen_names = new Set<string>();
for (const my_item of the_items) {
    if (seen_names.has(my_item.name)) continue;  // O(1) per iteration
    seen_names.add(my_item.name);
    the_results.push(my_item);
}
```

### String Concatenation in Loops

**BAD** - O(n²) due to string immutability:
```typescript
let result = '';
for (const my_token of the_tokens) {
    result += my_token.value;  // Creates new string each iteration
}
```

**GOOD** - O(n) with array + join:
```typescript
const the_parts: string[] = [];
for (const my_token of the_tokens) {
    the_parts.push(my_token.value);
}
const result = the_parts.join('');
```

**GOOD** - O(n) with substring for character-by-character:
```typescript
const start_pos = this.position;
while (this.position < this.content.length && is_valid_char(this.content[this.position])) {
    this.position++;
}
const result = this.content.substring(start_pos, this.position);
```

### Regex in Loops

**BAD** - O(n) regex operations per iteration:
```typescript
for (const [my_placeholder, my_content] of the_placeholders) {
    text = text.replace(new RegExp(my_placeholder, 'g'), my_content);  // Full scan per placeholder
}
```

**GOOD** - Single regex with callback:
```typescript
text = text.replace(/__PLACEHOLDER_(\d+)__/g, (match, num) => {
    return the_placeholders.get(match) ?? match;
});
```

**BAD** - RegExp created inside function (called repeatedly):
```typescript
function extract_patterns(content: string) {
    const pattern = new RegExp(SOME_PATTERN.source, 'gi');  // Created every call
    // ...
}
```

**GOOD** - RegExp hoisted to module level:
```typescript
const SOME_REGEX = new RegExp(SOME_PATTERN.source, 'gi');

function extract_patterns(content: string) {
    SOME_REGEX.lastIndex = 0;  // Reset for global regex
    // ...
}
```

### Multiple Array Scans

**BAD** - Multiple passes over same array:
```typescript
const has_type_a = the_items.some(i => i.type === 'a');
const has_type_b = the_items.some(i => i.type === 'b');
const has_type_c = the_items.includes(some_item);
```

**GOOD** - Single pass with Set:
```typescript
const the_types = new Set(the_items.map(i => i.type));
const has_type_a = the_types.has('a');
const has_type_b = the_types.has('b');
```

## Type Safety

Leverage TypeScript's type system to catch errors at compile time rather than runtime.

### Avoid `any` Type

**BAD** - Using `any` defeats type checking:
```typescript
function process_node(node: any) {
    return node.name;  // No compile-time check if 'name' exists
}
```

**GOOD** - Use proper types or union types:
```typescript
function process_node(node: StataNode) {
    if (node.type === 'command') {
        return node.name;  // TypeScript knows 'name' exists on command nodes
    }
    return undefined;
}
```

### Type Guards Before Property Access

**BAD** - Accessing type-specific properties without checking:
```typescript
function get_name(node: StataNode) {
    return node.name;  // Error: 'name' doesn't exist on all StataNode types
}
```

**GOOD** - Check node type before accessing properties:
```typescript
function get_name(node: StataNode) {
    if (node.type === 'command' || node.type === 'program_definition') {
        return node.name;  // Safe: these types have 'name'
    }
    return undefined;
}
```

**GOOD** - Use type guard functions for reusable checks:
```typescript
function is_named_node(node: StataNode): node is CommandNode | ProgramDefinitionNode {
    return node.type === 'command' || node.type === 'program_definition';
}

function get_name(node: StataNode) {
    if (is_named_node(node)) {
        return node.name;  // TypeScript narrows the type
    }
    return undefined;
}
```

### Discriminated Unions

When working with AST nodes, use the `type` field as a discriminant:

```typescript
// The StataNode type is a discriminated union
switch (node.type) {
    case 'command':
        // TypeScript knows node is CommandNode here
        console.log(node.name, node.options);
        break;
    case 'macro_definition':
        // TypeScript knows node is MacroDefinitionNode here
        console.log(node.macro_name, node.value);
        break;
    case 'block':
        // TypeScript knows node is BlockNode here
        console.log(node.children);
        break;
}
```

### Optional Chaining for Uncertain Properties

**BAD** - Assuming properties exist:
```typescript
const value = node.options[0].value;  // Crashes if options is empty
```

**GOOD** - Use optional chaining:
```typescript
const value = node.options?.[0]?.value;  // Returns undefined if path doesn't exist
```
