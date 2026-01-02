---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Marked as superseded by done-by-locals-bug due to incompatible inheritance rule changes
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Superseded
Superseded By: done-by-locals-bug
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
  - working-directory-propagation: [Related cross-file spec]
---

# Requirements Document

> **⚠️ SUPERSEDED SPECIFICATION**
> 
> This specification has been superseded by `done-by-locals-bug` due to incompatible changes in cross-file inheritance rules. The original specification incorrectly allowed `@lsp-done-by` directives to inherit local macros from parent files, which violated Stata's scope semantics. The corrected inheritance rules exclude local macros from `do` command inheritance, maintaining them only for `include` command inheritance.
> 
> **Migration:** Use the `done-by-locals-bug` specification for current cross-file inheritance behavior.

## Introduction

This specification defines cross-file awareness capabilities for the Stata LSP. The LSP provides intelligent code assistance including autocompletion, go-to-definition, diagnostics, and hover information for Stata do-files, ado-files, and related source files.

### The Cross-File Awareness Problem

Most LSPs face a fundamental tension between **recall** (knowing about all symbols that exist in a codebase) and **precision** (knowing which symbols are actually available in a given context).

Languages with explicit import statements (TypeScript, Python, Rust) solve this at the language level—the LSP reads the imports and knows exactly what's in scope. Languages with implicit scope inheritance (R scripts, Stata do-files, shell scripts) present a harder problem: the LSP must either index everything (high recall, low precision) or track execution chains (high precision, high complexity).

### Stata's Scope Model

Stata has two mechanisms for executing code from another file:

| Command   | Syntax                      | Scope Inheritance                                          |
| --------- | --------------------------- | ---------------------------------------------------------- |
| `include` | `include "path/to/file.do"` | Full: locals, globals, scalars, matrices, programs         |
| `do`      | `do "path/to/file.do"`      | Partial: globals, scalars, matrices, programs (NOT locals) |

This distinction is semantically meaningful and must be modeled by the LSP.

### The Directive Solution

Since Stata's `do` and `include` commands are executed at runtime, the LSP cannot determine scope chains through static analysis of the *caller*. However, if the *callee* declares its expected callers via directives, the LSP can build the scope chain by:

1. Parsing directives in the file being edited
2. Recursively following the declared parent chain
3. Accumulating symbols according to `do` vs `include` semantics
4. Presenting the unioned scope for autocompletion and diagnostics

This inverts the dependency declaration from caller→callee to callee→caller, which is stable and explicit.

## Glossary

- **LSP**: Language Server Protocol - the communication protocol between the editor and the language server
- **Symbol**: A named entity in Stata code (local, global, scalar, matrix, or program)
- **Local**: A macro scoped to the current file and files reached via `include`
- **Global**: A macro accessible across all files in the execution chain
- **Scalar**: A named numeric value accessible across all files
- **Matrix**: A named matrix accessible across all files
- **Program**: A user-defined command accessible across all files
- **Directive**: A comment-based annotation declaring file dependencies (`@lsp-done-by`, `@lsp-included-by`)
- **Scope_Chain**: The ordered list of parent files from which symbols are inherited
- **Call_Site**: The line in a parent file where the current file is executed
- **Workspace**: The root directory containing all project files
- **Index**: The in-memory database of all symbols discovered in the workspace

## Requirements

### Requirement 1: Symbol Parsing and Indexing

**User Story:** As a developer, I want the LSP to recognize and track all Stata symbol types, so that I can get accurate completions and navigation for my code.

#### Acceptance Criteria

1. WHEN a file contains `local <name>` followed by assignment or expression, THE LSP SHALL parse and index the local macro definition
2. WHEN a file contains `global <name>` followed by assignment or expression, THE LSP SHALL parse and index the global macro definition
3. WHEN a file contains `scalar <name> =`, THE LSP SHALL parse and index the scalar definition
4. WHEN a file contains `matrix <name> =` or `matrix define <name> =`, THE LSP SHALL parse and index the matrix definition
5. WHEN a file contains `program define <name>` through `end`, THE LSP SHALL parse and index the program definition with name and line range
6. THE LSP SHALL distinguish between symbol definition sites and symbol usage sites

#### Symbol Scope Reference

| Symbol Type | Scope                                      |
| ----------- | ------------------------------------------ |
| Local       | Current file + files reached via `include` |
| Global      | Current file + all called files            |
| Scalar      | Current file + all called files            |
| Matrix      | Current file + all called files            |
| Program     | Current file + all called files            |

### Requirement 2: Directive Parsing

**User Story:** As a developer, I want to declare which files call my current file, so that the LSP can determine the correct scope chain for symbol resolution.

