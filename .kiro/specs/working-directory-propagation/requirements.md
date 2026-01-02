---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - working-directory-inheritance: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature addresses two related issues with the `@lsp-working-directory` directive (and its synonyms `@lsp-cd`, etc.) when used with forward scope resolution:

1. **Working Directory Propagation**: When a parent file specifies a working directory via `@lsp-cd`, this context should be propagated to nested files during forward scope resolution. Currently, nested files resolve their paths relative to their own location, ignoring the parent's working directory context.

2. **Diagnostic Line Number Accuracy**: When forward scope resolution encounters errors in nested files (e.g., "Cannot read file"), the diagnostics should either be mapped back to the parent file's call site or clearly indicate they originate from a different file. Currently, diagnostics from nested files use ranges from the nested file but are reported as if they belong to the root file, causing incorrect line numbers.

## Glossary

- **Working_Directory**: The directory context specified by `@lsp-cd` or equivalent directives, used for resolving relative paths in `do`, `run`, and `include` commands
- **Forward_Scope_Resolver**: The component that follows `do`, `run`, and `include` commands to inherit symbols from called files
- **Nested_File**: A file that is called via `do`, `run`, or `include` from another file during forward scope resolution
- **Parent_File**: The file that contains the `do`, `run`, or `include` command calling a nested file
- **Root_File**: The original file being analyzed, which may have multiple levels of nested file calls
- **Call_Site**: The location in a parent file where a `do`, `run`, or `include` command appears
- **Diagnostic_Range**: The line and character range associated with a diagnostic message

## Requirements

### Requirement 1: Propagate Working Directory to Nested Files

**User Story:** As a Stata developer, I want the working directory context from my parent script to be used when resolving paths in nested scripts, so that my project structure works correctly when scripts are executed from a common working directory.

#### Acceptance Criteria

1. WHEN a parent file has a working directory directive AND the Forward_Scope_Resolver processes a nested file THEN THE Forward_Scope_Resolver SHALL use the parent's working directory context for resolving paths in the nested file
2. WHEN a nested file has its own working directory directive THEN THE Forward_Scope_Resolver SHALL use the nested file's directive, overriding the inherited context
3. WHEN a nested file does not have a working directory directive THEN THE Forward_Scope_Resolver SHALL inherit the working directory context from the parent file
4. WHEN multiple levels of nesting exist THEN THE Forward_Scope_Resolver SHALL propagate the working directory context through all levels unless overridden by a nested file's own directive

### Requirement 2: Accurate Diagnostic Reporting for Nested Files

**User Story:** As a Stata developer, I want diagnostics from nested file resolution to clearly indicate their origin, so that I can locate and fix issues in the correct file.

#### Acceptance Criteria

1. WHEN a forward scope resolution error occurs in a nested file THEN THE diagnostic message SHALL include the nested file's path to indicate the error's origin
2. WHEN a "Cannot read file" error occurs in a nested file THEN THE diagnostic range SHALL point to the call site in the parent file that triggered the nested resolution
3. WHEN multiple levels of nesting exist THEN THE diagnostic SHALL indicate the full call chain (e.g., "parent.do -> child.do: Cannot read file: missing.do")
4. WHEN a diagnostic originates from a nested file THEN THE diagnostic message SHALL clearly distinguish it from diagnostics in the root file

### Requirement 3: Maintain Backward Compatibility

**User Story:** As a Stata developer, I want existing projects without working directory directives to continue working as before, so that I don't need to update all my scripts.

#### Acceptance Criteria

1. WHEN no working directory directive is present in any file in the call chain THEN THE Forward_Scope_Resolver SHALL use the existing fallback behavior (script-relative, then workspace-root-relative)
2. WHEN a parent file has no working directory directive but a nested file does THEN THE nested file's directive SHALL only affect that file and its descendants
3. THE existing behavior for single-file analysis (no nesting) SHALL remain unchanged
