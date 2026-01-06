# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the forward call dependency invalidation system. When a file that is called via `do`/`run`/`include` changes, all files that transitively depend on the caller via backward directives should also be revalidated.

### Problem Description

**Example scenario:**
- `loop.do` calls `do "import_metadata.do"` (forward call)
- `loop.do` calls `do "survey.do"` (forward call)
- `survey.do` has `@lsp-done-by: loop.do` (backward directive)
- `bh_vars.do` has `@lsp-included-by: survey.do` (backward directive)
- `import_metadata.do` defines `global merp`
- `bh_vars.do` uses `$merp`

**Current behavior (buggy):**
1. `import_metadata.do` is edited (removes `global merp`)
2. `get_callers_for_callee(import_metadata.do)` returns `{loop.do}`
3. `loop.do` gets revalidated
4. `survey.do` and `bh_vars.do` are NOT revalidated
5. `bh_vars.do` still shows no "undefined macro" warning (stale)

**Expected behavior:**
1. `import_metadata.do` is edited (removes `global merp`)
2. `loop.do` gets revalidated (direct caller)
3. `survey.do` gets revalidated (depends on `loop.do` via backward directive)
4. `bh_vars.do` gets revalidated (depends on `survey.do` via backward directive)
5. `bh_vars.do` shows "undefined macro" warning for `$merp`

**Root cause:** When a callee changes, we revalidate direct callers, but we don't propagate the revalidation to files that depend on those callers via backward directives.

## Glossary

- **Forward_Call**: A `do`, `run`, or `include` command that executes another file
- **Backward_Directive**: A directive (`@lsp-done-by` or `@lsp-included-by`) that declares a file inherits symbols from a parent file
- **Caller**: A file that contains a forward call to another file (the callee)
- **Callee**: A file that is called by another file via a forward call
- **Transitive_Backward_Dependent**: A file that depends on another file through one or more backward directives

## Requirements

### Requirement 1: Propagate Callee Changes to Backward Directive Dependents

**User Story:** As a developer working with files that use both forward calls and backward directives, I want diagnostics to update correctly in all dependent files when I modify a file that is called via `do`/`run`/`include`, so that I can see accurate undefined symbol warnings throughout the dependency chain.

#### Acceptance Criteria

1. WHEN a callee file's interface changes, THE Server SHALL revalidate all files that transitively depend on the callers via backward directives
2. WHEN revalidating a caller due to a callee change, THE Server SHALL also schedule revalidation for all transitive backward directive dependents of that caller
3. WHEN a callee change affects multiple callers, THE Server SHALL propagate revalidation to backward directive dependents of all affected callers

### Requirement 2: Efficient Propagation

**User Story:** As a developer working with large projects, I want the propagation to be efficient, so that editing files doesn't cause excessive recomputation.

#### Acceptance Criteria

1. THE Server SHALL use the existing transitive backward directive lookup to find dependents
2. THE Server SHALL respect the existing revalidation limits when propagating to backward directive dependents
3. THE Server SHALL avoid duplicate revalidations when the same file is reachable through multiple paths

