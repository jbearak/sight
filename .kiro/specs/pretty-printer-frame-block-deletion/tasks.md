# Implementation Plan: Pretty Printer Frame Block Deletion Fix

## Overview

This implementation plan fixes the bug where the PrettyPrinter deletes frame blocks and prefix command brace blocks during formatting. The fix involves adding frame block handling to `printControlFlow` and adding brace block handling to `printCommand`.

## Tasks

- [ ] 1. Add frame block support to printControlFlow method
  - Modify `src/pretty-printer/index.ts`
  - Add `case 'frame':` to the switch statement in `printControlFlow`
  - Format as: `frame ${node.frameName} {`
  - Follow same body printing pattern as other control flow types
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 1.1 Write property test for frame block preservation
  - **Property 1: Frame Block Preservation**
  - **Validates: Requirements 1.1, 1.3, 1.4**

- [ ] 1.2 Write property test for frame block format correctness
  - **Property 2: Frame Block Format Correctness**
  - **Validates: Requirements 2.1, 2.2, 2.4**

- [ ] 1.3 Write property test for frame block indentation
  - **Property 3: Frame Block Indentation**
  - **Validates: Requirements 1.5, 2.3**

- [ ] 1.4 Write unit tests for frame block examples
  - Test simple frame block: `frame myframe { display "test" }`
  - Test empty frame block: `frame myframe { }`
  - Test frame block with multiple commands
  - Test nested frame blocks
  - _Requirements: 1.2, 1.3, 1.4_

- [ ] 2. Add prefix command brace block support to printCommand method
  - Modify `src/pretty-printer/index.ts`
  - After building command parts, check if `node.body` exists and has length > 0
  - If body exists, add ` {` to command line, print body with increased indent, print closing brace
  - Handle special case where `node.name === '{'` (standalone brace block)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 2.1 Write property test for prefix command brace block preservation
  - **Property 4: Prefix Command Brace Block Preservation**
  - **Validates: Requirements 3.1, 3.3, 3.4**

- [ ] 2.2 Write property test for prefix command brace block format correctness
  - **Property 5: Prefix Command Brace Block Format Correctness**
  - **Validates: Requirements 4.1, 4.2, 4.4**

- [ ] 2.3 Write property test for prefix command brace block indentation
  - **Property 6: Prefix Command Brace Block Indentation**
  - **Validates: Requirements 3.5, 4.3**

- [ ] 2.4 Write unit tests for prefix command brace block examples
  - Test simple capture block: `capture { display "test" }`
  - Test quietly block: `quietly { gen x = 1 }`
  - Test standalone brace block: `{ display "test" }`
  - Test empty prefix block: `capture { }`
  - Test nested prefix blocks
  - _Requirements: 3.2, 3.3, 3.4_

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3.1 Write property test for delimiter mode handling
  - **Property 7: Delimiter Mode Handling**
  - **Validates: Requirements 2.5, 4.5, 5.4**

- [ ] 3.2 Write property test for control flow consistency
  - **Property 8: Control Flow Consistency**
  - **Validates: Requirements 5.1, 5.2**

- [ ] 3.3 Write property test for trivia preservation
  - **Property 9: Trivia Preservation**
  - **Validates: Requirements 5.3**

- [ ] 3.4 Write unit tests for delimiter mode examples
  - Test frame block in cr mode
  - Test frame block in semicolon mode
  - Test prefix block in both modes
  - _Requirements: 2.5, 4.5_

- [ ] 3.5 Write unit tests for trivia examples
  - Test frame block with leading comment
  - Test prefix block with trailing comment
  - _Requirements: 5.3_

- [ ] 4. Run existing formatter test suite
  - Run all existing property tests for the formatter
  - Verify dual-mode formatter tests pass
  - Check frame block recognition tests still pass
  - Verify prefix command brace block indentation tests still pass
  - Fix any regressions if found
  - _Requirements: All_

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The fix should maintain compatibility with existing formatter behavior for other node types
