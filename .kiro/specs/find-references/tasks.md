# Implementation Plan: Find References

## Overview

Implement LSP `textDocument/references` support for the Sight LSP. The implementation follows the existing provider pattern, creating a new `ReferencesProvider` class that integrates with the workspace indexer and document store.

## Tasks

- [ ] 1. Create ReferencesProvider core implementation
  - [ ] 1.1 Create `src/providers/references.ts` with ReferencesProvider class
    - Define `ReferenceSearchContext` interface
    - Define `IdentifiedSymbol` interface
    - Implement `get_references()` method signature
    - _Requirements: 1.1-1.7, 5.1, 5.2_
  
  - [ ] 1.2 Implement symbol identification at cursor position
    - Reuse `get_word_at_position()` pattern from DefinitionProvider
    - Detect symbol type from surrounding context (backtick for local macro, $ for global, etc.)
    - Handle cursor on whitespace/comments returning null
    - _Requirements: 1.1-1.7_
  
  - [ ] 1.3 Write property test for symbol identification
    - **Property 2: Empty Result for Invalid Position**
    - **Validates: Requirements 1.7**

- [ ] 2. Implement token scanning for references
  - [ ] 2.1 Implement `scan_tokens_for_references()` function
    - Match MACRO_REF_LOCAL tokens for local macros
    - Match MACRO_REF_GLOBAL tokens for global macros
    - Match WORD tokens in command position for programs
    - Use case-sensitive string comparison
    - _Requirements: 4.1-4.5_
  
  - [ ] 2.2 Implement name extraction from tokens
    - Extract name from `` `name' `` format for local macros
    - Extract name from `$name` and `${name}` formats for global macros
    - Direct name match for WORD tokens
    - _Requirements: 4.1-4.4, 5.3_
  
  - [ ] 2.3 Write property test for case-sensitive matching
    - **Property 5: Case-Sensitive Matching**
    - **Validates: Requirements 4.5**

- [ ] 3. Implement workspace-wide search
  - [ ] 3.1 Extend WorkspaceIndexer with `get_indexed_files()` method
    - Return Map of URI to tokens and context ranges
    - Expose indexed file data for reference search
    - _Requirements: 3.1, 3.2_
  
  - [ ] 3.2 Implement search across indexed files
    - Iterate through indexed files from WorkspaceIndexer
    - Use DocumentStore content for current document (fresh content)
    - Use indexed content for other files
    - Yield to event loop periodically
    - _Requirements: 3.1-3.4, 7.2_
  
  - [ ] 3.3 Write property test for workspace coverage
    - **Property 7: Workspace Coverage**
    - **Validates: Requirements 3.1, 3.2**
  
  - [ ] 3.4 Write property test for fresh content
    - **Property 8: Fresh Content for Current Document**
    - **Validates: Requirements 3.3**

- [ ] 4. Checkpoint - Ensure core functionality works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement includeDeclaration handling
  - [ ] 5.1 Implement definition lookup
    - Use existing symbol tables to find definition location
    - Handle case where definition doesn't exist
    - _Requirements: 2.1-2.3_
  
  - [ ] 5.2 Implement includeDeclaration flag handling
    - Include definition as first result when flag is true
    - Exclude definition when flag is false
    - _Requirements: 2.1, 2.2_
  
  - [ ] 5.3 Write property test for includeDeclaration true
    - **Property 3: Include Declaration When Requested**
    - **Validates: Requirements 2.1**
  
  - [ ] 5.4 Write property test for includeDeclaration false
    - **Property 4: Exclude Declaration When Not Requested**
    - **Validates: Requirements 2.2**

- [ ] 6. Implement result ordering and formatting
  - [ ] 6.1 Implement result sorting
    - Sort by URI (ascending lexicographic)
    - Then by line number (ascending)
    - Then by character position (ascending)
    - _Requirements: 6.1-6.3_
  
  - [ ] 6.2 Implement range calculation for complete symbol spans
    - Include backtick and quote for local macros
    - Include $ for global macros
    - _Requirements: 5.3_
  
  - [ ] 6.3 Write property test for deterministic ordering
    - **Property 6: Deterministic Ordering**
    - **Validates: Requirements 6.1, 6.2, 6.3**
  
  - [ ] 6.4 Write property test for complete range spans
    - **Property 11: Complete Range Spans**
    - **Validates: Requirements 5.3**

- [ ] 7. Implement embedded language context handling
  - [ ] 7.1 Implement context-aware reference filtering
    - Include macro references in embedded blocks
    - Exclude non-macro references in embedded blocks
    - _Requirements: 8.1, 8.2_
  
  - [ ] 7.2 Implement cursor context detection
    - Detect if cursor is in Mata/Python block
    - Allow macro search from embedded context
    - Return empty for non-macro from embedded context
    - _Requirements: 8.3, 8.4_
  
  - [ ] 7.3 Write property test for macros crossing contexts
    - **Property 9: Macros Cross Embedded Contexts**
    - **Validates: Requirements 8.1, 8.3**
  
  - [ ] 7.4 Write property test for non-macros excluded
    - **Property 10: Non-Macros Excluded from Embedded Contexts**
    - **Validates: Requirements 8.2, 8.4**

- [ ] 8. Checkpoint - Ensure all provider logic works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Wire up LSP server integration
  - [ ] 9.1 Register referencesProvider capability in server initialization
    - Add `referencesProvider: true` to InitializeResult capabilities
    - _Requirements: 9.1_
  
  - [ ] 9.2 Create references handler in server-handlers.ts
    - Create `create_references_handler()` factory function
    - Wire up to HandlerDependencies
    - _Requirements: 9.2_
  
  - [ ] 9.3 Register handler in server-factory.ts
    - Add `connection.onReferences()` handler
    - Pass dependencies to handler
    - _Requirements: 9.2_

- [ ] 10. Write comprehensive property test for symbol search
  - [ ] 10.1 Write property test for symbol identification and search
    - **Property 1: Symbol Identification and Search Completeness**
    - **Validates: Requirements 1.1-1.6**

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
