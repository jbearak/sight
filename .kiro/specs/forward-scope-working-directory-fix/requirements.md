---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - forward-scope-resolution: [Core dependency]
  - working-directory-inheritance: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies requirements for fixing a bug in the forward scope resolution when triggered through backward scope resolution. The bug causes incorrect path resolution for forward calls (do/run/include commands) in parent files when the working directory is inherited from deeper ancestors in the directive chain.

## Glossary

- **Forward_Scope_Resolver**: The component that resolves symbols from files called via do/run/include commands
- **Scope_Resolver**: The component that resolves symbols from parent files via @lsp-done-by/@lsp-included-by directives
- **Working_Directory**: The directory context used to resolve relative paths in do/run/include commands, set via @lsp-working-directory directive
- **Backward_Resolution**: Following @lsp-done-by/@lsp-included-by directives to find parent files
- **Forward_Resolution**: Following do/run/include commands to find called files
- **Directive_Chain**: The sequence of parent files linked via backward directives

## Requirements

### Requirement 1: Working Directory Inheritance for Forward Calls

**User Story:** As a developer using cross-file directives, I want forward calls in parent files to use the correct working directory from the directive chain, so that relative paths resolve correctly regardless of where the parent file is located.

#### Acceptance Criteria

1. WHEN a parent file is parsed during backward resolution AND a deeper ancestor has a working directory THEN THE Scope_Resolver SHALL pass that working directory to the parser for resolving forward call paths
2. WHEN a parent file has its own @lsp-working-directory directive THEN THE Scope_Resolver SHALL use the parent's own working directory instead of the inherited one
3. WHEN resolving forward calls in a parent file THEN THE Forward_Scope_Resolver SHALL use the effective working directory from the directive chain
4. WHEN no working directory is set in the directive chain THEN THE Scope_Resolver SHALL fall back to script-relative path resolution

### Requirement 2: Two-Pass Resolution for Working Directory Discovery

**User Story:** As a developer, I want the scope resolver to discover the working directory from the full directive chain before resolving forward calls, so that all paths are resolved consistently.

#### Acceptance Criteria

1. WHEN following a directive chain THEN THE Scope_Resolver SHALL first recursively resolve deeper ancestors to discover the working directory
2. WHEN the working directory is discovered from deeper ancestors THEN THE Scope_Resolver SHALL re-parse the parent file with the correct working directory context
3. WHEN a parent file is already cached with a different working directory THEN THE Scope_Resolver SHALL use the cache key that includes the working directory

### Requirement 3: Correct Path Resolution in Nested Scenarios

**User Story:** As a developer with nested file structures, I want paths like "dhs/year_recodes" to resolve correctly when the working directory is set to a parent directory, so that I don't see "Cannot read file" errors with doubled path components.

#### Acceptance Criteria

1. WHEN a forward call path is "dhs/year_recodes" AND the working directory is "fertility_surveys/" AND the parent file is in "fertility_surveys/dhs/" THEN THE Forward_Scope_Resolver SHALL resolve to "fertility_surveys/dhs/year_recodes" (not "fertility_surveys/dhs/dhs/year_recodes")
2. WHEN displaying "Cannot read file" errors THEN THE Scope_Resolver SHALL show the correctly resolved path attempts
3. IF a forward call path cannot be resolved THEN THE Scope_Resolver SHALL emit a diagnostic with the tried paths

### Requirement 4: Cache Consistency with Working Directory

**User Story:** As a developer, I want the file cache to correctly handle files parsed with different working directory contexts, so that cached results are accurate.

#### Acceptance Criteria

1. WHEN caching a parsed file THEN THE Scope_Resolver SHALL include the working directory in the cache key
2. WHEN retrieving a cached file with a different working directory THEN THE Scope_Resolver SHALL treat it as a cache miss and re-parse
3. WHEN invalidating the cache for a file THEN THE Scope_Resolver SHALL invalidate all cache entries for that file regardless of working directory
