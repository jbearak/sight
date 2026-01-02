# Implementation Plan: Embedded Language Detection

## Overview

This implementation plan extends the existing Stata LSP to add embedded language detection for Mata and Python blocks. The tasks build incrementally on the existing codebase, adding context awareness without disrupting existing functionality.

## Tasks

- [x] 1. Context Tracker Infrastructure
  - [x] 1.1 Create Context Tracker types and interfaces
    - Create src/context-tracker/types.ts with LanguageContext enum, ContextRange interface, and ContextTracker interface
    - Define ContextDiagnostic and ContextErrorCode enums
    - Add context-related types to src/types/index.ts
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [x] 1.2 Implement core Context Tracker class
    - Create src/context-tracker/index.ts with ContextTracker implementation
    - Implement context detection algorithm for mata and python blocks
    - Handle context stack for nested blocks
    - Implement single-line context handling (mata:, python:)
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 2.1, 2.2, 2.3, 2.6_

  - [ ]* 1.3 Write unit tests for Context Tracker
    - Test context detection with various block patterns
    - Test nested block handling
    - Test single-line context handling
    - Test edge cases (delimiters in comments/strings)
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 2.1, 2.2, 2.3, 2.6_

- [x] 2. Extended Lexer for Embedded Languages
  - [x] 2.1 Add embedded language token types
    - Extend TokenType enum in src/lexer/index.ts with MATA_START, MATA_INLINE, PYTHON_START, PYTHON_INLINE, END_MATA, END_PYTHON, EMBEDDED_CONTENT
    - Update Token interface to handle embedded content
    - _Requirements: 1.4, 1.5, 2.4, 2.5_

  - [x] 2.2 Extend lexer state for context tracking
    - Add language_context and context_stack to LexerState interface
    - Modify lexer to recognize embedded language delimiters
    - Implement pass-through mode for embedded content
    - _Requirements: 1.4, 1.5, 2.4, 2.5_

  - [x] 2.3 Implement embedded content tokenization
    - Tokenize embedded content as EMBEDDED_CONTENT while preserving basic structures
    - Handle string and comment tokenization within embedded blocks for bracket matching
    - Detect block-ending delimiters correctly
    - _Requirements: 1.4, 1.5, 2.4, 2.5_

  - [ ]* 2.4 Write unit tests for extended lexer
    - Test embedded language delimiter recognition
    - Test embedded content tokenization
    - Test context switching during tokenization
    - _Requirements: 1.4, 1.5, 2.4, 2.5_

- [x] 3. Extended Parser for Embedded Languages
  - [x] 3.1 Add embedded language AST node types
    - Add EmbeddedLanguageBlockNode to AST node types in src/parser/index.ts
    - Update StataNode union type to include embedded blocks
    - _Requirements: 1.4, 2.4_

  - [x] 3.2 Implement embedded block parsing
    - Modify parser to recognize embedded language block delimiters
    - Create EmbeddedLanguageBlockNode for mata and python blocks
    - Handle nested embedded blocks correctly
    - Preserve embedded content as raw text
    - _Requirements: 1.4, 1.6, 2.4, 2.6_

  - [x] 3.3 Integrate Context Tracker with parser
    - Use Context Tracker to maintain parsing context
    - Switch parsing behavior based on current context
    - Handle context transitions during parsing
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [ ]* 3.4 Write unit tests for extended parser
    - Test embedded block parsing
    - Test nested block handling
    - Test context integration
    - _Requirements: 1.4, 1.6, 2.4, 2.6_

- [x] 4. Checkpoint - Core Context Detection Complete
  - Ensure all context detection and parsing tests pass, ask the user if questions arise.

- [x] 5. Context-Aware Diagnostics Provider
  - [x] 5.1 Extend DiagnosticsProvider for context awareness
    - Modify src/providers/diagnostics.ts to use Context Tracker
    - Suppress Stata diagnostics in embedded language contexts
    - Still report structural errors (quotes, braces) in embedded contexts
    - _Requirements: 3.1, 3.2_

  - [x] 5.2 Implement block structure validation
    - Add context structure validation to DiagnosticsProvider
    - Detect unclosed mata blocks, unclosed python blocks
    - Detect unmatched end commands and misplaced end python
    - Report block delimiter validation errors
    - _Requirements: 3.3, 3.4, 3.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 5.3 Write unit tests for context-aware diagnostics
    - Test diagnostic suppression in embedded contexts
    - Test block structure validation
    - Test error reporting for malformed blocks
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Context-Aware Completion Provider
  - [x] 6.1 Extend CompletionProvider for context awareness
    - Modify src/providers/completion.ts to use Context Tracker
    - Suppress Stata command completions in embedded language contexts
    - Still provide macro completions in embedded contexts
    - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 6.2 Implement block boundary completions
    - Suggest appropriate block-ending commands (end, end python) at block boundaries
    - Provide context-appropriate completion suggestions
    - _Requirements: 4.4_

  - [ ]* 6.3 Write unit tests for context-aware completion
    - Test completion filtering by context
    - Test block boundary completions
    - Test macro completion preservation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 7. Context-Aware Hover Provider
  - [x] 7.1 Extend HoverProvider for context awareness
    - Modify src/providers/hover.ts to use Context Tracker
    - Suppress Stata command hover in embedded language contexts
    - Still provide macro hover in embedded contexts
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 7.2 Implement block delimiter hover information
    - Provide hover information for mata, python, end commands
    - Explain embedded language block syntax in hover text
    - _Requirements: 5.4_

  - [ ]* 7.3 Write unit tests for context-aware hover
    - Test hover filtering by context
    - Test block delimiter hover information
    - Test macro hover preservation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 8. Context-Aware Definition Provider
  - [x] 8.1 Extend DefinitionProvider for context awareness
    - Modify src/providers/definition.ts to use Context Tracker
    - Maintain macro reference resolution across contexts
    - Avoid resolving embedded language symbols as Stata symbols
    - _Requirements: 6.1, 6.2_

  - [ ]* 8.2 Write unit tests for context-aware definition
    - Test cross-context macro navigation
    - Test embedded language symbol isolation
    - _Requirements: 6.1, 6.2_

