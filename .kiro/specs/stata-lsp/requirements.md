---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - None
Status: Active
Related Specs:
  - None
---

# Requirements Document

## Introduction

This document specifies the requirements for a Stata Language Server Protocol (LSP) implementation that provides modern IDE features for Stata programming. The LSP will support `.do` files (do-files) and `.ado` files (ado-files), enabling features like auto-completion, diagnostics, hover documentation, and go-to-definition within editors that support the LSP standard, including the Kiro IDE, VS Code IDE, Antigravity IDE, and Kiro CLI.

## Glossary

- **Stata_LSP**: The language server implementation that processes Stata code and responds to LSP requests
- **Do_File**: A Stata script file with `.do` extension containing sequences of Stata commands
- **Ado_File**: A Stata program file with `.ado` extension containing reusable command definitions
- **Lexer**: The component that tokenizes Stata source code, handling delimiter modes, line continuations, and comment/string boundaries
- **Parser**: The component that analyzes the token stream and produces an Abstract Syntax Tree (AST)
- **Pretty_Printer**: The component that formats AST nodes back into valid Stata source code
- **Semantic_Analyzer**: The component that performs semantic analysis on the AST, including scope resolution, macro/variable tracking, and semantic diagnostics
- **Symbol_Table**: A data structure tracking all defined variables, macros, programs, and their locations
- **Diagnostic**: An error, warning, or information message about code issues
- **Workspace_Indexer**: The component that scans workspace and ado-path directories to index symbols from external files
- **Completion_Item**: A suggestion provided during auto-completion
- **Hover_Info**: Documentation or type information displayed when hovering over code elements
- **Document_Store**: The component that manages open document state and synchronization

## Requirements

### Requirement 1: LSP Server Initialization

**User Story:** As a developer, I want the Stata LSP to properly initialize and communicate with my editor, so that I can use language features in any LSP-compatible editor.

#### Acceptance Criteria

1. WHEN the editor sends an `initialize` request, THE Stata_LSP SHALL respond with server capabilities including completion, hover, definition, document symbols, workspace symbols, formatting, and document sync support (diagnostics are published separately, not advertised as a capability)
2. WHEN the editor sends an `initialized` notification, THE Stata_LSP SHALL complete startup and begin processing requests
3. WHEN the editor sends a `shutdown` request, THE Stata_LSP SHALL gracefully terminate all operations and release resources
4. WHEN the editor sends an `exit` notification after shutdown, THE Stata_LSP SHALL terminate the process with exit code 0
5. IF the Stata_LSP receives an `exit` notification without prior shutdown, THEN THE Stata_LSP SHALL terminate with exit code 1
6. IF the Stata_LSP receives a request before initialization, THEN THE Stata_LSP SHALL respond with an appropriate error

### Requirement 2: Document Synchronization

**User Story:** As a developer, I want the LSP to track my document changes in real-time, so that language features reflect my current code state.

#### Acceptance Criteria

1. WHEN the editor opens a `.do` or `.ado` file, THE Document_Store SHALL store the full document content and parse it
2. WHEN the editor sends incremental text changes, THE Document_Store SHALL apply changes and trigger re-parsing (v1: full document re-parse, debounced)
3. WHEN the editor closes a document, THE Document_Store SHALL remove the document from memory and clean up associated resources
4. THE Document_Store SHALL handle both full and incremental change event formats (server advertises incremental sync)

### Requirement 3: Stata Lexing and Tokenization

**User Story:** As a developer, I want the LSP to correctly tokenize Stata source code, so that parsing and analysis are accurate.

#### Acceptance Criteria

