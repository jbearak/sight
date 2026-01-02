---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - cross-file-awareness: [Core dependency]
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies fixes needed before merging the cross-file-awareness feature branch into main. The fixes address issues with directive detection logic, type safety, and logging practices.

## Glossary

- **Directive**: A comment annotation (`@lsp-done-by` or `@lsp-included-by`) that declares a relationship between Stata files for cross-file symbol resolution.
- **Scope_Resolver**: Component that follows directive chains to build complete symbol scope across files.
- **Completion_Provider**: Component that provides context-aware code completion suggestions.
- **StataLSPConfig**: Configuration object for the Stata LSP server.
- **Directive_Parser**: Component that parses directive annotations from file headers.

## Requirements

### Requirement 1: Correct Directive Presence Detection

**User Story:** As a developer, I want the completion provider to correctly detect whether a file has directives declared, so that the `directives_required` configuration option works correctly even when directive targets are missing.

#### Acceptance Criteria

1. WHEN checking for directive presence, THE Completion_Provider SHALL base the check on parsed directives from the Directive_Parser, not on whether parent files were successfully resolved into the scope chain.
2. WHEN a file has directives declared but the target files are missing, THE Completion_Provider SHALL still recognize that directives are present.
3. WHEN a file has no directives declared, THE Completion_Provider SHALL correctly identify the absence of directives.

### Requirement 2: Type Safety in Workspace Configuration

**User Story:** As a developer, I want the workspace configuration module to use proper TypeScript types, so that the codebase maintains type safety and avoids `any` types.

#### Acceptance Criteria

1. THE Workspace_Config module SHALL avoid using `any` type annotations.
2. THE `map_stata_lsp_json_to_partial_config` function SHALL return `Partial<StataLSPConfig>` instead of `any`.
3. THE `read_workspace_file_config_from_root` function SHALL return a properly typed result object.

### Requirement 3: Proper Logging in Scope Resolver

**User Story:** As a developer, I want the Scope Resolver to use proper logging through the LSP connection, so that log messages appear in the appropriate output channel rather than raw console output.

#### Acceptance Criteria

1. THE Scope_Resolver SHALL accept an optional logger interface for logging.
2. WHEN a logger is provided, THE Scope_Resolver SHALL route all log messages through the logger interface.
3. WHEN no logger is provided, THE Scope_Resolver SHALL fall back to console logging for backward compatibility.
4. THE Scope_Resolver SHALL NOT use raw `console.log` or `console.warn` when a logger is available.