#### Acceptance Criteria

1. WHEN a Stata comment line beginning with `*` or `//` contains `@lsp-done-by: "<path>"`, THE LSP SHALL recognize it as a directive declaring a parent file that calls via `do`
2. WHEN a Stata comment line beginning with `*` or `//` contains `@lsp-included-by: "<path>"`, THE LSP SHALL recognize it as a directive declaring a parent file that calls via `include`
3. WHEN a directive includes an optional `line=<number>` parameter, THE LSP SHALL use that line as the call site for scope resolution
4. WHEN a directive includes an optional `match="<string>"` parameter, THE LSP SHALL scan the parent file for the first occurrence of that string and use its line as the call site
5. WHEN both `line=` and `match=` parameters are present, THE LSP SHALL use `match=` (content-based is more resilient to edits)
6. THE LSP SHALL parse directives only from the top of the file, stopping at the first non-comment, non-blank line
7. WHEN multiple directives are present in a file, THE LSP SHALL process all directives and union their inherited scopes
8. WHEN both `@lsp-done-by` and `@lsp-included-by` reference the same parent file, THE LSP SHALL apply `@lsp-included-by` semantics (full inheritance including locals)
9. WHEN a directive contains a relative path, THE LSP SHALL resolve it relative to the directory containing the file with the directive
10. THE LSP SHALL normalize directive paths to handle `..`, `.`, and platform-specific separators
11. IF a directive references a file that does not exist, THEN THE LSP SHALL emit a diagnostic warning and continue processing other directives
12. IF a `match=` parameter string is not found in the parent file, THEN THE LSP SHALL emit a diagnostic warning and fall back to end-of-file assumption
13. THE LSP SHALL process directives recursively to build the complete scope chain from parent files
14. THE LSP SHALL maintain a set of processed files during recursive resolution to prevent infinite loops
15. IF a circular dependency is detected during directive resolution, THEN THE LSP SHALL emit a diagnostic warning including the cycle path, provide partial scope results from non-cyclic branches, and terminate recursion for that branch
11. The directive semantics are documented in README.md

#### Directive Semantics

| Directive          | Meaning                                   | Inherited Symbols                            |
| ------------------ | ----------------------------------------- | -------------------------------------------- |
| `@lsp-done-by`     | Parent file calls this file via `do`      | globals, scalars, matrices, programs         |
| `@lsp-included-by` | Parent file calls this file via `include` | locals, globals, scalars, matrices, programs |

**Extended Syntax with Call Site:**
```stata
* @lsp-done-by: "orchestrator.do" line=120
* @lsp-done-by: "orchestrator.do" match="do utils.do"
* @lsp-included-by: "utils.do" match="include helpers.do"
```

The `match=` parameter is preferred over `line=` as it is resilient to edits in the parent file.

#### Rationale

**Why top-of-file only?**
- Convention: metadata directives universally appear at file tops (shebangs, pragmas, encoding declarations)
- Efficiency: parser can stop scanning after first code line
- Semantics: directives describe file-level context, not section-level

**Why callee-declares-caller instead of caller-declares-callee?**
- The LSP operates on the file being edited; it needs to know "what scope do I have?"
- Parsing callers would require indexing the entire workspace and tracing all `do`/`include` calls
- Callee declaration is explicit and stable across refactoring

### Requirement 3: Scope Resolution

**User Story:** As a developer, I want the LSP to correctly determine which symbols are available in my current file based on the declared scope chain, so that I get accurate completions and diagnostics.

#### Acceptance Criteria

1. WHEN constructing scope for a file, THE LSP SHALL include all symbols defined in the current file
2. WHEN processing an `@lsp-included-by` directive, THE LSP SHALL include locals, globals, scalars, matrices, and programs from the parent file
3. WHEN processing an `@lsp-done-by` directive, THE LSP SHALL include globals, scalars, matrices, and programs from the parent file, but NOT locals
4. WHEN the LSP cannot determine the call site line in a parent file, THE LSP SHALL assume the call occurs at the end of the parent file
5. WHEN the LSP determines a call site line, THE LSP SHALL include only symbols defined on or before that line in the parent file
6. WHEN multiple parent files are declared, THE LSP SHALL union all inherited symbols
7. THE LSP SHALL apply scope inheritance rules transitively through the entire parent chain
8. WHEN a symbol is defined in both the current file and an ancestor file, THE LSP SHALL treat the current file's definition as shadowing the ancestor's definition
9. WHEN a symbol is defined in multiple ancestor files, THE LSP SHALL treat the nearer ancestor's definition as shadowing more distant ancestors