1. WHEN tokenizing a Stata file, THE Lexer SHALL track delimiter mode state (`#delimit cr` vs `#delimit ;`) and emit a unified STATEMENT_TERMINATOR token for statement boundaries
2. WHEN tokenizing a Stata file in `#delimit ;` mode, THE Lexer SHALL emit STATEMENT_TERMINATOR for semicolons and treat newlines as whitespace (trivia)
3. WHEN tokenizing a Stata file, THE Lexer SHALL handle `///` line continuations by joining the following line to the current statement while preserving the continuation as a CONTINUATION token (trivia)
4. WHEN tokenizing a Stata file, THE Lexer SHALL correctly identify and preserve all comment styles:
   - Line comments starting with `*` at the beginning of a line
   - Line comments starting with `//` anywhere on a line
   - Block comments delimited by `/* */`
   - Line continuation comments `///`
5. WHEN tokenizing a Stata file, THE Lexer SHALL correctly handle string boundaries for simple quotes (`"string"`), compound quotes (`` `"string"' ``), and the doubling escape convention (`""` within strings)
6. WHEN tokenizing a Stata file, THE Lexer SHALL produce tokens with precise source spans (start line/column, end line/column) for error reporting
7. WHEN a `#delimit` directive is encountered, THE Lexer SHALL update delimiter mode state for all subsequent tokens until the next `#delimit` directive

### Requirement 4: Stata Syntax Parsing

**User Story:** As a developer, I want the LSP to understand Stata syntax, so that it can provide accurate language features.

#### Acceptance Criteria

1. WHEN parsing a token stream, THE Parser SHALL recognize command structures including prefix commands (`by`, `quietly`, `capture`), main commands, variable lists, and options
2. WHEN parsing a token stream, THE Parser SHALL identify macro definitions (local and global) and their references
3. WHEN parsing a token stream, THE Parser SHALL recognize program definitions (`program define`) and their boundaries
4. WHEN parsing a token stream, THE Parser SHALL recognize control flow structures (`if`, `else`, `foreach`, `forvalues`, `while`)
5. WHEN parsing a token stream, THE Parser SHALL correctly associate comments with adjacent nodes as trivia
6. THE Pretty_Printer SHALL format AST nodes back into valid Stata source code
7. FOR ALL valid AST nodes, parsing then printing then parsing SHALL produce an equivalent AST (round-trip property), where equivalence is defined as identical node structure, token content, and trivia content, ignoring only source ranges (line/column positions)

### Requirement 5: Auto-Completion

**User Story:** As a developer, I want intelligent code completion suggestions, so that I can write Stata code faster and with fewer errors.

#### Acceptance Criteria

1. WHEN the user triggers completion, THE Stata_LSP SHALL provide suggestions for built-in Stata commands including both full names and valid abbreviated forms (e.g., `gen` for `generate`, `reg` for `regress`)
2. WHEN the user triggers completion after a command, THE Stata_LSP SHALL provide context-appropriate suggestions for options and subcommands
3. WHEN the user triggers completion, THE Stata_LSP SHALL suggest:
   - Programs from the current file and indexed workspace/ado-path files
   - Global macros from the current file and indexed workspace/ado-path files (if defined at file top-level)
   - Local macros from the current file only (per-execution-scope)
   - Variables from the current file only (dataset/runtime concept)
4. WHEN the user triggers completion inside a macro reference, THE Stata_LSP SHALL suggest defined local and global macros
5. WHEN providing completion items, THE Stata_LSP SHALL include documentation snippets where available
6. WHEN the AST is unavailable due to parse errors, THE Stata_LSP SHALL still provide command database completions as a fallback
7. WHEN the user types a backtick (`` ` ``), THE Stata_LSP SHALL offer a snippet completion that inserts a local macro reference template with the closing single quote (`'`)
8. WHEN the user types `` `" `` (compound quote opener), THE Stata_LSP SHALL offer a snippet completion that inserts the compound quote closer (`"'`)

### Requirement 6: Diagnostics

**User Story:** As a developer, I want to see syntax errors and warnings as I type, so that I can fix issues before running my code.

#### Acceptance Criteria

1. WHEN a document is opened or changed, THE Stata_LSP SHALL analyze the code and push diagnostics via `textDocument/publishDiagnostics`
2. WHEN the Lexer or Parser encounters a syntax error, THE Stata_LSP SHALL report the error with accurate line and column positions
3. WHEN the Semantic_Analyzer detects an undefined macro reference, THE Stata_LSP SHALL report a warning diagnostic (heuristic, may have false positives)
4. WHEN the Semantic_Analyzer detects a potentially undefined variable, THE Stata_LSP SHALL report an information diagnostic (heuristic, configurable, off by default)
5. WHEN diagnostics are published, THE Stata_LSP SHALL clear previous diagnostics for the same document
6. WHEN the Parser detects `} else {` or `} else if` on the same line, THE Stata_LSP SHALL report an error diagnostic indicating that closing braces and `else` keywords must be on separate lines
7. WHEN the Parser detects a block closing brace `}` that is not alone on its line (excluding comments), THE Stata_LSP SHALL report an error diagnostic (note: `${name}` macro braces are NOT block braces)
8. WHEN the Parser detects a `program define` without a matching `end`, THE Stata_LSP SHALL report an error diagnostic
9. WHEN the Lexer detects an unterminated statement in `#delimit ;` mode (EOF reached without a terminating semicolon), THE Stata_LSP SHALL report an error diagnostic
10. WHEN the Parser detects an unclosed block structure (`if`, `foreach`, `forvalues`, `while`), THE Stata_LSP SHALL report an error diagnostic
11. WHEN the Lexer detects unbalanced or malformed string quotes (including mismatched compound quotes `` `" "' ``), THE Stata_LSP SHALL report an error diagnostic
12. WHEN the Lexer detects a `///` line continuation without preceding whitespace, THE Stata_LSP SHALL report a warning diagnostic
13. WHEN the Semantic_Analyzer detects a local macro reference (`` `name' ``) that appears to be undefined in the current scope, THE Stata_LSP SHALL report a warning diagnostic (heuristic)
14. WHEN the Parser detects `forvalues` with incorrect syntax (e.g., using `in` instead of `=`), THE Stata_LSP SHALL report an error diagnostic
15. WHEN a `// @lsp-ignore-next` comment directive precedes a line, THE Stata_LSP SHALL suppress diagnostics for that line
16. WHEN a `// @lsp-variables var1 var2 ...` comment directive is present, THE Stata_LSP SHALL treat the listed names as known variables (for dataset context)

### Requirement 7: Hover Information

**User Story:** As a developer, I want to see documentation when I hover over commands and variables, so that I can understand code without leaving my editor.

#### Acceptance Criteria

1. WHEN the user hovers over a built-in Stata command, THE Stata_LSP SHALL display the command syntax and brief description
2. WHEN the user hovers over a user-defined macro, THE Stata_LSP SHALL display the macro's definition location and current value if determinable from static analysis
3. WHEN the user hovers over a user-defined program, THE Stata_LSP SHALL display the program's signature and location
4. WHEN the user hovers over a variable name, THE Stata_LSP SHALL display any available type or label information (best-effort: only for variables created via recognizable patterns like `gen`, `egen`, `input` in analyzed files; note: `tempvar` creates a macro, not a variable)

### Requirement 8: Go-to-Definition

**User Story:** As a developer, I want to navigate to where macros and programs are defined, so that I can understand and modify code efficiently.

#### Acceptance Criteria

1. WHEN the user requests go-to-definition on a local macro reference, THE Stata_LSP SHALL navigate to the macro's definition location within the current file only
2. WHEN the user requests go-to-definition on a global macro reference, THE Stata_LSP SHALL navigate to the macro's definition location (searching current file, then indexed workspace/ado-path files)
3. WHEN the user requests go-to-definition on a program call, THE Stata_LSP SHALL navigate to the program's definition (searching current file, then indexed workspace/ado-path files using Stata's resolution order)
4. WHEN the user requests go-to-definition on an included file reference (`do`, `run`, or `include` commands), THE Stata_LSP SHALL navigate to that file (resolving paths relative to the current file's directory)
5. IF the definition is not found, THEN THE Stata_LSP SHALL return an empty result without error

### Requirement 9: Symbol Information

**User Story:** As a developer, I want to see an outline of my Stata file and search for symbols, so that I can navigate large files efficiently.

#### Acceptance Criteria

1. WHEN the editor requests document symbols, THE Stata_LSP SHALL return a hierarchical list of programs, macros, and major sections
2. WHEN the editor requests workspace symbols with a query, THE Stata_LSP SHALL return matching symbols across all open documents and indexed workspace/ado-path files
3. WHEN returning symbols, THE Stata_LSP SHALL include symbol kind, name, and location information

### Requirement 10: Code Formatting

**User Story:** As a developer, I want to format my Stata code consistently, so that my code is readable and follows best practices.

#### Acceptance Criteria

1. WHEN the editor requests document formatting, THE Stata_LSP SHALL format the entire document according to configurable style rules
2. WHEN the editor requests range formatting, THE Stata_LSP SHALL format only the selected range
3. WHEN formatting, THE Stata_LSP SHALL preserve semantic meaning while adjusting only whitespace and indentation (no token normalization such as abbreviation expansion or quote style changes)
4. THE Stata_LSP SHALL support configurable formatting options including indent size and style preferences

### Requirement 11: Configuration

**User Story:** As a developer, I want to configure the LSP behavior, so that it matches my workflow and project requirements.

#### Acceptance Criteria

1. WHEN the editor sends `workspace/didChangeConfiguration` notification, THE Stata_LSP SHALL update its behavior accordingly
2. THE Stata_LSP SHALL support configuration for diagnostic severity levels (including ability to disable heuristic diagnostics like undefined variable warnings)
3. THE Stata_LSP SHALL support configuration for completion behavior (e.g., include abbreviations)
4. THE Stata_LSP SHALL support configuration for paths to search for ado-files (ado-paths)
5. THE Stata_LSP SHALL request configuration via `workspace/configuration` when needed

### Requirement 12: Workspace and Ado-Path Indexing

**User Story:** As a developer, I want the LSP to find symbols defined in other files in my workspace and ado-path directories, so that go-to-definition and completion work across my project.

#### Acceptance Criteria

1. WHEN the LSP initializes, THE Workspace_Indexer SHALL scan configured ado-paths and workspace directories for `.do` and `.ado` files
2. WHEN a file in the workspace or ado-path is created, modified, or deleted, THE Workspace_Indexer SHALL update the symbol index accordingly
3. WHEN resolving a program call, THE Workspace_Indexer SHALL follow Stata's resolution order: current directory, then PERSONAL, then PLUS, then SITE ado-paths (BASE commands are handled via the built-in command database)
4. THE Workspace_Indexer SHALL cache parsed symbol information to avoid re-parsing unchanged files
5. WHEN multiple files define the same program name, THE Workspace_Indexer SHALL track all definitions and resolve according to Stata's precedence rules

### Requirement 13: Client-Side Editor Configuration (VS Code / Kiro)

**User Story:** As a developer using VS Code or Kiro, I want bracket/quote auto-pairing and syntax highlighting to work correctly for Stata syntax, so that I can type and read code efficiently.

#### Acceptance Criteria

1. THE client extension SHALL configure auto-closing pairs for Stata's quote conventions: `` ` `` closes with `'`, `` `" `` closes with `"'`
2. THE client extension SHALL configure bracket auto-closing for `{`, `(`, `[`
3. THE client extension SHALL provide a TextMate grammar for basic syntax highlighting (keywords, comments, strings, macros) independent of the LSP
4. THE client extension SHALL register `.do` and `.ado` file extensions with the Stata language ID
