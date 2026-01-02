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
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature addresses a gap in the cross-file diagnostic system where changes to a caller file do not trigger re-validation of callee files. Currently, when a user edits a file that contains `do`, `run`, or `include` commands, the LSP correctly invalidates caches for the edited file but does not re-validate the files being called. This means diagnostics in callee files can become stale or incorrect when:

1. The call type changes (e.g., `do child.do` → `include child.do`), affecting scope inheritance rules
2. The call is added or removed, affecting whether the callee's backward directives resolve correctly
3. The call site line changes, affecting which symbols are visible to the callee via call-site filtering
4. The caller's **public interface** (symbols it exports) changes, requiring callees to re-evaluate their inherited scope

## Best Practices & Comparison (Pyright Strategy)

This implementation draws inspiration from modern language servers (like Pyright) to ensure both correctness and performance:

1. **Cascading Invalidation**: When a file changes, we invalidate its direct dependents. If a dependent's resolved scope changes as a result, we transitively invalidate its own dependents.
2. **Interface Hashing (Stability)**: We compute a hash of the "public interface" (symbol table exported to children). If a caller's content changes but its public interface remains identical, we skip re-validating the callees.
3. **Prioritized Lazy Validation**: We prioritize re-validating the active document and visible editors. Closed documents are only re-validated on-demand or during full workspace indexing.
4. **Work Cancellation**: Ongoing re-validation tasks are cancelled if a new change occurs in the dependency chain, ensuring we don't process stale states.

## Glossary

- **Caller**: A Stata file that executes another file via `do`, `run`, or `include` commands
- **Callee**: A Stata file that is executed by another file and may use `@lsp-done-by` or `@lsp-included-by` directives to inherit scope
- **Forward_Call**: A `do`, `run`, or `include` command in a caller file that references a callee
- **Backward_Directive**: An `@lsp-done-by` or `@lsp-included-by` directive in a callee file that references a caller
- **Call_Type**: The type of execution command (`do`, `run`, or `include`), which affects scope inheritance rules
- **Call_Edge**: Metadata about a forward call relationship: `{ call_type: 'do' | 'run' | 'include', call_site_line: number }`
- **Scope_Resolver**: The component that resolves cross-file scope by following directive chains
- **Forward_Scope_Resolver**: The component that resolves forward calls to build scope from called files
- **Diagnostics_Provider**: The component that computes and publishes diagnostics for documents
- **Document_Store**: The component that manages open document state and triggers re-parsing
- **Reverse_Dependency_Index**: A data structure mapping caller URIs to callee URIs with Call_Edge metadata
- **Public_Interface**: The subset of a caller's symbols that are visible to a specific callee (depends on call type: `do` inherits globals/programs/etc., `include` inherits everything)
- **Interface_Hash**: A stable hash of a file's Public_Interface used to detect meaningful changes

## Data Model

```
Reverse_Dependency_Index: Map<caller_uri, Map<callee_uri, Call_Edge[]>>

Call_Edge: {
    call_type: 'do' | 'run' | 'include',
    call_site_line: number  // 0-indexed
}
```

Note: A caller may have multiple calls to the same callee (at different lines or with different call types). All call edges are stored.

## Trigger Model

Reverse dependency updates and callee re-validation occur **after** the debounced document update completes (not on every keystroke). The sequence is:

1. User edits caller file → `didChange` event
2. Debounce manager batches rapid edits
3. After debounce window, Document_Store re-parses the caller
4. Forward calls are extracted from the updated AST
5. Symbol table is updated for the caller
6. THE Scope_Resolver computes the **Interface_Hash** for the caller
7. Reverse_Dependency_Index is updated (diff old vs new forward calls)
8. IF the Interface_Hash OR forward calls changed, affected callee scope caches are invalidated
9. Transitive Invalidation: If a callee is also a caller, propagate invalidation
10. Open callee documents are scheduled for re-validation (prioritizing active view)

## Out of Scope / Non-goals (v1)

- Dynamic/macro paths remain skipped (only static paths are tracked)
- Only open callee documents are re-validated (closed files are not proactively re-parsed)
- Workspace-wide re-indexing of callees is not triggered (only scope cache invalidation)
- Rename/move of files is handled by existing file watcher logic, not this feature
- Cycles in the call graph are already handled by existing cycle detection; this feature does not add new cycle handling

## Requirements

### Requirement 1: Track Reverse Dependencies

**User Story:** As a developer, I want the LSP to track which files call which other files, so that changes to callers can trigger re-validation of callees.

#### Acceptance Criteria

1. WHEN a document is parsed (after debounce), THE Document_Store SHALL extract static forward calls from the AST
2. THE Scope_Resolver SHALL maintain a Reverse_Dependency_Index mapping caller URIs to callee URIs with Call_Edge metadata
3. WHEN a document's forward calls change, THE Scope_Resolver SHALL compute the diff (added/removed/modified edges) and update the Reverse_Dependency_Index
4. WHEN a document is closed, THE Scope_Resolver SHALL remove its caller entries from the Reverse_Dependency_Index
5. WHEN a file is deleted (via file watcher), THE Scope_Resolver SHALL remove its entries from the Reverse_Dependency_Index (both as caller and as callee)

### Requirement 2: Invalidate Callee Caches on Caller Change

**User Story:** As a developer, I want callee file caches to be invalidated when their caller changes, so that diagnostics reflect the current call relationship.

#### Acceptance Criteria