#### Rationale

**Why assume end-of-file when call site is unknown?**
- This is maximally permissive: all parent symbols are included
- May produce false positives (suggesting symbols not actually available)
- Will not produce false negatives (missing symbols that are actually available)
- Users can refine with explicit call site hints if false positives become problematic

### Requirement 4: Workspace Indexing

**User Story:** As a developer, I want the LSP to index all symbols in my workspace, so that I can search and navigate to any symbol regardless of the current file's scope chain.

#### Acceptance Criteria

1. WHEN a workspace is opened, THE LSP SHALL discover all files with extensions `.do`, `.ado`, `.doh`, and `.mata`
2. THE LSP SHALL parse discovered files to extract symbol definitions (programs, globals, scalars, matrices)
3. THE LSP SHALL store indexed symbols with their source file path and line number
4. WHEN the active document changes (textDocument/didChange), THE LSP SHALL re-parse that document and update its scope within 100ms (debounced)
5. WHEN a file is saved, THE LSP SHALL re-index that file for workspace-wide symbol search
6. WHEN a file is deleted, THE LSP SHALL remove its symbols from the index
7. WHEN a file is renamed, THE LSP SHALL update the index accordingly
8. THE LSP SHALL provide workspace symbol search across all indexed files
9. WHILE providing completion suggestions for a file with directives, THE LSP SHALL filter indexed symbols to only those reachable via the declared scope chain
10. WHILE providing completion suggestions for a file without directives, THE LSP SHALL include all indexed symbols

#### Rationale

**Why index everything but filter by directives?**
- Full indexing enables workspace symbol search and go-to-definition for any symbol
- Directive-based filtering provides precision for autocompletion
- Users without directives still get useful (if imprecise) suggestions
- The overhead of indexing is paid once; filtering is cheap

### Requirement 5: Autocompletion

**User Story:** As a developer, I want intelligent autocompletion that suggests symbols from my resolved scope, so that I can write code faster and with fewer errors.

#### Acceptance Criteria

1. WHEN the user triggers completion, THE LSP SHALL provide symbol suggestions from the resolved scope
2. THE LSP SHALL annotate completion items with their symbol type (local, global, scalar, matrix, program)
3. WHEN a symbol is from another file, THE LSP SHALL annotate the completion item with its source file
4. WHILE completing inside a program body, THE LSP SHALL include the program's formal arguments as local suggestions
5. THE LSP SHALL provide completion for Stata built-in commands and functions
6. THE LSP SHALL rank completion suggestions with locals from direct includes first, then globals from immediate parents, then symbols from distant ancestors

### Requirement 6: Go-to-Definition

**User Story:** As a developer, I want to navigate to symbol definitions across files, so that I can understand and modify code efficiently.

#### Acceptance Criteria

1. WHEN the user requests go-to-definition on a symbol, THE LSP SHALL navigate to the symbol's definition site
2. IF the symbol is defined in another file, THEN THE LSP SHALL open that file and navigate to the definition line
3. IF multiple definitions exist for a symbol, THEN THE LSP SHALL present all definitions and allow the user to choose
4. IF no definition is found for a symbol, THEN THE LSP SHALL report "Definition not found"

### Requirement 7: Hover Information

**User Story:** As a developer, I want to see information about symbols when I hover over them, so that I can understand code without navigating away.

#### Acceptance Criteria

1. WHEN the user hovers over a symbol, THE LSP SHALL display the symbol's type and definition site
2. WHEN the user hovers over a program name, THE LSP SHALL display the program's signature if determinable
3. WHEN the user hovers over a Stata built-in command, THE LSP SHALL display brief documentation

### Requirement 8: Diagnostics

**User Story:** As a developer, I want the LSP to warn me about potential issues with symbol references and directives, so that I can catch errors early.

#### Acceptance Criteria

1. THE LSP SHALL emit a warning diagnostic for references to undefined symbols
2. THE LSP SHALL emit an info diagnostic for symbols that are defined but potentially out of scope (defined after the inferred call site)
3. THE LSP SHALL emit a warning diagnostic for directive references to non-existent files
4. THE LSP SHALL emit a warning diagnostic for circular directive references, including the cycle path for debugging
5. WHILE a file has syntax errors that prevent parsing, THE LSP SHALL emit an error diagnostic at the error location
6. THE LSP SHALL support configurable diagnostic severity levels via configuration options

### Requirement 9: Document Symbols

**User Story:** As a developer, I want to see an outline of symbols in my current file, so that I can navigate within the file efficiently.

#### Acceptance Criteria

