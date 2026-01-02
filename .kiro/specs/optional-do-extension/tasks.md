# Implementation Plan: Optional .do Extension Handling

## Overview

This implementation ensures consistent handling of optional `.do` file extensions across all path resolution contexts in the Stata LSP. The key insight is that `.do` fallback must be applied at the point of file reading, not just during path resolution.

## Current State Analysis

The `.do` fallback is currently applied in:
- `DirectiveParser.resolve_path_with_fallback` - for directive paths
- `SemanticAnalyzer.resolve_with_do_fallback` - for command paths

However, `ScopeResolver.get_parsed_file` reads files directly without applying `.do` fallback. This means if the directive parser resolves a path but the file doesn't exist (and neither does the `.do` variant), the error is reported. But if the path resolution happens correctly, the file should be found.

The issue is that `get_parsed_file` receives the already-resolved path, but if that path doesn't exist, it should try the `.do` variant before failing.

## Tasks

- [ ] 1. Add .do Fallback to ScopeResolver.get_parsed_file
  - [ ] 1.1 Implement .do fallback in get_parsed_file method
    - Before returning an error for file not found, check if `fs_path + ".do"` exists
    - If the fallback path exists, read from that path instead
    - Update the URI accordingly when using fallback path
    - Only apply fallback if the original path doesn't end in `.do`
    - _Requirements: 1.1, 2.1, 2.2, 5.1, 5.2, 5.3_

  - [ ] 1.2 Update diagnostic message to indicate paths tried
    - When neither path exists, include both paths in error message
    - Format: "Cannot read file: foo (also tried foo.do)"
    - Only add "also tried" suffix if original path doesn't end in `.do`
    - _Requirements: 3.1, 3.4_

- [ ] 2. Add .do Fallback to ForwardScopeResolver.get_callee_scope
  - [ ] 2.1 Implement .do fallback in get_callee_scope method
    - Before calling `scope_resolver.get_parsed_file`, check if path needs fallback
    - If `fs_path` doesn't exist but `fs_path + ".do"` exists, use the fallback
    - Update the URI accordingly when using fallback path
    - Only apply fallback if the original path doesn't end in `.do`
    - _Requirements: 1.1, 4.1, 4.2, 4.3_

  - [ ] 2.2 Update diagnostic message to indicate paths tried
    - When file is not found, include both paths in error message
    - Format: "Cannot read file: foo (also tried foo.do)"
    - Only add "also tried" suffix if original path doesn't end in `.do`
    - _Requirements: 3.1, 3.4_

- [ ] 3. Add .do Fallback to Definition Provider
  - [ ] 3.1 Update file path resolution in definition provider
    - When resolving go-to-definition for file paths, apply `.do` fallback
    - Check if exact path exists, then try with `.do` extension
    - Return the path that exists
    - _Requirements: 6.1, 6.2_

- [ ] 4. Checkpoint - Verify Core Implementation
  - Ensure all tests pass
  - Manually test with `do foo` where `foo.do` exists
  - Verify no false-positive diagnostics
  - Ask the user if questions arise

- [ ] 5. Write Property Tests for Path Resolution
  - [ ] 5.1 Write Property 1: Path Resolution Fallback test
    - Generate random path names without `.do` extension
    - Create test files with `.do` extension
    - Verify resolution returns `path.do` for commands and directives
    - **Property 1: Path Resolution Fallback**
    - **Validates: Requirements 1.1, 2.1, 2.2**
    - _Requirements: 1.1, 2.1, 2.2_

  - [ ] 5.2 Write Property 2: Explicit Extension Preserved test
    - Generate random paths ending in `.do`
    - Verify path is returned unchanged
    - **Property 2: Explicit Extension Preserved**
    - **Validates: Requirements 1.2, 2.3**
    - _Requirements: 1.2, 2.3_

  - [ ] 5.3 Write Property 3: Exact Path Precedence test
    - Generate random paths
    - Create both `path` and `path.do` files
    - Verify exact path is returned
    - **Property 3: Exact Path Precedence**
    - **Validates: Requirements 1.3, 2.4**
    - _Requirements: 1.3, 2.4_

- [ ] 6. Write Property Tests for Diagnostics
  - [ ] 6.1 Write Property 4: No False Positive Diagnostics test
    - Generate random paths without `.do`
    - Create `path.do` file (but not `path`)
    - Verify no "file not found" diagnostic is emitted
    - **Property 4: No False Positive Diagnostics**
    - **Validates: Requirements 3.2**
    - _Requirements: 3.2_

  - [ ] 6.2 Write Property 5: Missing File Diagnostic test
    - Generate random paths
    - Don't create any files
    - Verify diagnostic is emitted with correct message format
    - **Property 5: Missing File Diagnostic**
    - **Validates: Requirements 3.1, 3.3**
    - _Requirements: 3.1, 3.3_

- [ ] 7. Write Property Tests for Scope Resolution
  - [ ] 7.1 Write Property 6: Forward Scope Resolution test
    - Create test files with symbols (using `.do` extension)
    - Reference via path without `.do` extension
    - Verify symbols are resolved correctly
    - **Property 6: Forward Scope Resolution**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 7.2 Write Property 7: Backward Scope Resolution test
    - Create test files with symbols (using `.do` extension)
    - Reference via directive without `.do` extension
    - Verify symbols are inherited correctly
    - **Property 7: Backward Scope Resolution**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 8. Write Property Tests for Go-to-Definition
  - [ ] 8.1 Write Property 8: Go-to-Definition Resolution test
    - Create test files (using `.do` extension)
    - Invoke go-to-definition on path without `.do`
    - Verify correct file is returned
    - **Property 8: Go-to-Definition Resolution**
    - **Validates: Requirements 6.1, 6.2**
    - _Requirements: 6.1, 6.2_

- [ ] 9. Write Unit Tests for Edge Cases
  - [ ] 9.1 Test diagnostic message format
    - Test "Cannot read file: foo (also tried foo.do)" format
    - Test "Cannot read file: foo.do" format (no suffix for explicit .do)
    - _Requirements: 3.4_

  - [ ] 9.2 Test quoted vs unquoted path consistency
    - Verify same behavior for quoted and unquoted paths
    - _Requirements: 7.3_

- [ ] 10. Final Checkpoint - Ensure all tests pass
  - Ensure all property tests pass (minimum 100 iterations each)
  - Ensure all unit tests pass
  - Verify no regressions in existing tests
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive testing
- The core implementation (tasks 1-4) adds `.do` fallback at the file reading level
- This ensures the fallback is applied consistently regardless of how the path was resolved
- Property tests validate universal correctness properties across many inputs
- Unit tests validate specific examples and edge cases
