# Implementation Plan: Continuation Line Alignment Preservation

## Overview

This implementation adds purposeful alignment detection and preservation to the Stata formatter. The approach is to create a new `AlignmentDetector` component that analyzes continuation line groups, then modify the existing formatter components to respect detected alignments.

## Tasks

- [ ] 1. Create AlignmentDetector component
  - [ ] 1.1 Create `src/formatter/alignment-detector.ts` with core interfaces
    - Define `ContinuationGroup` and `AlignmentPattern` interfaces
    - Create `AlignmentDetector` class skeleton
    - _Requirements: 1.1, 2.1_

  - [ ] 1.2 Implement continuation group detection
    - Scan tokens for `CONTINUATION` tokens (`///`)
    - Group consecutive continuation lines into `ContinuationGroup` objects
    - Track start line and all continuation line numbers
    - _Requirements: 1.1, 5.1_

  - [ ] 1.3 Implement operator alignment detection
    - Parse each line to find operator positions (`&`, `|`, `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`)
    - Compare operator column positions across continuation lines
    - Mark lines as aligned when operators are at exact same column
    - _Requirements: 1.1, 1.2_

  - [ ] 1.4 Implement condition alignment detection
    - Detect `if` qualifier on first line of continuation group
    - Find the column position after `if `
    - Check if continuation lines start at that column position
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 1.5 Implement expression alignment detection
    - Detect assignment operators (`=`) on first line
    - Find the column position of the right-hand side expression
    - Check if continuation lines are aligned to that position
    - _Requirements: 1.4_

  - [ ] 1.6 Write property test for operator alignment detection
    - **Property 1: Aligned Operator Preservation**
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [ ] 1.7 Write property test for condition alignment detection
    - **Property 2: Aligned Condition Preservation**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 1.8 Write property test for expression alignment detection
    - **Property 3: Expression Alignment Preservation**
    - **Validates: Requirements 1.4**

- [ ] 2. Modify IndentationAnalyzer to support alignment preservation
  - [ ] 2.1 Extend `IndentationInfo` interface with `preserve_whitespace` flag
    - Add `preserve_whitespace: boolean` field
    - Update all usages to handle the new field
    - _Requirements: 3.2, 3.4_

  - [ ] 2.2 Modify `analyze()` to accept alignment info
    - Add optional `alignment_info` parameter
    - When alignment is detected for a line, set `preserve_whitespace: true`
    - _Requirements: 3.1, 3.2_

  - [ ] 2.3 Write property test for non-purposeful alignment standard indentation
    - **Property 4: Non-Purposeful Alignment Standard Indentation**
    - **Validates: Requirements 2.4, 3.3**

- [ ] 3. Modify TokenReconstructor to respect alignment preservation
  - [ ] 3.1 Update `reconstruct()` to handle `preserve_whitespace` flag
    - Change `line_indents` parameter type to `Map<number, IndentationInfo>`
    - When `preserve_whitespace` is true, copy original whitespace instead of applying indent
    - _Requirements: 3.4, 4.2_

  - [ ] 3.2 Preserve exact original whitespace for aligned lines
    - Extract leading whitespace from original source
    - Use it directly instead of generating new indentation
    - _Requirements: 1.4, 3.4_

- [ ] 4. Integrate AlignmentDetector into SourcePreservingFormatter
  - [ ] 4.1 Add AlignmentDetector to SourcePreservingFormatter
    - Instantiate AlignmentDetector in constructor
    - Call `analyze()` before indentation analysis
    - Pass alignment info to IndentationAnalyzer
    - _Requirements: 3.1_

  - [ ] 4.2 Add `preserve_alignment` config option support
    - Accept config parameter in `format()` method
    - Skip alignment detection when `preserve_alignment: false`
    - _Requirements: 6.2, 6.3_

  - [ ] 4.3 Write property test for statement isolation
    - **Property 5: Statement Isolation**
    - **Validates: Requirements 5.1, 5.4**

  - [ ] 4.4 Write property test for disabled mode
    - **Property 6: Disabled Mode Standard Indentation**
    - **Validates: Requirements 6.3**

- [ ] 5. Checkpoint - Ensure source-preserving formatter tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Integrate alignment preservation into AST formatter (PrettyPrinter)
  - [ ] 6.1 Modify PrettyPrinter to accept original source for alignment reference
    - Add optional `original_source` parameter to `print()` method
    - Store original source for alignment detection
    - _Requirements: 4.1, 4.4_

  - [ ] 6.2 Detect and preserve alignment in PrettyPrinter output
    - Use AlignmentDetector on original source
    - When reconstructing continuation lines, preserve detected alignments
    - _Requirements: 4.2, 4.3_

- [ ] 7. Add configuration support
  - [ ] 7.1 Add `preserveAlignment` to configuration schema
    - Update `SightConfig` type in `src/types/index.ts`
    - Add to `formatting` section with default `true`
    - _Requirements: 6.1, 6.4_

  - [ ] 7.2 Update config validator and workspace config
    - Add validation for `formatting.preserveAlignment`
    - Map from public schema to internal config
    - _Requirements: 6.4_

  - [ ] 7.3 Wire configuration through to formatter
    - Pass `preserve_alignment` from server config to formatter
    - Update `CodeFormatter` in `src/providers/formatter.ts`
    - _Requirements: 6.2_

  - [ ] 7.4 Write property test for configuration default
    - **Property 7: Configuration Default Value**
    - **Validates: Requirements 6.1**

- [ ] 8. Checkpoint - Ensure all formatter tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Update documentation
  - [ ] 9.1 Document `formatting.preserveAlignment` in README.md
    - Add to configuration section
    - Include examples of aligned continuation lines
    - Explain enabled vs disabled behavior
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 10. Final checkpoint - All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- **IMPORTANT**: If AST bugs are discovered that block this feature, fixing them is in scope and expected. Do NOT modify tests to make them pass when the underlying code is incorrect - fix the AST instead.