1. THE LSP SHALL provide a document symbol outline including all programs, globals, scalars, and matrices defined in the current file
2. THE LSP SHALL organize document symbols hierarchically where applicable (e.g., locals defined within a program nested under that program)

### Requirement 10: File Type Handling

**User Story:** As a developer, I want the LSP to handle all Stata-related file types appropriately, so that I get consistent behavior across my project.

#### Acceptance Criteria

1. THE LSP SHALL treat `.do`, `.ado`, and `.doh` files identically for parsing and indexing
2. THE LSP SHALL associate the Stata language ID with extensions `.do`, `.ado`, `.doh`, and `.mata`
3. IF a file has no extension but is opened with the Stata language ID, THEN THE LSP SHALL process it as a do-file
4. WHEN a `.mata` file is encountered, THE LSP SHALL index Mata function names without full body analysis (full Mata support is future scope)

#### Supported File Types

| Extension | Description              | Indexing Behavior                |
|-----------|--------------------------|----------------------------------|
| `.do`     | Do-file (script)         | Full indexing                    |
| `.ado`    | Ado-file (program def)   | Full indexing                    |
| `.doh`    | Do-file header           | Full indexing                    |
| `.mata`   | Mata source              | Index Mata functions (future)    |
| `.sthlp`  | Help file                | No indexing                      |
| `.smcl`   | SMCL log                 | No indexing                      |

### Requirement 11: Configuration

**User Story:** As a developer, I want to configure the LSP's cross-file behavior, so that I can tune it for my project's needs.

#### Acceptance Criteria

1. THE LSP SHALL read configuration from the LSP initialization options
2. THE LSP SHALL read configuration from a `.stata-lsp.json` file in the workspace root if present
3. WHERE both initialization options and file configuration exist, THE LSP SHALL give initialization options precedence
4. WHEN multiple `.stata-lsp.json` files exist in nested directories, THE LSP SHALL use only the workspace root configuration (per-folder configs are not supported)
5. WHEN `directivesRequired` configuration is true and a file has no directives, THE LSP SHALL not include cross-file symbols in completion
6. THE LSP SHALL support the following configuration options:
   - `stata.lsp.indexWorkspace` (boolean, default: true) - Enable workspace-wide file indexing
   - `stata.lsp.maxIndexedFiles` (number, default: 1000) - Maximum files to index
   - `stata.lsp.directivesRequired` (boolean, default: false) - Only provide cross-file symbols when directives are present
   - `stata.lsp.assumeCallSite` ("end" | "start", default: "end") - Where to assume call site when not determinable
   - `stata.lsp.diagnostics.undefinedSymbol` ("error" | "warning" | "info" | "off", default: "warning") - Severity for undefined symbol diagnostics
   - `stata.lsp.diagnostics.outOfScope` ("error" | "warning" | "info" | "off", default: "info") - Severity for out-of-scope symbol diagnostics
   - `stata.lsp.diagnostics.missingFile` ("error" | "warning" | "info" | "off", default: "warning") - Severity for missing directive file diagnostics
7. THE LSP SHALL document these configuration options in README.md
8. The README.md SHALL document the `.stata-lsp.json` file schema

### Requirement 12: Error Handling

**User Story:** As a developer, I want the LSP to handle errors gracefully, so that a single problematic file doesn't break the entire workspace.

#### Acceptance Criteria

1. IF a file cannot be parsed due to encoding errors, THEN THE LSP SHALL skip that file and log a warning
2. IF directive resolution encounters a file read error, THEN THE LSP SHALL emit a diagnostic and continue with available scope
3. IF the workspace contains more files than `maxIndexedFiles`, THEN THE LSP SHALL index up to the limit and log an info message
4. IF a circular dependency is detected during scope resolution, THEN THE LSP SHALL break the cycle, emit a diagnostic with the cycle path, provide partial scope results, and continue
5. THE LSP SHALL not crash due to malformed directives; it SHALL emit diagnostics and continue
6. WHEN a file is renamed while open in the editor, THE LSP SHALL update the index to reflect the new path
7. WHEN an atomic save creates a temporary file swap, THE LSP SHALL handle the rename sequence without losing index state

### Requirement 13: Performance

**User Story:** As a developer, I want the LSP to be responsive, so that it doesn't slow down my workflow.

#### Acceptance Criteria

1. THE LSP SHOULD complete initialization within 5 seconds for workspaces with fewer than 100 files
2. THE LSP SHOULD complete initialization within 30 seconds for workspaces with up to 1000 files
3. THE LSP SHOULD complete initialization within 120 seconds for workspaces with up to 5000 files
4. THE LSP SHOULD provide completion results within 200ms of user request
5. THE LSP SHOULD re-index a changed file within 500ms of save
6. THE LSP SHOULD maintain memory usage below 500MB for workspaces with up to 1000 files

