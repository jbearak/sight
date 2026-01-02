---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - working-directory-inheritance: [Core dependency]
  - forward-scope-resolution: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature enhances the cross-file scope resolution system to follow forward calls (`do`, `run`, `include`) in parent files when resolving backward directives (`@lsp-done-by`, `@lsp-included-by`, `@lsp-run-by`). Currently, when a child file declares a parent via a backward directive, the LSP only inherits symbols defined directly in the parent file. However, in real Stata projects, parent files often execute other scripts (via `run`, `do`, or `include`) before calling the child file, and symbols defined in those executed scripts should be visible to the child.

For example, if `survey.do` has `@lsp-done-by loop.do`, and `loop.do` contains `run programs.do` before calling `survey.do`, then globals defined in `programs.do` should be visible in `survey.do`.

## Glossary

- **Scope_Resolver**: The component that resolves cross-file symbol scopes by following directive chains
- **Forward_Scope_Resolver**: The component that follows `do`, `run`, `include` commands to build forward scope
- **Backward_Directive**: Directives that declare parent files: `@lsp-done-by`, `@lsp-included-by`, `@lsp-run-by`
- **Forward_Call**: A `do`, `run`, or `include` command that executes another script file
- **Parent_File**: A file referenced by a backward directive that calls the current file
- **Child_File**: The current file that declares a parent via backward directives
- **Call_Site**: The line in the parent file where the child file is called
- **Pre_Call_Site_Forward_Calls**: Forward calls in the parent file that occur before the call site

## Requirements

### Requirement 1: Inherit Symbols from Parent's Forward Calls

**User Story:** As a developer, I want the LSP to recognize symbols defined in scripts that my parent file executes before calling my file, so that I don't get false "undefined macro" warnings for symbols that are actually available at runtime.

#### Acceptance Criteria

1. WHEN a child file has a backward directive AND the parent file contains forward calls (`do`, `run`, `include`) that occur before the call site, THEN THE Scope_Resolver SHALL follow those forward calls and include their symbols in the child's scope
2. WHEN a parent file has `run <script>` before the call site, THEN THE Scope_Resolver SHALL inherit globals, scalars, matrices, and programs from `<script>` (but NOT locals, per `run` semantics)
3. WHEN a parent file has `do <script>` before the call site, THEN THE Scope_Resolver SHALL inherit globals, scalars, matrices, and programs from `<script>` (but NOT locals, per `do` semantics)
4. WHEN a parent file has `include <script>` before the call site, THEN THE Scope_Resolver SHALL inherit ALL symbols from `<script>` including locals (per `include` semantics)
5. WHEN forward calls in the parent are nested (e.g., `run a.do` and `a.do` contains `run b.do`), THEN THE Scope_Resolver SHALL recursively follow the chain up to the configured max depth

### Requirement 2: Respect Call Site Ordering

**User Story:** As a developer, I want the LSP to only include symbols from scripts that are executed before my file is called, so that the scope accurately reflects what's available at runtime.

#### Acceptance Criteria

1. WHEN a forward call in the parent file occurs AFTER the call site where the child is called, THEN THE Scope_Resolver SHALL NOT include symbols from that forward call in the child's scope
2. WHEN multiple forward calls occur before the call site, THEN THE Scope_Resolver SHALL process them in order and accumulate symbols (later definitions shadow earlier ones)
3. WHEN the call site cannot be determined (no explicit `line=` or `match=` and inference fails), THEN THE Scope_Resolver SHALL use the configured `assume_call_site` setting (`start` or `end`) to determine which forward calls to include

### Requirement 3: Handle Effective Call Type Inheritance

**User Story:** As a developer, I want the LSP to correctly apply Stata's scoping rules when my parent file uses `do` or `run` to call intermediate scripts, so that local macros are correctly excluded from my scope.

#### Acceptance Criteria

1. WHEN the backward directive is `@lsp-done-by` or `@lsp-run-by`, THEN THE Scope_Resolver SHALL treat all forward calls in the parent as having effective type `do` (locals don't pass through)
2. WHEN the backward directive is `@lsp-included-by`, THEN THE Scope_Resolver SHALL preserve the original call type of each forward call in the parent
3. WHEN a forward call chain passes through a `do` or `run`, THEN THE Scope_Resolver SHALL exclude locals from all subsequent files in that chain

### Requirement 4: Cycle Detection and Depth Limiting

**User Story:** As a developer, I want the LSP to handle circular dependencies and deep call chains gracefully, so that the LSP doesn't hang or crash on complex projects.

#### Acceptance Criteria

1. WHEN following forward calls in parent files creates a cycle, THEN THE Scope_Resolver SHALL detect the cycle and emit a warning diagnostic
2. WHEN the combined depth of backward and forward resolution exceeds the configured max depth, THEN THE Scope_Resolver SHALL stop and emit a warning diagnostic
3. WHEN a forward call references a file that doesn't exist, THEN THE Scope_Resolver SHALL emit a warning diagnostic and continue processing other calls

### Requirement 5: Working Directory Context

**User Story:** As a developer, I want forward calls in parent files to be resolved using the correct working directory context, so that relative paths work correctly.

#### Acceptance Criteria

1. WHEN resolving forward calls in a parent file, THEN THE Scope_Resolver SHALL use the parent file's working directory context (from `@lsp-cd` or inherited)
2. WHEN a parent file has `@lsp-cd` directive, THEN THE Scope_Resolver SHALL resolve forward call paths relative to that working directory
3. WHEN a parent file inherits working directory from its own parent, THEN THE Scope_Resolver SHALL use the inherited working directory for resolving forward calls

