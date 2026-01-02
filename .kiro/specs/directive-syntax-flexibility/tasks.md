# Implementation Plan: Directive Syntax Flexibility

## Overview

This implementation extends the directive parser to support flexible syntax variations for cross-file awareness directives. The parser already recognizes optional colons and optional quotes around paths. The main remaining work is to implement the `.do` extension fallback feature and comprehensive testing.

## Tasks

- [ ] 1. Implement .do Extension Fallback in DirectiveParser
  - [ ] 1.1 Add `resolve_path_with_fallback` method to DirectiveParser
    - Implement file existence checking with fs.existsSync
    - Check exact path first, then try appending .do
    - Return whichever path exists, or original if neither exists
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ] 1.2 Update `parse` method to use `resolve_path_with_fallback`
    - Replace calls to `resolve_path` with `resolve_path_with_fallback`
    - Maintain backward compatibility with existing behavior
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 2. Write Property Tests for Flexible Syntax Forms
  - [ ] 2.1 Write Property 1: Syntax Form Equivalence test
    - Generate all 8 syntax forms for each directive type
    - Verify all forms produce identical Directive objects
    - Test with various path formats (relative, absolute, with .., etc.)
    - **Property 1: Syntax Form Equivalence**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 6.1, 6.2, 6.3**
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 6.1, 6.2, 6.3_

  - [ ] 2.2 Write Property 2: .do Extension Fallback test
    - Generate random paths with and without .do extension
    - Mock file existence in various combinations
    - Verify correct resolution behavior
    - **Property 2: .do Extension Fallback**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 3. Write Unit Tests for Flexible Syntax
  - [ ] 3.1 Test all 8 syntax forms for @lsp-done-by
    - Test without colon, without quotes: `@lsp-done-by path/to/file`
    - Test with colon, without quotes: `@lsp-done-by: path/to/file`
    - Test without colon, with quotes: `@lsp-done-by "path/to/file"`
    - Test with colon, with quotes: `@lsp-done-by: "path/to/file"`
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1_

  - [ ] 3.2 Test all 8 syntax forms for @lsp-included-by
    - Test without colon, without quotes: `@lsp-included-by path/to/file`
    - Test with colon, without quotes: `@lsp-included-by: path/to/file`
    - Test without colon, with quotes: `@lsp-included-by "path/to/file"`
    - Test with colon, with quotes: `@lsp-included-by: "path/to/file"`
    - _Requirements: 1.3, 1.4, 2.3, 2.4, 3.2_

  - [ ] 3.3 Test comment style support
    - Test directives in `*` style comments
    - Test directives in `//` style comments
    - Verify both styles produce identical results
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 3.4 Test .do extension fallback behavior
    - Test exact path resolution when file exists
    - Test fallback to .do extension when exact path doesn't exist
    - Test preference for exact path when both exist
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 3.5 Test backward compatibility
    - Verify existing directive syntax still works
    - Test mixed old and new syntax in same file
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all property tests pass (minimum 100 iterations each)
  - Ensure all unit tests pass
  - Verify no regressions in existing tests
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The flexible syntax (with/without colon, with/without quotes) is already implemented in the regex pattern
- The main implementation work is adding the .do extension fallback feature
- All syntax variations should produce identical Directive objects
- Property tests validate universal correctness properties across many inputs
- Unit tests validate specific examples and edge cases
