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

This document specifies the requirements for unifying the two forward-call symbol feeds used in diagnostics. Currently, there are two separate code paths that compute forward-call symbols:

1. **Handler-supplied `forward_scope`**: Computed in `server-factory.ts` and `server-handlers.ts` by calling `ForwardScopeResolver.resolve()` directly, then passed as a parameter to `DiagnosticsProvider.publish_diagnostics()`.

2. **`resolved_scope.forward_call_symbols`**: Computed inside `ScopeResolver.resolve()` which internally calls `ForwardScopeResolver.resolve()` and stores the result in the `ResolvedScope` object.

Both paths use the same `ForwardScopeResolver` and produce equivalent results. The diagnostics provider currently checks BOTH sources, which is redundant. This split is historical - the handler path was added first, then `ScopeResolver` was enhanced to include forward calls, but the handler path was kept as a fallback.

The goal is to:
1. Remove the redundant handler-computed `forward_scope` when `scope_resolver` is available
2. Keep the handler path as a fallback for edge cases (no scope_resolver, cross-file disabled)
3. Ensure no regressions in any configuration

## Glossary

- **Forward_Call**: A `do`, `run`, or `include` command that executes another Stata file, or an `@lsp-do`, `@lsp-run`, `@lsp-include` directive
- **Forward_Call_Directive**: An `@lsp-do`, `@lsp-run`, or `@lsp-include` directive that declares a forward call relationship
- **Forward_Scope**: Symbols from files executed via forward calls, visible after the call site
- **Forward_Scope_Resolver**: Component that resolves forward calls (both commands and directives) and extracts symbols from callee files
- **Scope_Resolver**: Component that resolves cross-file scope chains via `@lsp-done-by`/`@lsp-included-by` directives
- **Resolved_Scope**: The result of `ScopeResolver.resolve()`, containing merged symbols and forward_call_symbols
- **Handler_Forward_Scope**: The `forward_scope` parameter computed in handlers and passed to providers
- **Diagnostics_Provider**: Component that aggregates and publishes diagnostics for a document
- **Auto_Detected_Forward_Call**: A forward call detected by parsing `do`, `run`, or `include` commands in the source code

## Requirements

### Requirement 1: Eliminate Duplicate Forward-Call Resolution

**User Story:** As a maintainer, I want to avoid computing forward-call symbols twice, so that the codebase is simpler, more efficient, and behavior is consistent.

#### Acceptance Criteria

1. WHEN `scope_resolver` is available, THE handlers SHALL NOT compute `forward_scope` separately (avoid duplicate `ForwardScopeResolver.resolve()` calls)
2. WHEN `scope_resolver` is available, THE Diagnostics_Provider SHALL use only `resolved_scope.forward_call_symbols` for forward-call symbol suppression
3. WHEN `scope_resolver` is NOT available, THE handlers SHALL compute `forward_scope` and pass it to Diagnostics_Provider as a fallback
4. WHEN `scope_resolver` is available, THE handler code that computes `forward_scope` SHALL be skipped (verifiable by code inspection or conditional logic)

### Requirement 2: Backward Compatibility for Edge Configurations

**User Story:** As a user with a non-standard configuration, I want diagnostics to work correctly even when scope_resolver is not available.

**Rationale:** The fallback path is kept for:
1. **Testing** - Unit and integration tests can pass `null` to test fallback behavior
2. **Defensive coding** - Safety measure in case initialization fails or is interrupted

Note: The `cross_file.index_workspace` setting only affects the workspace indexer, not the scope_resolver. The scope_resolver is always created during normal initialization.

#### Acceptance Criteria

1. IF `scope_resolver` is null or undefined, THEN THE Diagnostics_Provider SHALL fall back to handler-supplied `forward_scope` for symbol suppression
2. WHEN `forward_scope_resolver` is available but `scope_resolver` is not, THE system SHALL compute forward-call symbols via the handler path
3. THE fallback path SHALL produce the same symbol suppression behavior as the primary path

