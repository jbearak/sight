# Requirements Document

## Introduction

This document specifies the requirements for fixing a cache invalidation bug in the forward scope resolver. When a callee file (e.g., `callee.do`) is edited, files that call it via `do`/`run`/`include` commands (e.g., `caller.do`) are not revalidated. This causes diagnostics in the caller file to become stale until the user manually edits the caller.

The backward directive case (`@lsp-done-by`/`@lsp-included-by`) already works correctly because the `backward_directive_children` map tracks parent→child dependencies and triggers revalidation when parents change. The forward call case needs similar reverse dependency tracking.

## Glossary

- **Forward_Scope_Resolver**: The component that resolves symbols from files called via `do`/`run`/`include` commands
- **Scope_Resolver**: The component that resolves symbols from parent files via backward directives (`@lsp-done-by`/`@lsp-included-by`)
- **Caller_File**: A file that executes another file via `do`/`run`/`include` commands
- **Callee_File**: A file that is executed by another file via `do`/`run`/`include` commands
- **Reverse_Dependency_Index**: A data structure tracking callee→caller relationships for cache invalidation
- **Interface_Hash**: A hash of a file's exported symbols used to detect meaningful changes
- **Revalidation**: The process of re-computing diagnostics for a file when its dependencies change

## Requirements

### Requirement 1: Track Forward Call Dependencies from Cached Files

**User Story:** As a developer, I want the LSP to track forward call dependencies even when files are only read from disk (not open in editor), so that callers are revalidated when callees change.

#### Acceptance Criteria

1. WHEN the Forward_Scope_Resolver reads a callee file from disk, THE Scope_Resolver SHALL register the caller→callee relationship in the callee_to_callers map
2. WHEN a file's forward calls are parsed during scope resolution, THE Scope_Resolver SHALL update the reverse dependency index with all static forward calls
3. WHEN a file is removed from the file cache, THE Scope_Resolver SHALL clear its forward call relationships from the reverse dependency index

### Requirement 2: Invalidate Caller Caches When Callee Changes

**User Story:** As a developer, I want caller files to be revalidated when I edit a callee file, so that I see up-to-date diagnostics without manually editing the caller.

#### Acceptance Criteria

1. WHEN a callee file's content changes (via didChange or file watcher), THE Scope_Resolver SHALL invalidate the scope cache for all files that call it via forward calls
2. WHEN a callee file's interface hash changes, THE Server SHALL schedule revalidation for all caller files that are open in the editor
3. WHEN the file cache is invalidated for a URI, THE Scope_Resolver SHALL also invalidate scope caches for all callers of that URI

### Requirement 3: Handle Transitive Dependencies

**User Story:** As a developer, I want transitive callers to be revalidated when a deeply nested callee changes, so that the entire call chain has up-to-date diagnostics.

#### Acceptance Criteria

1. WHEN a callee file changes, THE Scope_Resolver SHALL identify all transitive callers (files that call the callee directly or indirectly)
2. WHEN scheduling caller revalidation, THE Server SHALL include transitive callers up to the configured max_chain_depth
3. WHEN a caller is also a callee of another file, THE Scope_Resolver SHALL propagate invalidation to that file's callers

### Requirement 4: Limit Revalidation Scope

**User Story:** As a developer, I want revalidation to be bounded to prevent performance issues in large workspaces.

#### Acceptance Criteria

1. WHEN scheduling caller revalidation, THE Server SHALL respect the max_callee_revalidations configuration limit
2. WHEN the revalidation limit is reached, THE Server SHALL log a message indicating how many callers were skipped
3. WHEN prioritizing callers for revalidation, THE Server SHALL prefer open documents over closed documents

### Requirement 5: Maintain Consistency Between Caches

**User Story:** As a developer, I want the file cache and reverse dependency index to stay consistent, so that stale relationships don't cause incorrect behavior.

#### Acceptance Criteria

1. WHEN a file is added to the file cache, THE Scope_Resolver SHALL register its forward call relationships
2. WHEN a file is removed from the file cache, THE Scope_Resolver SHALL clear its forward call relationships
3. WHEN a file's forward calls change, THE Scope_Resolver SHALL update the reverse dependency index atomically (clear old, add new)
