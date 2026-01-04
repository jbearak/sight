# Implementation Plan: Prefix Command Brace Block Indentation Fix

## Overview

This implementation fixes the false positive indentation diagnostic and formatter behavior for prefix command brace blocks by recognizing `command` nodes with `name: "{"` as block nodes that increase indentation depth.

## Tasks

- [x] 1. Update `is_block_node_type` in IndentationDiagnosticAnalyzer
  - Add check for `node.type === 'command' && node.name === '{'`
  - This recognizes prefix command brace blocks as block nodes
  - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4_

- [x] 2. Add `compute_brace_block_depths` method to IndentationDiagnosticAnalyzer
  - Create new private method to compute depth for lines inside brace blocks
  - Walk AST to find command nodes with `name: "{"`
  - Return Map<number, number> from line number to depth
  - _Requirements: 1.2, 1.3_

- [x] 3. Update `compute_expected_depths` to include brace block depths
  - Call `compute_brace_block_depths` and merge results
  - Ensure brace block depths are added to expected depths
  - _Requirements: 1.2, 2.1, 2.2_

- [x] 4. Update `is_block_node` in IndentationAnalyzer (formatter)
  - Add check for `node.type === 'command' && node.name === '{'`
  - This ensures formatter recognizes brace blocks
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. Update `process_block_node` in IndentationAnalyzer to handle command nodes
  - Command nodes with `name: "{"` don't have a `body` property
  - Need to handle interior lines differently (by range, not by body)
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Checkpoint - Verify regression test passes
  - Run `bun test tests/repro_capture_block_indentation.test.ts`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write property test for brace block depth recognition
  - **Property 1: Prefix Command Brace Block Depth Recognition**
  - **Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4**

- [x] 8. Write property test for no unnecessary indentation diagnostic
  - **Property 2: No Unnecessary Indentation Diagnostic for Brace Block Contents**
  - **Validates: Requirements 2.1, 2.2**

- [x] 9. Write property test for formatter preservation
  - **Property 3: Formatter Preserves Brace Block Indentation**
  - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 10. Final checkpoint - Run full test suite
  - Run `bun test` to ensure no regressions
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Parser was updated to include `body` property in prefix command brace block nodes