### Requirement 3: Forward Call Sources

**User Story:** As a user, I want both `@lsp-do`/`@lsp-run`/`@lsp-include` directives AND auto-detected `do`/`run`/`include` commands to suppress undefined-symbol warnings.

#### Acceptance Criteria

1. WHEN an `@lsp-do` or `@lsp-run` directive is present, THE system SHALL resolve the target file and extract non-local symbols
2. WHEN an `@lsp-include` directive is present, THE system SHALL resolve the target file and include local macros in the extracted symbols
3. WHEN a `do`, `run`, or `include` command is auto-detected, THE system SHALL resolve the target file and extract symbols
4. FOR ALL forward-call sources, THE symbols SHALL become visible after the call site line (not before)
5. WHEN the same file is referenced multiple times with the same effective type, THE system SHALL skip redundant resolution (action: 'skip')
6. WHEN the same file is referenced first as `do`/`run` then later as `include`, THE system SHALL add only local macros from cached result without re-parsing (action: 'add_locals_only')
7. FOR ALL forward-call results, THE data shape SHALL include: `callee_uri`, `call_line` (0-indexed), `symbols` (SymbolTable), and `effective_type` ('do' | 'include')

### Requirement 4: Working Directory Handling

**User Story:** As a user with relative paths in my do-files, I want forward-call resolution to respect working directory settings regardless of which code path is used.

#### Acceptance Criteria

1. WHEN resolving forward calls via `resolved_scope`, THE Scope_Resolver SHALL pass the inherited working directory to Forward_Scope_Resolver
2. WHEN resolving forward calls via handler path, THE handler SHALL pass `document_state.working_directory` to Forward_Scope_Resolver
3. FOR ALL forward-call resolutions, THE resolved paths SHALL be consistent regardless of which code path is used

### Requirement 5: Position-Aware Symbol Visibility

**User Story:** As a user, I want forward-call symbols to only suppress warnings for references that appear after the call site.

#### Acceptance Criteria

1. WHEN checking if a symbol suppresses an undefined-symbol warning, THE Diagnostics_Provider SHALL verify the diagnostic line is after the call site line
2. FOR ALL forward-call symbols, THE call_line field SHALL be 0-indexed and represent the line where the call occurs
3. WHEN a symbol is referenced before its forward-call site, THE Diagnostics_Provider SHALL NOT suppress the undefined-symbol warning

### Requirement 6: Effective Call Type Handling

**User Story:** As a user, I want local macros from `include` calls to suppress warnings, but not local macros from `do`/`run` calls.

#### Acceptance Criteria

1. WHEN checking local macro suppression from forward calls, THE Diagnostics_Provider SHALL only suppress if `effective_type` is 'include'
2. WHEN checking global macro suppression from forward calls, THE Diagnostics_Provider SHALL suppress for both 'do' and 'include' types
3. WHEN checking variable/scalar/matrix suppression from forward calls, THE Diagnostics_Provider SHALL suppress for both 'do' and 'include' types

### Requirement 7: Test Coverage for Edge Configurations

**User Story:** As a maintainer, I want comprehensive tests for edge configurations to prevent regressions.

#### Acceptance Criteria

1. THE test suite SHALL include tests for diagnostics when `scope_resolver` is null (fallback path)
2. THE test suite SHALL include tests for diagnostics when `scope_resolver` is available (primary path)
3. THE test suite SHALL include tests verifying the handler skips `forward_scope` computation when `scope_resolver` is available
4. THE test suite SHALL include tests for working directory variations
5. THE test suite SHALL include tests verifying position-aware suppression works correctly
6. THE test suite SHALL include tests verifying effective_type filtering for local macros
7. THE test suite SHALL include tests for duplicate directive/command scenarios (same file referenced by both `@lsp-do` and auto-detected `do` command)
8. THE test suite SHALL include tests verifying behavior when `cross_file.index_workspace` is false (workspace indexer disabled but scope_resolver still active)
