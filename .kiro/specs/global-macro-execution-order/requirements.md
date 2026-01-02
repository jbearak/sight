---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature addresses issues in how the Stata LSP handles global macro definitions across files, while also simplifying the implementation to reduce complexity and potential bugs.

### Current Problems

1. **Inconsistent Line Number Indexing**: The codebase mixes 0-indexed and 1-indexed line numbers, making the code confusing and error-prone.

2. **Inconsistent Diagnostic Message Format**: AST-based and token-based detection use different formats for global macro messages, and the symbol name extraction doesn't handle all formats.

3. **Missing Call Site Inference**: When a directive is used (e.g., `@lsp-done-by: "parent.do"`), the LSP should automatically find where in the parent file the current file is called. Currently, users must manually specify `match="do child.do"` or `line=N`.

4. **Confusing `directives_required` Setting**: The current implementation has a `directives_required` config option that creates inconsistent behavior between providers and is hard to reason about.

### Simplified Approach

1. Fix foundational issues first (line indexing, message formats)
2. Remove the `directives_required` setting entirely
3. Add automatic call site inference

The new behavior is straightforward:
- **With directives**: The LSP uses the directive chain to determine scope, with automatic call site inference
- **Without directives**: The LSP warns about undefined globals (unless suppressed with `@lsp-ignore`)

## Glossary

- **Semantic_Analyzer**: The component that builds symbol tables and detects undefined macro/variable references
- **Scope_Resolver**: The component that follows directive chains to build complete symbol scope across files
- **Workspace_Symbols**: Symbol table containing symbols from all indexed files in the workspace
- **Definition_Line**: The line number where a symbol is defined (0-indexed, per LSP convention)
- **Call_Site_Line**: The line in a parent file where a child file is executed/included (0-indexed, per LSP convention)
- **Forward_Reference**: A reference to a symbol that appears before the symbol's definition in execution order
- **Out_Of_Scope_Symbol**: A symbol defined in a parent file but after the call site, making it unavailable at the point of reference
- **Directive**: A comment annotation (`@lsp-done-by` or `@lsp-included-by`) that declares a parent file relationship
- **Call_Site_Inference**: Automatic detection of `do`/`include` statements in parent files to determine where the current file is called

## Requirements

### Requirement 1: Normalize Line Number Indexing (Foundation)

**User Story:** As a developer maintaining the LSP, I want consistent line number indexing throughout the codebase, so that I don't have to remember which functions use 0-indexed vs 1-indexed lines.

#### Acceptance Criteria

1. THE Scope_Resolver SHALL use 0-indexed line numbers consistently for all internal operations
2. THE `find_match_line` function SHALL return 0-indexed line numbers
3. THE `OutOfScopeSymbol.call_site_line` field SHALL use 0-indexed line numbers
4. WHEN displaying line numbers to users in diagnostic messages, THE LSP SHALL convert to 1-indexed for human readability
5. WHEN tests depend on line number indexing, THE LSP SHALL update those tests to use 0-indexed conventions

### Requirement 2: Fix Inconsistent Diagnostic Message Format (Foundation)

**User Story:** As a Stata developer, I want consistent and correct diagnostic message formats, so that the LSP correctly identifies symbol types and can extract symbol names for cross-file checking.

#### Acceptance Criteria

1. WHEN reporting an undefined local macro, THE Semantic_Analyzer SHALL use the format `Undefined local macro: \`name'` (with backticks, matching Stata's local macro syntax)
2. WHEN reporting an undefined global macro, THE Semantic_Analyzer SHALL use the format `Undefined global macro: $name` (with dollar sign, matching Stata's global macro syntax)
3. THE Diagnostics_Provider SHALL correctly extract symbol names from both local and global macro diagnostic messages
4. THE Diagnostics_Provider's symbol name extraction SHALL handle the `$name` format for globals (not just quoted formats)
5. THE AST-based and token-based diagnostic message formats SHALL be consistent for the same symbol type

### Requirement 3: Remove `directives_required` Configuration

**User Story:** As a Stata developer, I want simpler and more predictable LSP behavior, so that I can easily understand when and why I get warnings.

#### Acceptance Criteria

1. THE LSP SHALL remove the `directives_required` configuration option
2. THE LSP SHALL remove the `cross_file.directives_required` field from the configuration schema
3. WHEN a global macro is referenced AND no directive chain defines it, THEN THE Diagnostics_Provider SHALL report an undefined macro warning
4. THE user MAY suppress undefined macro warnings using `@lsp-ignore` or `@lsp-ignore-next` directives

### Requirement 4: Automatic Call Site Inference

**User Story:** As a Stata developer using directives, I want the LSP to automatically find where my file is called in the parent file, so that I don't have to manually specify `match=` or `line=` parameters.

#### Acceptance Criteria

1. WHEN a directive specifies a parent file without `match=` or `line=` parameters, THE Scope_Resolver SHALL scan the parent file for `do` or `include` statements that reference the current file
2. WHEN a `do "child.do"` or `include "child.do"` statement is found in the parent file, THE Scope_Resolver SHALL use that line as the call site
3. WHEN multiple `do`/`include` statements reference the current file, THE Scope_Resolver SHALL use the FIRST occurrence as the call site
4. IF no `do`/`include` statement is found for the current file, THEN THE Scope_Resolver SHALL fall back to the `assume_call_site` config (default: `'end'`)
5. WHEN the user explicitly specifies `match=` or `line=` parameters, THE Scope_Resolver SHALL use the explicit parameters instead of inference
6. WHEN matching call statements, THE Scope_Resolver SHALL handle both `do child` and `do child.do` formats (with or without `.do` suffix)

### Requirement 5: Preserve Directive-Based Execution Order Checking

**User Story:** As a Stata developer using directives, I want the LSP to check execution order for globals, so that I catch potential runtime errors.

#### Acceptance Criteria

1. WHEN a file has directives, THEN THE Scope_Resolver SHALL filter global macros by call site
2. WHEN a global macro is defined after the call site in a parent file, THEN THE Diagnostics_Provider SHALL report an out-of-scope warning
3. WHEN a global macro is defined before the call site in a parent file, THEN THE Diagnostics_Provider SHALL NOT report an undefined macro warning

### Requirement 6: Consistent Behavior Across Symbol Types

**User Story:** As a Stata developer, I want all symbol types (globals, locals, programs, variables, scalars, matrices) to behave consistently regarding cross-file resolution, so that I have predictable diagnostic behavior.

#### Acceptance Criteria

1. THE Scope_Resolver SHALL apply call site filtering to all symbol types consistently
2. THE Diagnostics_Provider SHALL report undefined symbol warnings for all symbol types consistently
3. THE user MAY suppress any undefined symbol warning using `@lsp-ignore` directives

### Requirement 7: Documentation Update

**User Story:** As a Stata developer, I want the README to accurately describe the LSP's behavior, so that I can understand how to use directives and cross-file features.

#### Acceptance Criteria

1. WHEN the simplified behavior is implemented, THE LSP SHALL update README.md to reflect the new directive behavior
2. THE README SHALL document the automatic call site inference feature
3. THE README SHALL document that `directives_required` has been removed
