---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - forward-scope-resolution: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

Forward calls (both directives and commands) in the current file are not being resolved for hover, completion, and diagnostics. Currently, the `ScopeResolver` only processes:
1. Backward directives (`@lsp-done-by`, `@lsp-included-by`) from the current file
2. Forward calls from **parent** files (before the call site where the current file is called)

However, forward calls FROM the current file should also bring symbols into scope after the call site. This applies to both:
- **Directives**: `@lsp-do`, `@lsp-run`, `@lsp-include` (comment-based)
- **Commands**: `do`, `run`, `include` (actual Stata commands)

For example:

```stata
// @lsp-include "helper.do"
display `helper_local'  // Should recognize helper_local from helper.do

include "utils.do"
display `util_local'    // Should also recognize util_local from utils.do
```

This is inconsistent with go-to-definition which does find symbols from workspace-indexed files.

## Glossary

- **Forward_Call**: A reference to a file to be executed, either via directive or command
- **Forward_Call_Directive**: A comment-based directive that references a file (`@lsp-do`, `@lsp-run`, `@lsp-include`)
- **Forward_Call_Command**: An actual Stata command that executes a file (`do`, `run`, `include`)
- **Backward_Directive**: A directive that indicates the current file is called by another file (`@lsp-done-by`, `@lsp-included-by`)
- **Scope_Resolver**: The component that resolves cross-file symbol scopes
- **Forward_Scope_Resolver**: The component that resolves symbols from forward call targets

## Requirements

### Requirement 1: Current File Forward Call Resolution

**User Story:** As a developer, I want forward calls (both directives and commands) in my current file to bring symbols into scope, so that I get accurate hover, completion, and diagnostics for symbols defined in included files.

#### Acceptance Criteria

1. WHEN a file contains `@lsp-include "path.do"` or `include "path.do"`, THE Scope_Resolver SHALL include local macros from the target file in the resolved scope (after the call site line)
2. WHEN a file contains `@lsp-do "path.do"`, `@lsp-run "path.do"`, `do "path.do"`, or `run "path.do"`, THE Scope_Resolver SHALL include non-local symbols (globals, programs, scalars, matrices, variables) from the target file in the resolved scope (after the call site line)
3. WHEN multiple forward calls (directives or commands) exist, THE Scope_Resolver SHALL process them in order and accumulate symbols
4. WHEN a forward call target file cannot be found, THE Scope_Resolver SHALL emit a diagnostic warning
5. THE Scope_Resolver SHALL treat `do` commands and `@lsp-do` directives equivalently for symbol inheritance
6. THE Scope_Resolver SHALL treat `run` commands and `@lsp-run` directives equivalently for symbol inheritance
7. THE Scope_Resolver SHALL treat `include` commands and `@lsp-include` directives equivalently for symbol inheritance

### Requirement 2: Position-Aware Symbol Visibility

**User Story:** As a developer, I want symbols from forward calls to only be visible after the call site line, so that the scope accurately reflects execution order.

#### Acceptance Criteria

1. WHEN hovering over a symbol reference BEFORE a forward call (directive or command), THE Hover_Provider SHALL NOT show symbols from that forward call target
2. WHEN hovering over a symbol reference AFTER a forward call (directive or command), THE Hover_Provider SHALL show symbols from that forward call target
3. THE Completion_Provider SHALL follow the same position-aware visibility rules as the Hover_Provider

### Requirement 3: Consistency with Go-to-Definition

**User Story:** As a developer, I want hover and go-to-definition to show consistent information, so that I'm not confused by different results.

#### Acceptance Criteria

1. WHEN go-to-definition finds a symbol from a forward call target, THE Hover_Provider SHALL also find and display that symbol
2. WHEN multiple symbols match (e.g., local macro and variable with same name), THE Hover_Provider SHALL display all matches (existing multi-symbol display behavior)

### Requirement 4: Duplicate File Handling

**User Story:** As a developer, I want the scope resolver to efficiently handle files that are referenced multiple times, so that symbols are correctly inherited without redundant processing.

#### Acceptance Criteria

1. WHEN a file is referenced via `do` or `run` and later via `include`, THE Forward_Scope_Resolver SHALL add only the local macros from the second reference (since non-locals were already added)
2. WHEN a file is referenced via `include` first, THE Forward_Scope_Resolver SHALL skip subsequent references to the same file (all symbols already included)
3. WHEN a file is referenced via `do` or `run` multiple times, THE Forward_Scope_Resolver SHALL skip subsequent references (non-locals already included)

### Requirement 5: Forward-Only Resolution

**User Story:** As a developer, I want forward scope resolution to only follow forward calls, not backward directives, so that the resolution is predictable and doesn't create unexpected dependencies.

#### Acceptance Criteria

1. WHEN resolving forward calls, THE Forward_Scope_Resolver SHALL NOT follow backward directives (`@lsp-done-by`, `@lsp-included-by`) in the target files
2. THE Forward_Scope_Resolver SHALL only extract symbols defined directly in the target file and its own forward calls
