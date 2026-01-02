---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - working-directory-inheritance: [Core dependency]
  - working-directory-propagation: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature addresses two related issues with cross-file directive resolution in the Stata LSP:

1. **Working directory inheritance through directive chains**: When a file uses `@lsp-included-by` or `@lsp-done-by` directives to establish a parent chain, the working directory set via `@lsp-cd` (or synonyms) in an ancestor file should be inherited by all descendant files for path resolution in `do`/`run`/`include` commands.

2. **Diagnostic source attribution**: When a "Cannot read file" error occurs during cross-file resolution, the diagnostic should clearly indicate which file in the chain caused the error and report the line number relative to the active file (the file being edited), not the file where the error originated.

## Glossary

- **Scope_Resolver**: The component that follows backward directive chains (`@lsp-done-by`, `@lsp-included-by`) to build inherited symbol scope
- **Forward_Scope_Resolver**: The component that follows forward calls (`do`, `run`, `include` commands and directives) to build forward scope
- **Working_Directory**: The directory context used for resolving relative paths in `do`/`run`/`include` commands, set via `@lsp-cd` directive
- **Directive_Chain**: The sequence of files linked by `@lsp-done-by` or `@lsp-included-by` directives
- **Active_File**: The file currently being edited/analyzed in the IDE
- **Parent_File**: A file referenced by a backward directive (`@lsp-done-by` or `@lsp-included-by`)
- **Call_Site**: The line in a parent file where a child file is called via `do`/`run`/`include`

## Requirements

### Requirement 1: Working Directory Inheritance Through Backward Directive Chain

**User Story:** As a Stata developer, I want the working directory set in an ancestor file to be inherited through the directive chain, so that relative paths in `do`/`run`/`include` commands resolve correctly regardless of which file in the chain they appear in.

#### Acceptance Criteria

1. WHEN a file has `@lsp-done-by` or `@lsp-included-by` pointing to a parent file that has `@lsp-cd` directive, THEN the Scope_Resolver SHALL use that working directory for resolving forward call paths in the current file
2. WHEN a directive chain has multiple levels (e.g., A → B → C where C has `@lsp-cd`), THEN the Scope_Resolver SHALL inherit the working directory from the nearest ancestor that defines it
3. WHEN the current file has its own `@lsp-cd` directive, THEN the Scope_Resolver SHALL use the current file's working directory instead of any inherited one
4. WHEN resolving forward calls in a parent file during backward resolution, THEN the Forward_Scope_Resolver SHALL use the working directory context from that parent's chain

### Requirement 2: Working Directory Propagation to Forward Call Resolution

**User Story:** As a Stata developer, I want forward calls (`do`/`run`/`include` commands) in parent files to resolve paths using the correct working directory context, so that the LSP can find and analyze the referenced files.

#### Acceptance Criteria

1. WHEN the Scope_Resolver resolves forward calls in a parent file, THEN it SHALL pass the inherited working directory to the Forward_Scope_Resolver
2. WHEN the Forward_Scope_Resolver resolves a path, THEN it SHALL use the working directory context if available
3. WHEN a forward call path is relative and working directory is set, THEN the Forward_Scope_Resolver SHALL resolve the path relative to the working directory, not the script's directory

### Requirement 3: Diagnostic Source Attribution

**User Story:** As a Stata developer, I want "Cannot read file" errors to clearly indicate which file in the directive chain caused the error, so that I can understand and fix path resolution issues.

#### Acceptance Criteria

1. WHEN a "Cannot read file" error occurs in a parent file during backward resolution, THEN the diagnostic message SHALL include the source file name and line number where the error originated
2. WHEN a "Cannot read file" error occurs in a nested forward call, THEN the diagnostic message SHALL include the call chain showing how the error was reached
3. THE diagnostic message format SHALL be: "Cannot read file: {path}: {source_file} line {line_number}"

### Requirement 4: Diagnostic Line Number Mapping

**User Story:** As a Stata developer, I want error diagnostics to point to a meaningful location in the active file, so that I can navigate to the relevant directive that caused the issue.

#### Acceptance Criteria

1. WHEN a diagnostic originates from a parent file in the directive chain, THEN the diagnostic range SHALL point to the directive line in the Active_File that established the chain
2. WHEN multiple directives exist in the Active_File header, THEN the diagnostic SHALL point to the directive that led to the error (the first directive in the chain that reaches the problematic file)
3. IF the error occurs in a deeply nested chain, THEN the diagnostic SHALL point to the top-level directive in the Active_File

### Requirement 5: Path Resolution with Inherited Working Directory

**User Story:** As a Stata developer, I want relative paths in `do`/`run`/`include` commands to resolve correctly when a working directory is inherited from an ancestor file.

#### Acceptance Criteria

1. WHEN a relative path like `dhs/year_recodes` appears in a file with inherited working directory `../` (relative to the file's parent), THEN the path SHALL resolve relative to the inherited working directory
2. WHEN the inherited working directory is `../` and the current file is in `fertility_surveys/dhs/`, THEN paths like `dhs/wm_vars` SHALL resolve to `fertility_surveys/dhs/wm_vars.do`
3. WHEN a path cannot be found with the inherited working directory, THEN the diagnostic SHALL include the paths that were tried
