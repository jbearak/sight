---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - forward-scope-resolution: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature extends the Stata LSP's `c_local` support to work across files. Currently, when a user-defined program uses `c_local` to create local macros in the caller's scope, the LSP only recognizes these macros if the program is defined in the same file. When the program is defined in a separate file (e.g., an `.ado` file or a file loaded via `do`), the LSP emits false-positive "undefined macro" warnings for macros created by `c_local`.

The `c_local` command is a Stata mechanism that allows a program to create or modify local macros in the calling scope, rather than in the program's own scope. This is commonly used for returning values from user-defined programs.

## Glossary

- **Analyzer**: The semantic analysis component that builds symbol tables and detects undefined references
- **c_local**: A Stata command that creates/modifies a local macro in the caller's scope rather than the current scope
- **Caller_Scope**: The scope from which a program is invoked
- **Workspace_Indexer**: The component that indexes symbols across all files in the workspace
- **Forward_Scope_Resolver**: The component that resolves symbols from files called via `do`, `run`, or `include`
- **Scope_Resolver**: The component that resolves symbols from parent files via `@lsp-done-by` and `@lsp-included-by` directives

## Requirements

### Requirement 1: Workspace Program c_local Recognition

**User Story:** As a Stata developer, I want the LSP to recognize `c_local` macros from programs defined in other workspace files, so that I don't get false-positive undefined macro warnings when calling those programs.

#### Acceptance Criteria

1. WHEN the Analyzer processes a command that matches a program name in the Workspace_Indexer, THE Analyzer SHALL check if that program has `c_locals` defined
2. WHEN a workspace-indexed program has `c_locals`, THE Analyzer SHALL register those macro names in the Caller_Scope
3. WHEN a macro created by `c_local` from a workspace program is referenced, THE Analyzer SHALL NOT emit an undefined macro warning
4. THE Analyzer SHALL preserve the existing behavior for programs defined in the same file

### Requirement 2: Forward Scope c_local Inheritance

**User Story:** As a Stata developer, I want `c_local` macros from programs in files loaded via `do`/`run`/`include` to be recognized, so that the LSP understands my project's program library.

#### Acceptance Criteria

1. WHEN the Forward_Scope_Resolver processes a called file containing program definitions with `c_locals`, THE Forward_Scope_Resolver SHALL include those programs with their `c_locals` in the resolved scope
2. WHEN a program from a forward-resolved file is called, THE Analyzer SHALL register the program's `c_locals` in the Caller_Scope
3. THE Forward_Scope_Resolver SHALL preserve `c_locals` metadata when merging program symbols from multiple files

### Requirement 3: Backward Directive c_local Inheritance

**User Story:** As a Stata developer using `@lsp-done-by` or `@lsp-included-by` directives, I want `c_local` macros from programs in parent files to be recognized.

#### Acceptance Criteria

1. WHEN the Scope_Resolver processes a parent file containing program definitions with `c_locals`, THE Scope_Resolver SHALL include those programs with their `c_locals` in the resolved scope
2. WHEN a program from a backward-resolved file is called, THE Analyzer SHALL register the program's `c_locals` in the Caller_Scope
3. THE Scope_Resolver SHALL preserve `c_locals` metadata when merging program symbols from the inheritance chain

### Requirement 4: c_local Definition Position Tracking

**User Story:** As a Stata developer, I want `c_local` macros to be available only after the program call that creates them, so that forward reference detection works correctly.

#### Acceptance Criteria

1. WHEN a program with `c_locals` is called, THE Analyzer SHALL assign the `c_local` macros a definition position at the call site
2. WHEN a `c_local` macro is referenced before the program call that creates it, THE Analyzer SHALL emit a forward reference warning
3. WHEN a `c_local` macro is referenced after the program call that creates it, THE Analyzer SHALL NOT emit an undefined macro warning

### Requirement 5: Analyzer Workspace Symbol Access

**User Story:** As a system maintainer, I want the Analyzer to have access to workspace-indexed symbols during analysis, so that cross-file `c_local` support can be implemented cleanly.

#### Acceptance Criteria

1. THE Analyzer SHALL accept an optional workspace symbol table parameter during analysis
2. WHEN workspace symbols are provided, THE Analyzer SHALL use them to look up program definitions not found in the current file
3. WHEN workspace symbols are not provided, THE Analyzer SHALL fall back to current-file-only behavior
4. THE Analyzer interface change SHALL be backward compatible with existing callers
