# Implementation Plan: Directive Call Site Diagnostics

## Overview

This implementation adds improved diagnostic messaging for cross-file directives when the LSP cannot identify the call site or detects type mismatches. The changes are primarily in `ScopeResolver` with a small addition to `DirectiveParser`.

## Tasks

- [x] 1. Add helper methods to ScopeResolver
  - [x] 1.1 Implement `is_line_in_bounds()` method
    - Add method to check if a 0-indexed line number is within the parent file's line count
    - Return true if line exists, false otherwise
    - _Requirements: 1.3_

  - [x] 1.2 Implement `validate_call_statement()` method
    - Add method to check if a line contains a valid call statement
    - Match `do`/`run`/`include` commands or `@lsp-do`/`@lsp-run`/`@lsp-include` directives
    - Return object with `is_valid` and optional `call_type`
    - _Requirements: 1.4_

  - [x] 1.3 Write property test for line validation
    - **Property 3: Out-of-Bounds line= Emits Warning**
    - **Property 4: Invalid Call Statement at line= Emits Warning**
    - **Validates: Requirements 1.3, 1.4**

- [x] 2. Add mixed call type detection to DirectiveParser
  - [x] 2.1 Implement `find_all_call_sites_for_file()` method
    - Add method to find ALL call sites (not just first) for a child file
    - Return array of `{ line: number; call_type: 'do' | 'run' | 'include' }`
    - Reuse existing pattern matching logic from `infer_call_type_for_file()`
    - _Requirements: 4.1_

  - [x] 2.2 Write property test for mixed call type detection
    - **Property 9: Mixed Call Types Emits Warning**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 3. Update call site resolution in follow_directives()
  - [x] 3.1 Add line= validation with bounds checking
    - After converting line= to 0-indexed, check if line is in bounds
    - If out of bounds, emit warning diagnostic and use config default
    - _Requirements: 1.3_

  - [x] 3.2 Add line= validation for call statement content
    - After bounds check passes, validate line contains a call statement
    - If no call statement, emit warning diagnostic
    - Still use the specified line (user may know better)
    - _Requirements: 1.4_

  - [x] 3.3 Update match= not found to emit warning (currently warning, verify)
    - Verify existing behavior emits warning when match string not found
    - Update message to be more descriptive if needed
    - _Requirements: 1.6_

  - [x] 3.4 Add information diagnostic when call site not identified
    - When no explicit params AND no reverse deps AND text inference fails
    - Emit information diagnostic mentioning parent file and suggesting line=/match=
    - _Requirements: 1.1, 1.7_

  - [x] 3.5 Write property test for call site identification
    - **Property 1: Call Site Not Identified Emits Information Diagnostic**
    - **Property 2: Valid line= Parameter Suppresses Diagnostic**
    - **Property 5: Valid match= Parameter Suppresses Diagnostic**
    - **Property 6: Not-Found match= Emits Warning**
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.6, 1.7**

- [x] 4. Add type mismatch diagnostics
  - [x] 4.1 Add done-by/run-by with include mismatch information
    - After detecting call type, check if directive is done-by/run-by but call is include
    - Emit information diagnostic explaining full inheritance will occur
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.2 Add mixed call type warning
    - Use `find_all_call_sites_for_file()` to detect mixed types
    - If both do/run AND include found, emit warning suggesting line=/match=
    - Only check when no explicit call_site parameter provided
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.3 Verify included-by with do/run warning exists (existing behavior)
    - Verify existing warning is emitted correctly
    - Ensure message explains local macros won't be inherited
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.4 Write property test for type mismatch diagnostics
    - **Property 7: included-by with do/run Mismatch Emits Warning**
    - **Property 8: done-by/run-by with include Mismatch Emits Information**
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3**

- [x] 5. Ensure diagnostic attribution
  - [x] 5.1 Verify diagnostic range is set to directive location
    - All new diagnostics should use `my_directive.range`
    - _Requirements: 5.1_

  - [x] 5.2 Add source attribution to new diagnostics
    - Include parent file information in diagnostic source field
    - _Requirements: 5.2_

  - [x] 5.3 Write property test for diagnostic attribution
    - **Property 10: Diagnostic Range Matches Directive Location**
    - **Property 11: Diagnostic Includes Source Attribution**
    - **Validates: Requirements 5.1, 5.2**

- [x] 6. Implement configuration support
  - [x] 6.1 Make information diagnostics respect cross-file config
    - Check config before emitting information-level diagnostics
    - Skip emission if config suppresses information level
    - _Requirements: 6.1_

  - [x] 6.2 Ensure included-by warning is not suppressible
    - The included-by with do/run warning should always be emitted
    - Do not check config for this specific warning
    - _Requirements: 6.2_

  - [x] 6.3 Write property test for configuration
    - **Property 12: Information Diagnostics Respect Configuration**
    - **Property 13: included-by Warning Is Not Suppressible**
    - **Validates: Requirements 6.1, 6.2**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update documentation
  - [x] 8.1 Document diagnostic messages in README
    - Add section explaining call site identification diagnostics
    - List warning vs information scenarios
    - _Requirements: 7.1, 7.2_

  - [x] 8.2 Add examples for line= and match= parameters
    - Show example directives with explicit call site parameters
    - Explain when to use each parameter
    - _Requirements: 7.3_

  - [x] 8.3 Document inheritance behavior differences
    - Explain done-by/run-by vs included-by inheritance
    - Clarify what happens with type mismatches
    - _Requirements: 7.4_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
