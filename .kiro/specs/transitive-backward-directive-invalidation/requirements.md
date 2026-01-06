# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the cross-file directive chain invalidation system. When a file's interface changes (e.g., a global macro is removed), all files that transitively depend on it via backward directives (`@lsp-done-by`, `@lsp-included-by`) should have their diagnostics revalidated. Currently, only direct dependents are revalidated, leaving transitive dependents with stale diagnostics.

## Glossary

- **Backward_Directive**: A directive (`@lsp-done-by` or `@lsp-included-by`) that declares a file inherits symbols from a parent file
- **Directive_Chain**: A sequence of files linked by backward directives (e.g., a.do → b.do → c.do where b.do has `@lsp-done-by: a.do` and c.do has `@lsp-done-by: b.do`)
- **Interface_Hash**: A hash computed from a file's exported symbols (programs, globals, scalars, matrices, variables)
- **Resolved_Scope**: The complete symbol table for a file including inherited symbols from parent files
- **Transitive_Dependent**: A file that depends on another file through one or more intermediate files in a directive chain
- **Scope_Resolver**: The component responsible for resolving cross-file symbol inheritance

## Requirements

### Requirement 1: Transitive Backward Directive Invalidation

**User Story:** As a developer working with cross-file directive chains, I want diagnostics to update correctly in all files when I modify a symbol in a root file, so that I can see accurate undefined symbol warnings throughout the chain.

#### Acceptance Criteria

1. WHEN a file's interface changes (symbols added/removed/modified), THE Scope_Resolver SHALL invalidate the scope cache for all files that transitively depend on it via backward directives
2. WHEN a file's interface changes, THE Scope_Resolver SHALL trigger revalidation of all transitive backward directive dependents
3. WHEN file A changes and file B depends on A, and file C depends on B, THE Scope_Resolver SHALL revalidate both B and C
4. WHEN computing transitive dependents, THE Scope_Resolver SHALL detect and handle cycles to prevent infinite loops
5. WHEN computing transitive dependents, THE Scope_Resolver SHALL respect a configurable maximum chain depth

### Requirement 2: Resolved Interface Hash Computation

**User Story:** As a developer, I want the system to detect when a file's resolved interface (including inherited symbols) changes, so that dependent files are correctly revalidated.

#### Acceptance Criteria

1. WHEN determining if a file's interface changed, THE Scope_Resolver SHALL consider the resolved scope including inherited symbols from parent files
2. WHEN a parent file's interface changes, THE Scope_Resolver SHALL recognize that child files' resolved interfaces have also changed
3. WHEN a file has no backward directives, THE Scope_Resolver SHALL compute interface hash based only on its own symbols

### Requirement 3: Efficient Dependency Tracking

**User Story:** As a developer working with large projects, I want the invalidation system to be efficient, so that editing files doesn't cause excessive recomputation.

#### Acceptance Criteria

1. THE Scope_Resolver SHALL maintain a data structure that allows efficient lookup of transitive backward directive dependents
2. WHEN a file is parsed, THE Scope_Resolver SHALL update the backward directive dependency graph
3. WHEN a file is closed or deleted, THE Scope_Resolver SHALL remove it from the backward directive dependency graph
