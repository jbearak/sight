# Implementation Plan: LSP Declaration Directives

## Overview

This implementation adds five declaration directives (`@lsp-local`, `@lsp-global`, `@lsp-scalar`, `@lsp-matrix`, `@lsp-program`) to the LSP. The implementation extends the directive parser to recognize these directives anywhere in a file and integrates with the analyzer to register declared symbols in the symbol table.

## Tasks

- [x] 1. Add DeclarationDirective type and extend DirectiveParseResult
  - Add `DeclarationDirective` interface to `src/types/index.ts`
  - Extend `DirectiveParseResult` to include `declaration_directives` array
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Implement declaration directive parsing in DirectiveParser
  - [x] 2.1 Add regex pattern and parsing logic for declaration directives
    - Add `DECLARATION_DIRECTIVE_PATTERN` regex to match `@lsp-(local|global|scalar|matrix|program)`
    - Implement `parse_declaration_directives` method that scans all comment lines
    - Extract directive type and symbol name from matches
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 5.1, 5.2_

  - [x] 2.2 Add single-argument validation with diagnostics
    - Detect when multiple space-separated tokens follow the directive keyword
    - Produce warning diagnostic with message indicating single argument requirement
    - Detect missing argument and produce warning diagnostic
    - Allow trailing whitespace after single argument
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Write property test for directive parsing correctness
    - **Property 1: Directive Parsing Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7**

  - [x] 2.4 Write property test for comment style invariance
    - **Property 2: Comment Style Invariance**
    - **Validates: Requirements 1.6**

  - [x] 2.5 Write property test for single argument acceptance
    - **Property 3: Single Argument Acceptance**
    - **Validates: Requirements 2.1, 2.3**

  - [x] 2.6 Write property test for multiple argument warning
    - **Property 4: Multiple Argument Warning**
    - **Validates: Requirements 2.2**

- [x] 3. Checkpoint - Ensure directive parsing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrate declaration directives with Analyzer
  - [x] 4.1 Extend analyzer to process declaration directives from tokens
    - Modify `extract_comment_directives_from_tokens` to detect declaration directives
    - Register declared symbols in appropriate symbol table maps
    - Set `definition_line` to the directive's line number
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 4.2 Implement warning suppression for declared macros
    - Ensure `is_macro_defined` checks declared locals and globals
    - Respect forward-only effect (only suppress warnings after directive line)
    - _Requirements: 4.1, 4.2, 5.3_

  - [x] 4.3 Write property test for symbol registration correctness
    - **Property 5: Symbol Registration Correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x] 4.4 Write property test for warning suppression
    - **Property 6: Warning Suppression for Declared Macros**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 4.5 Write property test for forward-only effect
    - **Property 7: Forward-Only Effect**
    - **Validates: Requirements 5.3**

- [x] 5. Checkpoint - Ensure analyzer integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update README.md documentation
  - [x] 6.1 Add documentation section for declaration directives
    - Document all five directives with syntax and purpose
    - Explain single-argument constraint
    - Provide usage examples
    - Explain purpose (suppressing false-positive warnings)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
