# Implementation Plan: Comment Style Normalization

## Overview

This implementation plan breaks down the comment style normalization feature into discrete coding tasks. Each task builds incrementally on previous work, with property-based tests validating correctness properties from the design document. The implementation extends the existing formatter while maintaining backward compatibility.

## Tasks

- [x] 1. Extend configuration interface and validation
  - Add comment formatting properties to `StataLSPConfig` interface
  - Implement configuration validation with fallback to defaults
  - Add configuration parsing and error handling
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 8.1, 8.2, 11.2, 11.3, 12.1, 12.2_

- [x] 1.1 Write property test for configuration validation
  - **Property 1: Configuration validation and fallback**
  - **Validates: Requirements 1.2, 1.4, 11.2**

- [x] 2. Create comment analysis and processing core
  - [x] 2.1 Implement `CommentAnalysis` and `CommentGroup` data models
    - Define interfaces for comment analysis results
    - Create helper functions for comment classification
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.2 Write property test for comment detection
    - **Property 4: Comprehensive comment detection**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x] 2.3 Implement `CommentProcessor` class with style conversion
    - Create comment style normalization logic
    - Implement content preservation during conversion
    - Handle indentation and whitespace preservation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 2.4 Write property test for style conversion
    - **Property 5: Style conversion correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

  - [x] 2.5 Write property test for continuation comment preservation
    - **Property 6: Continuation comment preservation**
    - **Validates: Requirements 4.8**

- [x] 3. Implement multi-line comment handling
  - [x] 3.1 Add multi-line comment conversion logic
    - Implement block-to-line comment conversion
    - Implement line-to-block comment combination
    - Handle proper indentation for multi-line scenarios
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 3.2 Write property test for multi-line comment handling
    - **Property 7: Multi-line comment handling**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

  - [x] 3.3 Implement blank line preservation in comments
    - Detect and preserve blank lines within multi-line comments
    - Maintain comment structure during conversion
    - _Requirements: 5.4_

  - [x] 3.4 Write property test for blank line preservation
    - **Property 8: Blank line preservation in comments**
    - **Validates: Requirements 5.4**

- [x] 4. Add Markdown-aware comment wrapping
  - [x] 4.1 Implement Markdown detection in comments
    - Create `MarkdownAnalysis` and `MarkdownElement` models
    - Add regex patterns for Markdown element detection
    - Implement line-break sensitivity analysis
    - _Requirements: 12.8, 12.9, 12.10, 12.11_

  - [x] 4.2 Implement comment line wrapping with Markdown awareness
    - Add word-boundary wrapping logic
    - Implement indentation preservation during wrapping
    - Handle Markdown structure preservation
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 4.3 Write property test for comment line wrapping
    - **Property 14: Comment line wrapping**
    - **Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7**

  - [x] 4.4 Write property test for Markdown-aware wrapping
    - **Property 15: Markdown-aware wrapping**
    - **Validates: Requirements 12.8, 12.9, 12.10, 12.11**

- [x] 5. Extend CodeFormatter with comment normalization
  - [x] 5.1 Add comment normalization to formatter
    - Extend `CodeFormatter` class with new methods
    - Implement `format_with_comment_normalization()`
    - Add transformation application logic
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 5.2 Write property test for comment preservation when disabled
    - **Property 2: Comment preservation when normalization disabled**
    - **Validates: Requirements 2.3**

  - [x] 5.3 Write property test for comment normalization when enabled
    - **Property 3: Comment normalization when enabled**
    - **Validates: Requirements 2.4, 3.6, 4.7**

  - [x] 5.4 Implement embedded language context awareness
    - Integrate with existing `ContextRange` handling
    - Ensure comments in Mata/Python blocks are preserved
    - Maintain language context boundaries
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 5.5 Write property test for embedded context preservation
    - **Property 11: Embedded context preservation**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [x] 6. Checkpoint - Core functionality validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement comment toggle integration
  - [x] 7.1 Add comment toggle functionality
    - Implement comment/uncomment commands using preferred style
    - Handle all existing comment styles for uncomment
    - Integrate with LSP command handling
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Write property test for comment toggle consistency
    - **Property 9: Comment toggle style consistency**
    - **Validates: Requirements 6.1, 6.5**

  - [x] 7.3 Write unit tests for specific toggle behaviors
    - Test "//" style toggle behavior
    - Test "*" style toggle behavior  
    - Test "/* */" style toggle behavior
    - _Requirements: 6.2, 6.3, 6.4_

- [x] 8. Add code generation integration
  - [x] 8.1 Implement preferred style for code generation
    - Update template generation to use preferred comment style
    - Update documentation generation to use preferred style
    - Update TODO comment generation to use preferred style
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 8.2 Write property test for code generation style consistency
    - **Property 10: Code generation style consistency**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 9. Add format-on-save integration
  - [x] 9.1 Implement format-on-save comment normalization
    - Integrate with VS Code's format-on-save mechanism
    - Respect `normalizeOnSave` configuration setting
    - Handle interaction with `editor.formatOnSave`
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 9.2 Write integration tests for format-on-save
    - Test format-on-save with normalization enabled
    - Test format-on-save with normalization disabled
    - Test interaction with VS Code settings
    - _Requirements: 8.3, 8.4, 8.5_

- [x] 10. Add comprehensive error handling and edge cases
  - [x] 10.1 Implement robust error handling
    - Add graceful degradation for processing errors
    - Implement atomic transformation operations
    - Add position tracking maintenance
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 10.2 Write property test for non-comment code preservation
    - **Property 12: Non-comment code preservation**
    - **Validates: Requirements 10.2**

  - [x] 10.3 Write property test for edge case handling
    - **Property 13: Edge case error handling**
    - **Validates: Requirements 10.4**

- [x] 11. Final integration and documentation
  - [x] 11.1 Complete LSP integration
    - Wire comment normalization into document formatting
    - Ensure proper LSP protocol compliance
    - Add configuration change handling
    - _Requirements: 11.4, 11.5_

  - [x] 11.2 Write integration tests for LSP protocol
    - Test document formatting with comment normalization
    - Test configuration updates and validation
    - Test error reporting and diagnostics
    - _Requirements: 11.1, 11.4, 11.5_

  - [x] 11.3 Add user documentation
    - Document all configuration options
    - Provide before/after examples
    - Explain feature usage and best practices
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [ ] 12. Final checkpoint - Complete system validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and integration points
- Checkpoints ensure incremental validation and user feedback opportunities