- [x] 9. Context-Aware Symbol Provider
  - [x] 9.1 Extend SymbolProvider for embedded language blocks
    - Modify src/providers/symbols.ts to include embedded language blocks as structural elements
    - Track macro references across contexts for navigation
    - _Requirements: 6.3, 6.4_

  - [ ]* 9.2 Write unit tests for context-aware symbols
    - Test embedded block inclusion in document symbols
    - Test cross-context macro reference tracking
    - _Requirements: 6.3, 6.4_

- [x] 10. Context-Aware Formatter
  - [x] 10.1 Extend CodeFormatter for embedded language preservation
    - Modify src/providers/formatter.ts to use Context Tracker
    - Preserve embedded language block content unchanged during formatting
    - Format block delimiters according to Stata formatting rules
    - Maintain proper spacing around block boundaries
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 10.2 Write unit tests for context-aware formatting
    - Test embedded content preservation
    - Test block delimiter formatting
    - Test spacing around block boundaries
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 11. Checkpoint - Context-Aware Providers Complete
  - Ensure all context-aware provider tests pass, ask the user if questions arise.

- [x] 12. Document Store Integration
  - [x] 12.1 Extend DocumentState for context information
    - Add context_ranges and context_tracker fields to DocumentState interface in src/document-store.ts
    - Update DocumentStore to maintain context information on document changes
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 12.2 Implement incremental context updates
    - Update Context Tracker when document content changes
    - Handle incremental parsing with context preservation
    - Implement efficient context range updates
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 12.3 Write unit tests for document store integration
    - Test context maintenance during document updates
    - Test incremental context updates
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13. Server Integration
  - [x] 13.1 Integrate Context Tracker with LSP server
    - Modify src/server.ts to use context-aware providers
    - Pass context information to all LSP request handlers
    - Ensure context information is available for all LSP features
    - _Requirements: 9.5_

  - [x] 13.2 Update LSP request handlers for context awareness
    - Update onCompletion, onHover, onDefinition, onDocumentSymbol handlers
    - Update onDocumentFormatting and onPublishDiagnostics handlers
    - Ensure all handlers use context information appropriately
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 6.1, 7.1_

- [x] 14. Edge Case Handling
  - [x] 14.1 Implement robust delimiter detection
    - Handle delimiters in comments and strings correctly
    - Implement proper end keyword detection within embedded languages
    - Handle malformed and incomplete embedded language blocks
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 14.2 Implement error recovery strategies
    - Graceful recovery from malformed embedded blocks
    - Continue parsing after context detection errors
    - Provide helpful error messages for common mistakes
    - _Requirements: 8.5_

  - [ ]* 14.3 Write unit tests for edge case handling
    - Test delimiter detection in comments and strings
    - Test error recovery scenarios
    - Test malformed block handling
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 15. Property-Based Tests
  - [x]* 15.1 Write property test for context switching correctness
    - **Property 1: Context Switching Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**

  - [x]* 15.2 Write property test for context stack management
    - **Property 2: Context Stack Management**
    - **Validates: Requirements 1.6, 2.6**

  - [x]* 15.3 Write property test for embedded content isolation
    - **Property 3: Embedded Content Isolation**
    - **Validates: Requirements 1.4, 1.5, 2.4, 2.5**

  - [x]* 15.4 Write property test for context-aware diagnostics suppression
    - **Property 4: Context-Aware Diagnostics Suppression**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x]* 15.5 Write property test for context-aware completion filtering
    - **Property 5: Context-Aware Completion Filtering**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [x]* 15.6 Write property test for context-aware hover filtering
    - **Property 6: Context-Aware Hover Filtering**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x]* 15.7 Write property test for cross-context symbol navigation
    - **Property 7: Cross-Context Symbol Navigation**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x]* 15.8 Write property test for formatting preservation
    - **Property 8: Formatting Preservation**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

  - [x]* 15.9 Write property test for edge case robustness
    - **Property 9: Edge Case Robustness**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**

  - [x]* 15.10 Write property test for incremental context consistency
    - **Property 10: Incremental Context Consistency**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

  - [x]* 15.11 Write property test for block delimiter validation
    - **Property 11: Block Delimiter Validation**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**

- [x] 16. Integration Tests
  - [x] 16.1 Write LSP integration tests with embedded languages
    - Create tests/integration/embedded-language-lsp.test.ts
    - Test end-to-end LSP features with mata and python blocks
    - Test context switching during LSP interactions
    - _Requirements: All requirements_

  - [x] 16.2 Write real-world file tests
    - Create tests/integration/real-embedded-files.test.ts
    - Test with realistic Stata files containing embedded languages
    - Verify no crashes or unexpected errors with complex embedded patterns
    - _Requirements: All requirements_

- [x] 17. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Documentation Updates
  - [x] 18.1 Update README.md with embedded language support
    - Document new embedded language detection features
    - Provide examples of mata and python block usage
    - Update configuration options if any
    - _Requirements: All requirements_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation extends existing components rather than replacing them