#### Design Considerations

- **Lazy parsing:** The LSP should parse files on-demand where possible, with background indexing for workspace symbols
- **Caching:** Parsed ASTs and symbol tables should be cached and invalidated only on file change
- **Incremental updates:** When a file changes, only that file's symbols should be re-indexed, not the entire workspace

### Requirement 14: Testing

**User Story:** As a maintainer, I want comprehensive automated tests for cross-file awareness, so that I can verify correctness and prevent regressions.

#### Acceptance Criteria

1. THE implementation SHALL include unit tests for directive parsing covering valid syntax, malformed directives, and edge cases
2. THE implementation SHALL include integration tests for multi-file scope resolution with various directive configurations
3. THE implementation SHALL include property-based tests for cycle detection in directive graphs
4. THE implementation SHALL include property-based tests for scope resolution correctness (symbols from `include` vs `do` parents)
5. THE implementation SHALL include integration tests for workspace indexing lifecycle (add, modify, rename, delete files)

---

## Future Extensions

The following features are out of scope for the initial implementation but may be added later:

- **Mata support:** Full parsing and symbol tracking for Mata code blocks and `.mata` files
- **Call site inference:** Attempt to find `do`/`include` statements in parent files to determine actual call sites
- **Reverse directives:** `@lsp-does` and `@lsp-includes` in caller files for bidirectional declaration
- **Project files:** A `.stata-project` file that declares the file graph explicitly
- **Type inference:** Track the types/values of locals and globals where determinable
- **Refactoring:** Rename symbol across files

---

## Appendix A: Directive Grammar

```ebnf
directive-line   = comment-start ws* directive ws* newline
comment-start    = "*" | "//"
directive        = done-by | included-by
done-by          = "@lsp-done-by:" ws* path (ws+ call-site-param)*
included-by      = "@lsp-included-by:" ws* path (ws+ call-site-param)*
call-site-param  = line-param | match-param
line-param       = "line=" number
match-param      = "match=" quoted-string
path             = quoted-path | unquoted-path
quoted-path      = '"' path-chars '"'
quoted-string    = '"' string-chars '"'
unquoted-path    = path-chars
path-chars       = { any char except newline, ws, and ('"' if quoted) }
string-chars     = { any char except '"' and newline }
number           = digit+
ws               = " " | "\t"
```

## Appendix B: Example Usage

### B.1 Simple Two-File Project

**orchestrator.do:**
```stata
* Main analysis script

global DATA_PATH "/data/survey"
scalar YEAR = 2024

do "clean_data.do"
do "run_models.do"
```

**clean_data.do:**
```stata
* @lsp-done-by: "orchestrator.do" match="do \"clean_data.do\""
* 
* Cleans survey data

* LSP knows: $DATA_PATH (global), YEAR (scalar) - defined before the do call
* LSP does NOT know: any locals from orchestrator.do

use "$DATA_PATH/raw.dta", clear
keep if year == YEAR
```

### B.2 Included Utility File

**utils.do:**
```stata
* @lsp-included-by: "analysis.do"
*
* Shared utilities

local VERBOSE = 1

program define log_msg
    args msg
    if `VERBOSE' {
        display "`msg'"
    }
end
```

**analysis.do:**
```stata
* Main analysis

include "utils.do"

* LSP knows: `VERBOSE' (local), log_msg (program)
log_msg "Starting analysis"
```

### B.3 Multi-Parent File

**shared_config.do:**
```stata
* @lsp-done-by: "pipeline_a.do"
* @lsp-done-by: "pipeline_b.do"
*
* Shared configuration

* LSP unions scope from both parents
* If pipeline_a defines $PATH_A and pipeline_b defines $PATH_B,
* both are available here
```

---

## Appendix C: Revision History

| Version | Date       | Author                    | Changes                                      |
|---------|------------|---------------------------|----------------------------------------------|
| 0.1     | 2024-12-21 | Jonathan Bearak + Claude  | Initial draft                                |
| 0.2     | 2024-12-21 | Kiro                      | Reformatted to EARS pattern with user stories|
| 0.3     | 2024-12-21 | GPT-5.1-Codex-Max + Kiro  | Added call-site hints, completion ranking, diagnostic severity config, performance benchmarks, testing requirements |
| 0.4     | 2024-12-21 | Gemini 3 Pro + Kiro       | Added match= parameter for resilient call-site detection, on-change re-parsing, shadowing semantics |
