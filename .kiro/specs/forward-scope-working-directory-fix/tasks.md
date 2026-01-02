# Implementation Plan: Forward Scope Working Directory Fix

## Overview

This implementation fixes the bug where forward calls in parent files are resolved with incorrect working directories when the working directory is inherited from deeper ancestors in the directive chain. The fix involves re-parsing parent files with the correct working directory context after discovering it from deeper ancestors.

## Tasks

- [x] 1. Implement two-phase working directory discovery
  - [x] 1.1 Add discover_working_directory helper method
    - Create new method that does lightweight directive-only parsing
    - Read file content, extract directives with DirectiveParser
    - Recursively follow directive chain to find working directory
    - Return effective working directory for the chain
    - _Requirements: 2.1_

  - [x] 1.2 Modify follow_directives to use two-phase approach
    - Phase 1: Call discover_working_directory to get effective working directory
    - Phase 2: Call get_parsed_file with discovered working directory
    - Forward calls resolved correctly on first full parse (no re-parsing)
    - _Requirements: 1.1, 1.3, 2.2_

  - [x] 1.3 Write property test for working directory inheritance
    - **Property 1: Working Directory Inheritance for Forward Calls**
    - **Validates: Requirements 1.1, 1.3, 2.2**

- [x] 2. Ensure own working directory takes precedence
  - [x] 2.1 Verify precedence logic in follow_directives
    - Parent's own working directory should be used if present
    - Only use inherited working directory if parent doesn't have its own
    - _Requirements: 1.2_

  - [x] 2.2 Write property test for own working directory precedence
    - **Property 2: Own Working Directory Precedence**
    - **Validates: Requirements 1.2**

- [x] 3. Checkpoint - Verify core fix works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Verify fallback behavior
  - [x] 4.1 Ensure script-relative fallback works when no working directory is set
    - When no working directory in directive chain, paths should resolve relative to script
    - _Requirements: 1.4_

  - [x] 4.2 Write property test for fallback behavior
    - **Property 3: Fallback to Script-Relative Resolution**
    - **Validates: Requirements 1.4**

- [x] 5. Verify cache behavior
  - [x] 5.1 Verify cache key includes working directory
    - Cache key should be "uri|working_directory" format
    - Different working directories should result in different cache entries
    - _Requirements: 2.3, 4.1, 4.2_

  - [x] 5.2 Verify cache invalidation removes all entries
    - Invalidating a file should remove all cache entries regardless of working directory
    - _Requirements: 4.3_

  - [x] 5.3 Write property test for cache behavior
    - **Property 4: Cache Key Includes Working Directory**
    - **Property 5: Cache Invalidation Removes All Entries**
    - **Validates: Requirements 2.3, 4.1, 4.2, 4.3**

- [x] 6. Verify error diagnostics
  - [x] 6.1 Ensure error diagnostics include tried paths
    - "Cannot read file" errors should show the paths that were attempted
    - _Requirements: 3.2, 3.3_

  - [x] 6.2 Write property test for error diagnostics
    - **Property 6: Error Diagnostics Include Tried Paths**
    - **Validates: Requirements 3.2, 3.3**

- [x] 7. Write integration test for the specific bug scenario
  - [x] 7.1 Create integration test for bh_vars.do → survey.do → loop.do scenario
    - Test that "dhs/year_recodes" resolves to "fertility_surveys/dhs/year_recodes"
    - Not "fertility_surveys/dhs/dhs/year_recodes"
    - _Requirements: 3.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
