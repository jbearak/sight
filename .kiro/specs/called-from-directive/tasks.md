# Implementation Plan: @lsp-working-directory Directive

## Overview

This implementation adds the `@lsp-working-directory` directive (and synonyms) to specify working directory context for forward scope resolution. The implementation follows the existing directive parsing patterns and integrates with the analyzer's path resolution logic.

## Tasks

- [x] 1. Extend DirectiveParser to parse working directory directives
  - [x] 1.1 Add WorkingDirectoryDirective type to types/index.ts
    - Add interface with path, resolved_path, is_workspace_relative, range, directive_form fields
    - Add to DirectiveParseResult interface
    - _Requirements: 1.1_

  - [x] 1.2 Implement working directory directive parsing in directive-parser/index.ts
    - Add WORKING_DIR_DIRECTIVE_PATTERN regex matching all synonyms
    - Parse directive in header loop (before first non-comment, non-blank line)
    - Extract path (quoted or unquoted), detect workspace-relative flag
    - Track multiple directives and emit warning diagnostic
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.3 Write property test for directive parsing
    - **Property 1: Directive Parsing Accepts All Synonym Forms**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 1.4 Write property test for header-only constraint
    - **Property 2: Header-Only Constraint**
    - **Validates: Requirements 1.3**

  - [x] 1.5 Write property test for multiple directive warning
    - **Property 3: Multiple Directive Warning**
    - **Validates: Requirements 1.4**

  - [x] 1.6 Write property test for workspace-relative flag
    - **Property 4: Workspace-Relative Flag**
    - **Validates: Requirements 1.5**

- [x] 2. Checkpoint - Ensure directive parsing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Extend SemanticAnalyzer to use working directory context
  - [x] 3.1 Add working_directory and workspace_root to AnalyzerConfig
    - Extend AnalyzerConfig interface in analyzer/index.ts
    - _Requirements: 2.1_

  - [x] 3.2 Implement path resolution with working directory in analyzer
    - Modify resolve_path_with_fallback to accept working_directory parameter
    - When working_directory is set, resolve paths relative to it
    - Implement workspace-relative resolution for `/` prefix
    - Emit warning if working directory doesn't exist, fall back to script directory
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Implement fallback resolution strategy (script-relative → workspace-root)
    - When no working_directory directive, try script-relative first
    - If file not found, try workspace-root-relative
    - If still not found, emit informational diagnostic
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.4 Write property test for path resolution with working directory
    - **Property 5: Path Resolution with Working Directory**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 3.5 Write property test for non-existent working directory fallback
    - **Property 6: Non-Existent Working Directory Fallback**
    - **Validates: Requirements 2.4**

  - [x] 3.6 Write property test for fallback resolution strategy
    - **Property 9: Fallback Resolution Strategy**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 3.7 Write property test for fallback failure diagnostic
    - **Property 10: Fallback Failure Diagnostic**
    - **Validates: Requirements 3.3**

- [x] 4. Checkpoint - Ensure analyzer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate with DocumentStore and ForwardScopeResolver
  - [x] 5.1 Pass working directory from DirectiveParser to Analyzer in DocumentStore
    - In document-store.ts update(), extract working_directory from directive result
    - Resolve the working directory path (workspace-relative or script-relative)
    - Pass to analyzer config
    - _Requirements: 2.1_

  - [x] 5.2 Ensure ForwardScopeResolver emits missing file diagnostics
    - Verify existing "Cannot read file" diagnostic is emitted
    - _Requirements: 2.5_

  - [x] 5.3 Ensure directive isolation (other @lsp-* directives unaffected)
    - Verify @lsp-do, @lsp-run, @lsp-include, @lsp-done-by, @lsp-included-by still resolve relative to script
    - _Requirements: 2.6_

  - [x] 5.4 Write property test for missing file diagnostic
    - **Property 7: Missing File Diagnostic**
    - **Validates: Requirements 2.5**

  - [x] 5.5 Write property test for directive isolation
    - **Property 8: Directive Isolation**
    - **Validates: Requirements 2.6**

- [x] 6. Checkpoint - Ensure integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add round-trip support
  - [x] 7.1 Ensure directive can be printed back (if pretty-printer handles directives)
    - Verify formatting preserves working directory directives in comments
    - _Requirements: 5.1_

  - [x] 7.2 Write property test for round-trip parsing
    - **Property 11: Round-Trip Parsing**
    - **Validates: Requirements 5.1**

- [x] 8. Update README documentation
  - [x] 8.1 Add Working Directory section to README
    - Document all synonym forms
    - Explain header-only constraint
    - Explain `/` prefix for workspace-relative paths
    - Explain fallback behavior when no directive present
    - Add examples for common use cases
    - Clarify directive only affects do/run/include commands, not other @lsp-* directives
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases

## Follow-up: Parser Bug Fix

During testing of this feature, a bug was discovered where the parser did not capture STRING tokens (quoted paths) in the `varlist` of `CommandNode`. This prevented the `@lsp-working-directory` directive from working with quoted file paths like `do "path/to/file.do"`.

This bug was addressed in a follow-up spec: `.kiro/specs/quoted-path-parsing/`

The fix was a one-line change to `src/parser/index.ts` in the `parseCommand()` method to include `|| this.check('STRING')` in the varlist parsing condition.
