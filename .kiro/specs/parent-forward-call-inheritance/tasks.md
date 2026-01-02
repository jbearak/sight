# Implementation Plan: Parent Forward Call Inheritance

## Overview

This implementation adds support for following forward calls (`do`, `run`, `include`) in parent files during backward scope resolution. The changes are primarily in `ScopeResolver` with a small helper addition to `ForwardScopeResolver`.

## Tasks

- [x] 1. Add helper method to ForwardScopeResolver
  - [x] 1.1 Add `filter_calls_before_line()` method to `ForwardScopeResolver`
    - Add method that filters `ForwardCall[]` to only include calls where `call_site_line < line`
    - Return filtered array sorted by `call_site_line` ascending
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 Write unit tests for `filter_calls_before_line()`
    - Test with empty array
    - Test with all calls before line
    - Test with all calls after line
    - Test with mixed calls
    - _Requirements: 2.1_

- [x] 2. Add parent forward call resolution to ScopeResolver
  - [x] 2.1 Add `resolve_parent_forward_calls()` private method to `ScopeResolver`
    - Accept parent URI, forward calls, call site line, effective call type, working directory, depth, config, and cancellation token
    - Filter forward calls to only those before call site
    - Use `ForwardScopeResolver.resolve()` to get symbols from forward calls
    - Apply effective call type based on backward directive type
    - Return merged symbols and diagnostics
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3_

  - [x] 2.2 Inject `ForwardScopeResolver` dependency into `ScopeResolver`
    - Add optional `forward_scope_resolver` parameter to constructor
    - Store as private field
    - _Requirements: 1.1_

  - [x] 2.3 Write unit tests for `resolve_parent_forward_calls()`
    - Test with no forward calls
    - Test with forward calls before call site
    - Test with forward calls after call site
    - Test with mixed forward calls
    - _Requirements: 1.1, 2.1_

- [x] 3. Integrate parent forward resolution into follow_directives
  - [x] 3.1 Modify `follow_directives()` to call `resolve_parent_forward_calls()`
    - After parsing parent file and determining call site
    - Before applying inheritance rules
    - Merge forward-resolved symbols with parent's direct symbols
    - Add forward diagnostics to the diagnostics array
    - _Requirements: 1.1, 1.5_

  - [x] 3.2 Compute effective call type for parent's forward calls
    - If backward directive is `done-by` or `run-by`, use effective type `do`
    - If backward directive is `included-by`, preserve original call types
    - Pass effective type to `resolve_parent_forward_calls()`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.3 Pass working directory context to forward resolution
    - Use parent's working directory (from `@lsp-cd` or inherited)
    - Pass to `resolve_parent_forward_calls()` for path resolution
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 3.4 Write unit tests for integrated forward resolution
    - Test backward directive with parent having forward calls
    - Test effective call type propagation
    - Test working directory context
    - _Requirements: 1.1, 3.1, 5.1_

- [x] 4. Handle depth limiting and cycle detection
  - [x] 4.1 Track combined depth across backward and forward resolution
    - Pass current depth to `resolve_parent_forward_calls()`
    - Forward resolution depth adds to backward resolution depth
    - Stop when combined depth exceeds `max_chain_depth`
    - _Requirements: 4.2_

  - [x] 4.2 Share visited set between backward and forward resolution
    - Pass visited URIs to forward resolution
    - Detect cycles that span backward and forward calls
    - Emit warning diagnostic on cycle detection
    - _Requirements: 4.1_

  - [x] 4.3 Write unit tests for depth limiting and cycle detection
    - Test depth limit with deep nested forward calls
    - Test cycle detection with backward-forward cycle
    - _Requirements: 4.1, 4.2_

- [x] 5. Wire up ForwardScopeResolver in server
  - [x] 5.1 Pass `forward_scope_resolver` to `ScopeResolver` constructor in server.ts
    - After creating `forward_scope_resolver`, pass it to `scope_resolver`
    - _Requirements: 1.1_

  - [x] 5.2 Write integration test for full resolution chain
    - Create test files mimicking fertility_surveys structure
    - Verify global macro from programs.do is visible in survey.do
    - _Requirements: 1.1, 1.2_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Property-based tests
  - [x] 7.1 Write property test for forward calls before call site inclusion
    - **Property 1: Forward calls before call site are included**
    - **Validates: Requirements 1.1, 2.1, 2.2**

  - [x] 7.2 Write property test for forward calls after call site exclusion
    - **Property 2: Forward calls after call site are excluded**
    - **Validates: Requirements 2.1**

  - [x] 7.3 Write property test for do/run inheritance excluding locals
    - **Property 3: do/run inheritance excludes locals**
    - **Validates: Requirements 1.2, 1.3**

  - [x] 7.4 Write property test for include inheritance including all symbols
    - **Property 4: include inheritance includes all symbols**
    - **Validates: Requirements 1.4, 3.2**

  - [x] 7.5 Write property test for effective call type propagation
    - **Property 5: Effective call type propagation**
    - **Validates: Requirements 3.1, 3.3**

  - [x] 7.6 Write property test for nested forward call resolution
    - **Property 6: Nested forward calls are resolved**
    - **Validates: Requirements 1.5**

  - [x] 7.7 Write property test for cycle detection
    - **Property 7: Cycle detection prevents infinite loops**
    - **Validates: Requirements 4.1**

  - [x] 7.8 Write property test for depth limiting
    - **Property 8: Depth limiting is enforced**
    - **Validates: Requirements 4.2**

  - [x] 7.9 Write property test for working directory context
    - **Property 9: Working directory context is used**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases

