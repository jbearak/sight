# Implementation Plan: PR #28 Review Feedback Resolution

## Overview

This implementation plan addresses all review feedback from PR #28 by refactoring the AST structure, eliminating code duplication, improving test coverage, and enhancing code quality. The work is organized into 7 phases that can be executed incrementally.

## Tasks

- [x] 1. Add dedicated colon field to CommandNode
  - Add `has_colon_before_varlist?: boolean` field to CommandNode interface in src/types/index.ts
  - Update type exports and ensure backward compatibility
  - _Requirements: 11.1_

- [x] 1.1 Write property test for CommandNode type extension
  - **Property 1: Type field presence**
  - **Validates: Requirements 11.1**
  - Generate random CommandNodes and verify optional field is accepted

- [x] 2. Refactor parseUnabCommand to use dedicated colon field
  - [x] 2.1 Update parseUnabCommand in src/parser/index.ts
    - Remove colon from varlist array
    - Set `has_colon_before_varlist = true` when colon token is consumed
    - Keep varlist containing only variable names (macro name + variables)
    - _Requirements: 11.2, 5.1_

  - [x] 2.2 Write property test for unab colon field
    - **Property 2: Colon field consistency**
    - **Validates: Requirements 11.2, 5.1**
    - Generate random unab commands with colons
    - Verify `has_colon_before_varlist = true` and no colon in varlist

  - [x] 2.3 Write property test for varlist purity
    - **Property 1: Varlist purity**
    - **Validates: Requirements 5.3, 8.1**
    - Generate random commands
    - Verify varlists contain only IdentifierNodes with variable names or wildcards, never syntax tokens

- [x] 3. Update pretty printer to check colon field
  - [x] 3.1 Update printCommand in src/pretty-printer/index.ts
    - Check `has_colon_before_varlist` field to emit colon for unab commands
    - Add fallback logic for backward compatibility (check varlist for colon if field missing)
    - Emit colon between macro name and varlist when field is true
    - _Requirements: 11.3, 5.4_

  - [x] 3.2 Remove colon handling from should_omit_space
    - Remove line 35 that checks for `:` in next token
    - Keep wildcard pattern handling
    - _Requirements: 5.4_

  - [x] 3.3 Write property test for unab round trip
    - **Property 6: Unab round trip**
    - **Validates: Requirements 11.3, 5.4**
    - Generate random unab commands
    - Parse, pretty-print, parse again
    - Verify colon and varlist structure preserved

  - [x] 3.4 Write unit test for backward compatibility
    - **Validates: Requirements 5.5**
    - Create old-style AST with colon in varlist
    - Format and verify colon is preserved
    - Test fallback logic works correctly

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add wildcard support to parseCommandBody
  - [x] 5.1 Update parseCommandBody in src/parser/index.ts
    - Add wildcard operator detection before assignment check
    - Check for `OPERATOR` tokens with value `*` or `?`
    - Treat wildcards as varlist items (same shape as WORD/STRING/MACRO_REF)
    - Mirror the logic from parseCommand (lines 894-897)
    - _Requirements: 1.1, 1.4_

  - [x] 5.2 Write property test for wildcard detection
    - **Property 7: Wildcard operator detection**
    - **Validates: Requirements 1.1, 1.4**
    - Generate random command bodies with `*` and `?` operators
    - Verify they appear in varlist

  - [x] 5.3 Write property test for wildcard preservation in frame commands
    - **Property 3: Wildcard preservation in frame commands**
    - **Validates: Requirements 1.2, 1.3**
    - Generate random frame-prefixed commands with wildcards
    - Parse, format, verify wildcards preserved in original positions

- [x] 6. Extract shared frame prefix parsing logic
  - [x] 6.1 Create parseFramePrefixedCommand helper in src/parser/index.ts
    - Extract common logic from parseCommand (lines 803-869) and parseFrameBlock (lines 2186-2321)
    - Input: `frame_prefix: PrefixNode, prefixes: PrefixNode[], startToken: Token`
    - Output: `CommandNode`
    - Handle: frame name: [prefix...] command [args]
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Update parseCommand to use shared helper
    - Replace frame prefix parsing logic with call to parseFramePrefixedCommand
    - Maintain existing behavior
    - _Requirements: 4.1_

  - [x] 6.3 Update parseFrameBlock to use shared helper
    - Replace frame prefix parsing logic with call to parseFramePrefixedCommand
    - Maintain existing behavior
    - _Requirements: 4.2_

  - [x] 6.4 Write property test for frame prefix parsing equivalence
    - **Property 5: Frame prefix parsing equivalence**
    - **Validates: Requirements 4.1, 4.2, 4.4**
    - Generate random frame-prefixed commands
    - Parse via both entry points (parseCommand and parseFrameBlock contexts)
    - Verify equivalent AST structures

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Simplify pretty printer prefix brace block handling
  - [x] 8.1 Refactor printCommand prefix brace block logic in src/pretty-printer/index.ts
    - Replace post-hoc array manipulation (lines 241-248) with upfront format determination
    - Use clear decision tree: standalone brace block vs prefix brace block vs regular command
    - Remove fragile while loop that pops array elements
    - Add comments explaining expected state at each step
    - _Requirements: 6.1, 6.4, 6.5, 9.1_

  - [x] 8.2 Write property test for prefix brace block format determinism
    - **Property 10: Prefix brace block format determinism**
    - **Validates: Requirements 6.1, 6.4**
    - Generate random prefix command brace blocks
    - Format and verify correct output without array manipulation artifacts

- [x] 9. Update test generators to use arbitrary_non_reserved_identifier
  - [x] 9.1 Update ast-formatter-prefix-command-spacing.prop.test.ts
    - Import `arbitrary_non_reserved_identifier` from `tests/property/generators/index.ts`
    - Replace manual identifier filtering (lines 104-105, 561-564) with generator
    - Apply to all varlist and macro name generation
    - _Requirements: 3.1, 3.2, 7.1, 7.2_

  - [x] 9.2 Update pretty-printer-frame-block-deletion.prop.test.ts
    - Import `arbitrary_non_reserved_identifier` from `tests/property/generators/index.ts`
    - Replace any manual identifier filtering with generator
    - Apply to frame name generation
    - _Requirements: 3.1, 3.2, 7.1, 7.2_

  - [x] 9.3 Write property test for reserved identifier exclusion
    - **Property 8: Reserved identifier exclusion**
    - **Validates: Requirements 3.1, 3.2**
    - Generate random identifiers using `arbitrary_non_reserved_identifier()`
    - Verify none are reserved keywords (`if`, `in`, `by`)

- [ ] 10. Add dual-mode formatter testing
  - [ ] 10.1 Update ast-formatter-prefix-command-spacing.prop.test.ts for dual-mode
    - Import `for_each_formatter_mode_property` from `tests/property/helpers/formatter-test-utils.ts`
    - Wrap all property tests with `for_each_formatter_mode_property()`
    - Most tests run in both modes (indentation, spacing, structure)
    - Use `skip_for_mode('source-preserving')` only if specific tests verify AST-only normalization
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ] 10.2 Update pretty-printer-frame-block-deletion.prop.test.ts for dual-mode
    - Import `for_each_formatter_mode_property` from `tests/property/helpers/formatter-test-utils.ts`
    - Wrap all property tests with `for_each_formatter_mode_property()`
    - Most tests run in both modes (frame blocks, indentation, structure)
    - Use `skip_for_mode('source-preserving')` only if needed
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ] 10.3 Write property test for dual formatter correctness
    - **Property 4: Dual formatter correctness**
    - **Validates: Requirements 2.1, 2.2**
    - Generate random valid Stata source code
    - Format with both AST and source-preserving modes
    - Verify both produce correctly indented output with preserved structural elements

- [ ] 11. Add semantic tests for AST structure integrity
  - [ ] 11.1 Write property test for AST structure integrity
    - **Property 9: AST structure integrity**
    - **Validates: Requirements 8.1, 8.2**
    - Generate random CommandNodes
    - If `has_colon_before_varlist` is true, verify varlist contains no colon tokens
    - Verify varlist contains only variable names and wildcards

  - [ ] 11.2 Write property test for frame-prefixed command AST structure
    - **Validates: Requirements 8.2**
    - Generate random frame-prefixed commands
    - Parse and verify AST node structure matches expectations
    - Check prefix nodes, has_colon field, varlist structure

  - [ ] 11.3 Write property test for wildcard AST locations
    - **Validates: Requirements 8.3**
    - Generate random commands with wildcards
    - Parse and verify wildcards appear in correct AST locations (varlist)

- [ ] 12. Add code comments for complex logic
  - [ ] 12.1 Add comments to parseUnabCommand
    - Document why `has_colon_before_varlist` is set
    - Explain backward compatibility considerations
    - _Requirements: 9.2_

  - [ ] 12.2 Add comments to parseCommandBody
    - Explain wildcard operator detection logic
    - Document why specific token types are checked
    - _Requirements: 9.3_

  - [ ] 12.3 Add comments to parseFramePrefixedCommand
    - Document the shared frame prefix parsing strategy
    - Explain how it handles both entry points
    - _Requirements: 9.2_

  - [ ] 12.4 Add comments to printCommand
    - Explain prefix brace block format determination
    - Document fallback logic for backward compatibility
    - Clarify expected state at each step
    - _Requirements: 9.1, 9.4_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Both formatters normalize indentation, so most tests run in both modes
- Use `skip_for_mode()` sparingly for AST-specific normalization tests
- All tests are required for comprehensive coverage
