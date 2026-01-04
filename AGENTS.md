# Development Guidelines

## Overview

Sight is a Language Server Protocol (LSP) implementation for the Stata programming language, providing modern IDE features like semantic analysis, cross-file symbol resolution, and intelligent macro tracking. The LSP brings features like Go-to-Definition, Autocomplete, and Real-time Diagnostics to Stata development.

**Key Features:**
- Workspace-wide symbol resolution across `.do`, `.ado`, `.doh`, and `.mata` files
- Cross-file scope awareness through directive-based linking
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
- Command database lookups for completion/hover (user convenience)

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
and `global `option'` patterns that match syntax declarations).

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
warnings for cross-file symbols, the LSP automatically follows `do`, `run`, and
`include` commands in your code (via ForwardScopeResolver). You can also use
explicit directives (`@lsp-done-by`, `@lsp-included-by`, `@lsp-do`, `@lsp-run`,
`@lsp-include`) for cases where auto-detection doesn't work (e.g., dynamic paths
with macros).

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

**Scope Resolver** (`src/scope-resolver/`): Resolves cross-file scopes by
following directive chains (`@lsp-done-by`, `@lsp-included-by`). Features:
- Recursive resolution with cycle detection and a configurable max chain depth
- Two-level caching (file parse cache + resolved-scope cache) with hash-based validation and cascading invalidation
- Call-site filtering: only include parent symbols defined on/before the call site; collect out-of-scope symbols separately
- Inheritance rules:
  - `done-by` inherits non-local symbols (programs, globals, scalars, matrices, variables)
  - `included-by` inherits all symbols (including local macros)
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

### LSP Features

**Providers** (`src/providers/`): LSP feature implementations:
- `completion.ts` - Auto-complete for commands, options, macros, variables
- `completion/macro-completion.ts` - Specialized macro completion logic
- `definition.ts` - Go-to-definition for macros, programs, and included files
- `diagnostics.ts` - Error/warning reporting
- `formatter.ts` - Code formatting (PrettyPrinter + optional comment normalization; preserves embedded blocks)
- `hover.ts` - Hover information
- `symbols.ts` - Document/workspace symbols

**Completion Provider Architecture**: The completion provider (`src/providers/completion.ts`) determines symbols based on two modes:

1.  **Directive Mode** (when `@lsp-done-by` / `@lsp-included-by` are used):
    - Uses `ScopeResolver` to build a precise scope chain.
    - Symbols are inherited only from explicitly linked files.
    - Local macros are visible if inherited via `@lsp-included-by`.
    - The resolved scope applies call-site filtering (on/before call site) and
      emits additional directive diagnostics + out-of-scope symbol info.

2.  **Global Mode** (default):
    - Merges **Fresh Document Symbols** (in-memory) with **Workspace Symbols** (indexed from disk).
    - Workspace globals are visible in completions (but do NOT suppress undefined macro warnings in diagnostics).
    - Local macros are only visible from the current file.

Note: The workspace symbol index is used for completions, go-to-definition, and
workspace symbol search. It does NOT suppress undefined macro warnings - use
cross-file directives for that.

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
`didChange` processing and requests.

**Debounce Manager** (`src/utils/debounce-manager.ts`): Batches rapid document
changes with backpressure handling and metrics.

**Workspace Config** (`src/utils/workspace-config.ts`, `src/utils/config-validator.ts`):
Loads and validates `.sight.json` (workspace-root config) and maps the
public schema (README) into the internal config shape used by the server.
Provides validation and fallback logic for configuration settings.

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
- `CrossFileConfig` - Cross-file resolution settings
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