1. WHEN a caller's forward calls change (add/remove/modify), THE Scope_Resolver SHALL identify affected callees from the diff
2. WHEN forward calls change, THE Scope_Resolver SHALL invalidate scope cache entries for all affected callees (both old callees that were removed and new callees that were added)
3. THE Scope_Resolver SHALL prefer invalidating only scope caches for callees, not file parse caches, since callee content has not changed
4. **Interface Hashing Optimization**: WHEN a caller changes, THE Scope_Resolver SHALL compare the new Interface_Hash with the previous one. IF both forward calls and the Interface_Hash are identical, THE Scope_Resolver SHOULD skip callee invalidation.
5. **Transitive Propagation**: WHEN a callee's resolved scope changes due to a caller edit, THE Scope_Resolver SHALL transitively invalidate any files that depend on that callee.

### Requirement 3: Re-validate Open Callee Documents

**User Story:** As a developer, I want open callee files to show updated diagnostics when their caller changes, so that I see accurate warnings without manually triggering re-analysis.

#### Acceptance Criteria

1. WHEN a caller's forward calls change, THE LSP_Server SHALL identify open callee documents from the affected set
2. WHEN an open callee document's scope may have changed, THE LSP_Server SHALL schedule re-validation for that document
3. **Prioritization**: THE LSP_Server SHALL prioritize re-validation in the following order:
    - Active document (if it's a callee)
    - Visible documents
    - Other open documents
4. THE LSP_Server SHALL debounce callee re-validation using the existing debounce infrastructure
5. **Cancellation**: IF a new `didChange` event occurs for a caller while its callees are being re-validated, THE LSP_Server SHALL cancel pending callee re-validations to avoid redundant work.
6. WHEN re-validating a callee, THE Diagnostics_Provider SHALL use the updated scope from the modified caller
7. Diagnostics for open callees SHALL update within 500ms after the caller's debounce window completes (under normal load)
8. IF re-validation fails (e.g., parse error in caller), THE Diagnostics_Provider SHALL preserve last-known diagnostics for the callee

### Requirement 4: Handle Call Type Changes

**User Story:** As a developer, I want diagnostics to update correctly when I change a call from `do` to `include` or vice versa, so that scope inheritance rules are applied correctly.

#### Acceptance Criteria

1. WHEN a call type changes from `do`/`run` to `include`, THE Scope_Resolver SHALL update the Call_Edge metadata in the Reverse_Dependency_Index
2. WHEN a call type changes, THE Scope_Resolver SHALL invalidate the callee's scope cache to force re-resolution with new inheritance rules
3. WHEN a call type changes from `include` to `do`/`run`, THE callee's resolved scope SHALL exclude local macros from the caller
4. IF a callee uses `@lsp-included-by` but the effective call type from the resolved parent chain is `do`, THEN THE Diagnostics_Provider SHALL emit a warning in the callee's diagnostics about the directive/call-type mismatch

### Requirement 5: Handle Call Site Line Changes

**User Story:** As a developer, I want diagnostics to update when the line number of a call changes, so that call-site filtering reflects the correct symbol visibility.

#### Acceptance Criteria

1. WHEN a call site line changes in a caller (e.g., lines inserted/deleted above the call), THE Scope_Resolver SHALL update the Call_Edge metadata
2. WHEN a call site line changes, THE Scope_Resolver SHALL invalidate the callee's scope cache to force re-application of call-site filtering
3. Call-site filtering SHALL be determined from the resolved parent chain (directives + inferred call site)
4. WHEN symbols become out-of-scope due to call site line changes, THE Diagnostics_Provider SHALL emit out-of-scope warnings in the callee's diagnostics

### Requirement 6: Performance Constraints

**User Story:** As a developer, I want callee re-validation to be efficient, so that editing caller files does not cause noticeable lag.

#### Acceptance Criteria

1. THE Reverse_Dependency_Index SHALL support O(1) lookup time for finding callees of a given caller
2. THE LSP_Server SHALL limit callee re-validation to a maximum of 10 open documents per caller change (configurable via `cross_file.max_callee_revalidations`)
3. IF more than 10 open callees are affected, THE LSP_Server SHALL re-validate the first 10 according to the **Prioritization** rules (Requirement 3.3) and log that additional callees were skipped
4. THE LSP_Server SHALL only re-validate callees that are currently open in the editor (not closed workspace files)
5. WHEN multiple callee re-validations are needed, THE LSP_Server SHALL batch them using `setTimeout(0)` to avoid blocking the event loop
6. **Cancellation**: THE LSP_Server SHALL support cancelling pending callee re-validations if a new change to the same caller chain occurs, preventing "analysis storms" during rapid typing.

### Requirement 7: Edge Cases

**User Story:** As a developer, I want the system to handle edge cases gracefully, so that unusual call patterns don't cause errors or incorrect behavior.

#### Acceptance Criteria

1. WHEN a caller has multiple calls to the same callee (at different lines or with different call types), THE Reverse_Dependency_Index SHALL store all Call_Edge entries
2. WHEN resolving a callee's scope with multiple call edges from the same caller, THE Scope_Resolver SHALL use the earliest call site line for call-site filtering (consistent with existing behavior)
3. WHEN a callee is called by multiple different callers, THE Scope_Resolver SHALL track all caller relationships independently
4. WHEN a caller's path resolution changes (e.g., working directory directive added), THE Scope_Resolver SHALL re-evaluate which callees are affected
