# Implementation Plan: Varlist Wildcard Coalescing

## Overview

This implementation adds wildcard pattern coalescing to the Stata parser, ensuring patterns like `var*` are parsed as single VarlistItems instead of separate tokens.

## Tasks

- [ ] 1. Add adjacency detection helper function
  - Create `isAdjacentToken()` helper in parser
  - Compare token ranges to detect adjacency (no whitespace)
  - Return true if `prev_token.range.end` equals `next_token.range.start`
  - _Requirements: 1.1, 1.2, 1.4_

- [ ] 2. Implement wildcard coalescing in parseCommandBody
  - [ ] 2.1 Modify varlist parsing loop in `parseCommandBody()`
    - After adding a WORD token, check for adjacent wildcard tokens
    - Coalesce adjacent wildcards into the VarlistItem name
    - Update the VarlistItem range to span the full pattern
    - Handle multiple consecutive wildcards (`var??`, `var*?`)
    - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2_

  - [ ] 2.2 Write property test for wildcard coalescing
    - **Property 1: Wildcard Coalescing**
    - Generate random WORD + wildcard combinations without whitespace
    - Verify single VarlistItem with combined name
    - **Validates: Requirements 1.1, 1.2, 5.1, 5.2**

  - [ ] 2.3 Write property test for range correctness
    - **Property 2: Range Correctness**
    - Verify coalesced item range spans full pattern
    - **Validates: Requirements 1.3**

- [ ] 3. Implement coalescing in other varlist parsing locations
  - [ ] 3.1 Apply same coalescing logic to `parseCommand()` varlist parsing
    - Mirror the logic from parseCommandBody
    - Ensure consistency across all varlist parsing paths
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 3.2 Apply coalescing to any other varlist parsing locations
    - Search for other `varlist.push()` calls
    - Apply consistent coalescing logic
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 4. Checkpoint - Ensure basic coalescing works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Handle whitespace separation correctly
  - [ ] 5.1 Verify whitespace prevents coalescing
    - Ensure `var *` produces two separate items
    - Adjacency check should fail when whitespace present
    - _Requirements: 1.4_

  - [ ] 5.2 Write property test for whitespace separation
    - **Property 3: Whitespace Separation**
    - Generate WORD + whitespace + wildcard patterns
    - Verify two separate VarlistItems
    - **Validates: Requirements 1.4**

- [ ] 6. Handle multiple wildcard patterns
  - [ ] 6.1 Verify multiple patterns coalesce independently
    - Test `rename old* new*` produces two coalesced items
    - Test mixed varlists work correctly
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 6.2 Write property test for multiple patterns
    - **Property 4: Multiple Pattern Independence**
    - Generate commands with N wildcard patterns
    - Verify N coalesced VarlistItems
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 7. Preserve expression context behavior
  - [ ] 7.1 Ensure `*` in expressions is not coalesced
    - Verify `generate y = x*2` keeps `*` as multiplication
    - Expression parsing should not trigger coalescing
    - _Requirements: 3.1, 3.2_

  - [ ] 7.2 Write property test for expression context
    - **Property 5: Expression Context Preservation**
    - Generate assignment expressions with `*`
    - Verify `*` is not coalesced in expression
    - **Validates: Requirements 3.1, 3.2**

- [ ] 8. Write unit tests for edge cases
  - [ ] 8.1 Write unit tests for basic coalescing
    - Test `describe var*` → single item `var*`
    - Test `describe x?` → single item `x?`
    - Test `describe var??` → single item `var??`
    - _Requirements: 1.1, 1.2, 5.2_

  - [ ] 8.2 Write unit tests for complex patterns
    - Test `rename old* new*` → two items
    - Test `summarize var* other` → two items
    - Test `describe _*` → single item `_*`
    - _Requirements: 2.1, 2.3, 4.1_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
