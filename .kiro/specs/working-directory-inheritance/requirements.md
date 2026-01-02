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
  - working-directory-propagation: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature enhances the cross-file scope resolution system to automatically inherit the working directory context from parent files. When a file uses `@lsp-done-by` or `@lsp-included-by` directives to declare a parent file, and that parent file has an `@lsp-working-directory` (or synonym) directive, the child file should inherit that working directory context if it doesn't have its own. This eliminates the need to redundantly specify both `@lsp-done-by` and `@lsp-working-directory` when the parent already establishes the working directory.

Additionally, this feature adds `@lsp-run-by` as a synonym for `@lsp-done-by` to provide semantic clarity when a file is called via Stata's `run` command rather than `do`.

## Glossary

- **Scope_Resolver**: The component that resolves cross-file symbol scopes by following directive chains
- **Directive_Parser**: The component that parses `@lsp-*` directives from file headers
- **Working_Directory**: The directory context from which relative paths in `do`, `run`, and `include` commands are resolved
- **Working_Directory_Directive**: Any of the synonyms: `@lsp-working-directory`, `@lsp-working-dir`, `@lsp-current-directory`, `@lsp-current-dir`, `@lsp-cd`, `@lsp-wd`
- **Backward_Directive**: Directives that declare parent files: `@lsp-done-by`, `@lsp-included-by`, `@lsp-run-by`
- **Parent_File**: A file referenced by a backward directive that calls the current file
- **Child_File**: The current file that declares a parent via backward directives

## Requirements

### Requirement 1: Working Directory Inheritance from Parent Files

**User Story:** As a developer, I want child files to automatically inherit the working directory from their parent files, so that I don't have to redundantly specify both `@lsp-done-by` and `@lsp-working-directory` when the parent already establishes the working directory context.

#### Acceptance Criteria

1. WHEN a child file has a backward directive (`@lsp-done-by` or `@lsp-included-by`) AND the child file does NOT have its own working directory directive AND the parent file HAS a working directory directive, THEN THE Scope_Resolver SHALL use the parent's working directory for resolving paths in the child file
2. WHEN a child file has its own working directory directive, THEN THE Scope_Resolver SHALL use the child's working directory regardless of any parent's working directory
3. WHEN multiple parent files have working directory directives, THEN THE Scope_Resolver SHALL use the working directory from the nearest parent (smallest depth) following the same precedence rules as symbol inheritance
4. WHEN a parent file's working directory is inherited, THEN THE Scope_Resolver SHALL resolve the inherited path relative to the parent file's containing directory (not the child's)
5. WHEN following a directive chain recursively, THEN THE Scope_Resolver SHALL propagate the working directory through the chain until a file with its own working directory directive is encountered

### Requirement 2: @lsp-run-by Synonym for @lsp-done-by

**User Story:** As a developer, I want to use `@lsp-run-by` as a synonym for `@lsp-done-by`, so that I can semantically indicate when a file is called via Stata's `run` command rather than `do`.

#### Acceptance Criteria

1. WHEN a file header contains `@lsp-run-by: "<path>"`, THEN THE Directive_Parser SHALL parse it identically to `@lsp-done-by: "<path>"`
2. WHEN a file header contains `@lsp-run-by` without quotes (legacy form), THEN THE Directive_Parser SHALL also accept and parse the directive
3. WHEN `@lsp-run-by` is used, THEN THE Scope_Resolver SHALL apply the same inheritance rules as `@lsp-done-by` (inherits globals, scalars, matrices, programs; NOT locals)
4. WHEN `@lsp-run-by` is used with call-site parameters (`line=` or `match=`), THEN THE Directive_Parser SHALL parse them identically to `@lsp-done-by`

### Requirement 3: Documentation Updates

**User Story:** As a developer, I want the README documentation to explain working directory inheritance and the `@lsp-run-by` synonym, so that I can understand and use these features correctly.

#### Acceptance Criteria

1. THE README SHALL document that working directory is inherited from parent files when using backward directives
2. THE README SHALL document the precedence rules for working directory inheritance (child's own directive takes precedence, then nearest parent)
3. THE README SHALL document `@lsp-run-by` as a synonym for `@lsp-done-by` in the directives section
4. THE README SHALL provide an example showing working directory inheritance in action
