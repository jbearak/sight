# Implementation Plan: Formatter Bug Fixes

## Overview

This implementation plan fixes the formatter bugs by replacing the lossy AST reconstruction approach with a source-preserving formatter that operates on tokens. The formatter will only modify indentation while preserving all original source text.

## Tasks

- [ ] 1. Create IndentationAnalyzer component
  - [ ] 1.1 Create `src/formatter/indentation-analyzer.ts` with IndentationInfo interface
    - Define IndentationInfo interface with line, indent_level, is_continuation, is_block_start, is_block_end
    - Create IndentationAnalyzer class with analyze() method
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ] 1.2 Implement AST walking to compute indentation levels
    - Walk program, if, else, foreach, forvalues, while, frame nodes
    - Track nesting depth and compute indent level for each line
    - Handle block start/end lines correctly
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ] 1.3 Implement continuation line detection
    - Detect CONTINUATION tokens (/// and /**/)
    - Mark continuation lines with is_continuation flag
    - Compute continuation indent (one level past statement start)
    - _Requirements: 8.1, 8.2, 8.3, 9.4_
  - [ ] 1.4 Write property test for indentation analysis
    - **Property 9: Block Indentation Correctness**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [ ] 2. Create TokenReconstructor component
  - [ ] 2.1 Create `src/formatter/token-reconstructor.ts` with TokenProcessingState interface
    - Define TokenProcessingState interface
    - Create TokenReconstructor class with reconstruct() method
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 2.2 Implement token-to-source reconstruction
    - Process tokens in order, preserving exact token values
    - Track line boundaries and apply indentation at line starts
    - Preserve all whitespace between tokens (except leading indentation)
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 7.1, 7.2_
  - [ ] 2.3 Implement indentation application
    - Replace leading whitespace with computed indentation
    - Generate indent string based on config (spaces vs tabs)
    - Handle continuation line indentation
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ] 2.4 Write property test for token preservation
    - **Property 2: Token Content Preservation**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 3. Create SourcePreservingFormatter component
  - [ ] 3.1 Create `src/formatter/source-preserving-formatter.ts` with FormatterConfig interface
    - Define FormatterConfig and FormattingContext interfaces
    - Create SourcePreservingFormatter class
    - _Requirements: 9.1_
  - [ ] 3.2 Implement format() method
    - Analyze AST for indentation levels
    - Reconstruct source with adjusted indentation
    - Return formatted source string
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ] 3.3 Implement graceful degradation
    - Catch any errors during formatting
    - Return original source on error (no corruption)
    - Log warnings for debugging
    - _Requirements: 10.3_
  - [ ] 3.4 Write property test for output validity
    - **Property 10: Output Validity**
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [ ] 4. Checkpoint - Ensure core components work
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Integrate with CodeFormatter provider
  - [ ] 5.1 Update `src/providers/formatter.ts` to use SourcePreservingFormatter
    - Replace PrettyPrinter usage with SourcePreservingFormatter
    - Pass tokens and AST to new formatter
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_
  - [ ] 5.2 Update format_without_embedded_blocks method
    - Use SourcePreservingFormatter instead of PrettyPrinter
    - Preserve embedded block handling
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_
  - [ ] 5.3 Update format_with_embedded_preservation method
    - Integrate SourcePreservingFormatter with embedded block extraction
    - Ensure embedded blocks are preserved exactly
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_
  - [ ] 5.4 Write property test for syntax statement preservation
    - **Property 1: Syntax Statement Preservation**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [ ] 6. Add string and macro preservation tests
  - [ ] 6.1 Write property test for string literal preservation
    - **Property 4: String Literal Preservation**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  - [ ] 6.2 Write property test for macro reference preservation
    - **Property 7: Macro Reference Preservation**
    - **Validates: Requirements 7.1, 7.2, 7.3**
  - [ ] 6.3 Write property test for parenthesis content preservation
    - **Property 5: Parenthesis Content Preservation**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 7. Add continuation and comment tests
  - [ ] 7.1 Write property test for continuation line preservation
    - **Property 8: Continuation Line Preservation**
    - **Validates: Requirements 8.1, 8.2, 8.3**
  - [ ] 7.2 Write property test for comment indentation
    - **Property 6: Comment Indentation Correctness**
    - **Validates: Requirements 6.1, 6.2, 6.3**
  - [ ] 7.3 Write property test for operator spacing
    - **Property 3: Operator Spacing Preservation**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Create formatter barrel export
  - [ ] 9.1 Create `src/formatter/index.ts` barrel export
    - Export SourcePreservingFormatter, IndentationAnalyzer, TokenReconstructor
    - Export interfaces and types
    - _Requirements: N/A (code organization)_

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
