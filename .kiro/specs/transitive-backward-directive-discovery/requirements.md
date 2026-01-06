# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the transitive backward directive dependency discovery system. 

### Problem Description

The `backward_directive_children` map (which tracks `parent_uri → Set<child_uri>`) is only populated when files are **opened in the editor**. However, the file parse cache already contains intermediate files that were read from disk during scope resolution.

**Example scenario:**
- `loop.do` defines `global merp`
- `survey.do` has `@lsp-done-by: loop.do`
- `bh_vars.do` has `@lsp-included-by: survey.do` and uses `$merp`

When `bh_vars.do` is opened:
1. The system parses `bh_vars.do`, sees `@lsp-included-by: survey.do`
2. Registers `survey.do → bh_vars.do` in `backward_directive_children`
3. Reads `survey.do` from disk to resolve scope (caches it in file parse cache)
4. Sees `survey.do` has `@lsp-done-by: loop.do`, follows the chain
5. Reads `loop.do` from disk, finds `global merp`, scope resolution succeeds

**The bug:** When `loop.do` is edited (removing `global merp`):
1. `get_transitive_backward_directive_children(loop.do)` is called
2. It looks up `loop.do` in `backward_directive_children` → finds nothing (because `survey.do` was never opened in editor)
3. Returns empty set → `bh_vars.do` is not revalidated → stale diagnostics

**The fix:** The file parse cache already has `survey.do`'s parsed content (including its directives). When computing transitive dependents, we should use the cached directive information to discover that `survey.do` depends on `loop.do`, even though `survey.do` was never opened in the editor.

## Glossary

- **Backward_Directive**: A directive (`@lsp-done-by` or `@lsp-included-by`) that declares a file inherits symbols from a parent file
- **Directive_Chain**: A sequence of files linked by backward directives (e.g., a.do → b.do → c.do where b.do has `@lsp-done-by: a.do` and c.do has `@lsp-done-by: b.do`)
- **Backward_Directive_Children_Map**: The in-memory map (`parent_uri → Set<child_uri>`) tracking which files depend on which parents, populated only when files are opened in the editor
- **File_Parse_Cache**: The cache of parsed file content, populated when files are read from disk during scope resolution
- **Transitive_Dependent**: A file that depends on another file through one or more intermediate files in a directive chain
- **Scope_Resolver**: The component responsible for resolving cross-file symbol inheritance

## Requirements

### Requirement 1: Use Cached Directives for Transitive Discovery

**User Story:** As a developer working with cross-file directive chains, I want the LSP to discover all transitive dependents using cached file information, so that diagnostics update correctly throughout the entire chain even when intermediate files have not been opened in the editor.

#### Acceptance Criteria

1. WHEN computing transitive backward directive dependents, THE Scope_Resolver SHALL check the file parse cache for directive information from files not in the in-memory map
2. WHEN a cached file has backward directives pointing to the current parent, THE Scope_Resolver SHALL register that relationship and include the file in transitive dependents
3. WHEN traversing the dependency graph, THE Scope_Resolver SHALL use both the in-memory map and cached directive information
4. WHEN a file is not in the cache and not in the in-memory map, THE Scope_Resolver SHALL skip it (no new disk reads during transitive lookup)

### Requirement 2: Populate Backward Directive Map from Cache

**User Story:** As a developer, I want the backward directive relationships to be registered when files are read into the cache, so that the dependency graph is complete.

#### Acceptance Criteria

1. WHEN a file is parsed and added to the file parse cache, THE Scope_Resolver SHALL also register its backward directive dependencies in the map
2. WHEN the file cache is invalidated for a file, THE Scope_Resolver SHALL also clear its backward directive dependencies from the map
3. THE Scope_Resolver SHALL maintain consistency between the file parse cache and the backward directive map

