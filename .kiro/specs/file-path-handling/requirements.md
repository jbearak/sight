---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - quoted-path-parsing: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies requirements for improving file path handling in the Stata LSP. Two issues are addressed:

1. **Unquoted Path Parsing**: The lexer tokenizes paths like `dhs/survey.do` as separate tokens (`dhs`, `/`, `survey`, `.`, `do`) because `/` is treated as an operator. This prevents the parser from capturing the full path in commands like `include dhs/survey.do`.

2. **Directive Path Completions**: When typing `@lsp-done-by:` or similar directives, the completion provider suggests variables instead of file paths, which is unhelpful since these directives accept file paths.

## Glossary

- **Lexer**: The `StataLexer` class that tokenizes Stata source code into tokens
- **Parser**: The `StataParser` class that builds an AST from tokens
- **Completion_Provider**: The component that provides auto-complete suggestions
- **File_Command**: Commands that accept file paths: `do`, `run`, `include`, `use`, `save`, `import`, `export`, `cd`, `adopath`
- **Path_Directive**: LSP directives that accept file paths: `@lsp-done-by`, `@lsp-included-by`, `@lsp-do`, `@lsp-run`, `@lsp-include`, `@lsp-working-directory`

## Requirements

### Requirement 1: Parse Unquoted File Paths

**User Story:** As a Stata developer, I want the LSP to correctly parse unquoted file paths in `do`, `run`, and `include` commands, so that cross-file features work without requiring quotes around paths.

#### Acceptance Criteria

1. WHEN a `do` command contains an unquoted path like `do dhs/survey.do`, THE Parser SHALL capture `dhs/survey.do` as a single varlist entry
2. WHEN a `run` command contains an unquoted path like `run scripts/helper.do`, THE Parser SHALL capture `scripts/helper.do` as a single varlist entry
3. WHEN an `include` command contains an unquoted path like `include lib/utils.do`, THE Parser SHALL capture `lib/utils.do` as a single varlist entry
4. WHEN a path contains multiple directory levels like `a/b/c/file.do`, THE Parser SHALL capture the entire path as a single entry
5. WHEN a path contains a file extension like `.do` or `.ado`, THE Parser SHALL include the extension in the captured path
6. WHEN a command has both a path and options like `do file.do, nostop`, THE Parser SHALL correctly separate the path from options
7. WHEN a filename contains special characters like commas or spaces, THE user SHALL use quoted paths (e.g., `do "file,name.do"`) as unquoted paths cannot contain these characters

### Requirement 2: Preserve Existing Path Behavior

**User Story:** As a Stata developer, I want existing path handling to continue working, so that no regressions are introduced.

#### Acceptance Criteria

1. WHEN a command uses a quoted path like `do "path/to/file.do"`, THE Parser SHALL continue to capture it correctly
2. WHEN a command uses a simple filename without path separators like `do myfile.do`, THE Parser SHALL continue to capture it correctly
3. WHEN a command uses macro references in paths like `do `mypath'/file.do`, THE Parser SHALL capture the macro reference and subsequent path components
4. WHEN `/` appears in an arithmetic expression like `gen x = a/b`, THE Lexer SHALL continue to treat it as division

### Requirement 3: File Path Completions for Directives

**User Story:** As a Stata developer, I want file path completions when typing `@lsp-done-by:` and similar directives, so that I can easily reference other files.

#### Acceptance Criteria

1. WHEN the cursor is after `@lsp-done-by:` in a comment, THE Completion_Provider SHALL suggest file paths instead of variables
2. WHEN the cursor is after `@lsp-included-by:` in a comment, THE Completion_Provider SHALL suggest file paths
3. WHEN the cursor is after `@lsp-do:` in a comment, THE Completion_Provider SHALL suggest file paths
4. WHEN the cursor is after `@lsp-run:` in a comment, THE Completion_Provider SHALL suggest file paths
5. WHEN the cursor is after `@lsp-include:` in a comment, THE Completion_Provider SHALL suggest file paths
6. WHEN the cursor is after `@lsp-working-directory:` in a comment, THE Completion_Provider SHALL suggest directory paths
7. WHEN suggesting file paths, THE Completion_Provider SHALL show `.do`, `.ado`, `.doh`, and `.mata` files
8. WHEN suggesting directory paths, THE Completion_Provider SHALL show directories only
9. WHEN a partial path is typed like `@lsp-done-by: "dhs/`, THE Completion_Provider SHALL suggest files within the `dhs` directory

### Requirement 4: File Path Completions for Commands

**User Story:** As a Stata developer, I want file path completions when typing file-accepting commands, so that I can easily reference files.

#### Acceptance Criteria

1. WHEN the cursor is after `do ` (with space), THE Completion_Provider SHALL suggest file paths
2. WHEN the cursor is after `run ` (with space), THE Completion_Provider SHALL suggest file paths
3. WHEN the cursor is after `include ` (with space), THE Completion_Provider SHALL suggest file paths
4. WHEN a partial path is typed like `do dhs/`, THE Completion_Provider SHALL suggest files within the `dhs` directory
5. WHEN suggesting paths for `do`/`run`/`include`, THE Completion_Provider SHALL prioritize `.do` files
