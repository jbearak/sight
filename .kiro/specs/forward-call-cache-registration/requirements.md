# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug where forward call relationships are only registered when files are opened in the editor. The fix ensures that forward call relationships are also registered when files are added to the file parse cache during scope resolution.

### Problem Description

The `callee_to_callers` map (which tracks which files call which other files via `do`/`run`/`include`) is only populated when files are opened in the editor via `update_reverse_dependencies()`. However, the file parse cache already contains intermediate files that were read from disk during scope resolution, including their forward calls.

**Example scenario:**
- `loop.do` calls `do "import_metadata.do"` and `do "survey.do"`
- `survey.do` has `@lsp-done-by: loop.do`
- `bh_vars.do` has `@lsp-included-by: survey.do`
- Only `bh_vars.do` and `import_metadata.do` are open in the editor

**Current behavior (buggy):**
1. `bh_vars.do` is opened → scope resolution reads `survey.do` and `loop.do` from disk
2. `loop.do` is cached with its forward calls (`import_metadata.do`, `survey.do`)
3. BUT: `callee_to_callers` is NOT updated (only happens when files are opened in editor)
4. `import_metadata.do` is edited (removes `global merp`)
5. `get_callers_for_callee(import_metadata.do)` returns empty set (loop.do not registered as caller)
6. `loop.do` is NOT revalidated → `bh_vars.do` is NOT revalidated → stale diagnostics

**Expected behavior:**
1. `bh_vars.do` is opened → scope resolution reads `survey.do` and `loop.do` from disk
2. `loop.do` is cached with its forward calls
3. Forward call relationships are registered: `import_metadata.do` ← `loop.do`, `survey.do` ← `loop.do`
4. `import_metadata.do` is edited
5. `get_callers_for_callee(import_metadata.do)` returns `{loop.do}`
6. `loop.do` is revalidated → backward directive dependents revalidated → `bh_vars.do` updated

## Glossary

- **Forward_Call**: A `do`, `run`, or `include` command that executes another file
- **Callee_To_Callers_Map**: The map tracking which files are called by which other files (`callee_uri → Set<caller_uri>`)
- **File_Parse_Cache**: The cache of parsed file content, populated when files are read from disk during scope resolution

## Requirements

### Requirement 1: Register Forward Call Relationships from Cache

**User Story:** As a developer working with files that use forward calls, I want the LSP to track caller relationships from cached files, so that editing a callee file triggers revalidation of all callers even when the callers are not open in the editor.

#### Acceptance Criteria

1. WHEN a file is parsed and added to the file parse cache, THE Scope_Resolver SHALL register its forward call relationships in the callee_to_callers map
2. WHEN a cached file has forward calls, THE Scope_Resolver SHALL register each callee → caller relationship
3. WHEN the file cache is invalidated for a file, THE Scope_Resolver SHALL also clear its forward call relationships from the map

### Requirement 2: Consistent Relationship Tracking

**User Story:** As a developer, I want the forward call relationships to be consistent between cached files and open files, so that revalidation works correctly regardless of which files are open.

#### Acceptance Criteria

1. THE Scope_Resolver SHALL maintain consistency between the file parse cache and the callee_to_callers map
2. WHEN a file is both cached and open in the editor, THE Scope_Resolver SHALL not create duplicate relationships

