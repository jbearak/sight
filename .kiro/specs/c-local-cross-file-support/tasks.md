# Implementation Plan: c_local Cross-File Support

## Overview

This implementation extends the Stata LSP's `c_local` support to work across files by re-enabling the workspace symbols parameter in the Analyzer and modifying the program lookup logic to check workspace symbols when a program is not found locally.

## Tasks

- [ ] 1. Re-enable workspace_symbols parameter in Analyzer
  - [ ] 1.1 Update analyze() method to store workspace_symbols as instance field
    - Remove the underscore prefix from `_workspace_symbols` parameter
    - Store the parameter in `this.workspace_symbols` at the start of analyze()
    - Clear the field at the end of analyze() to avoid stale references
    - _Requirements: 5.1, 5.4_
  - [ ] 1.2 Write property test for workspace symbols lookup
    - **Property 8: Workspace Symbols Lookup Fallback**
    - **Validates: Requirements 5.2, 5.3**

- [ ] 2. Modify process_command to check workspace symbols for c_locals
  - [ ] 2.1 Update program lookup in process_command()
    - After checking `symbols.programs.get(cmd_name)`, check `this.workspace_symbols?.programs.get(cmd_name)`
    - Use the first program found (local takes precedence)
    - _Requirements: 1.1, 1.2_
  - [ ] 2.2 Write property test for workspace c_local suppression
    - **Property 1: Workspace c_local Suppression**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [ ] 2.3 Write property test for same-file c_local preservation
    - **Property 2: Same-File c_local Preservation**
    - **Validates: Requirements 1.4**

- [ ] 3. Checkpoint - Verify analyzer changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Update DocumentStore to pass workspace symbols
  - [ ] 4.1 Modify update_document to accept workspace_symbols parameter
    - Add optional `workspace_symbols?: SymbolTable` parameter
    - Pass it to `analyzer.analyze()`
    - _Requirements: 5.1_
  - [ ] 4.2 Update public update() method to accept workspace_symbols
    - Add optional parameter to the public interface
    - Pass it through to update_document()
    - _Requirements: 5.1_

- [ ] 5. Update server handlers to pass workspace symbols
  - [ ] 5.1 Modify didChangeTextDocument handler
    - Get workspace symbols from workspace_indexer
    - Pass them to document_store.update()
    - _Requirements: 5.2_
  - [ ] 5.2 Modify didOpenTextDocument handler
    - Get workspace symbols from workspace_indexer
    - Pass them to document_store.update()
    - _Requirements: 5.2_

- [ ] 6. Checkpoint - Verify end-to-end integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Write property tests for c_local definition position
  - [ ] 7.1 Write property test for definition position tracking
    - **Property 5: c_local Definition Position**
    - **Validates: Requirements 4.1**
  - [ ] 7.2 Write property test for forward reference detection
    - **Property 6: c_local Forward Reference Detection**
    - **Validates: Requirements 4.2**
  - [ ] 7.3 Write property test for post-call reference
    - **Property 7: c_local Post-Call Reference**
    - **Validates: Requirements 4.3**

- [ ] 8. Write integration test for real-world scenario
  - [ ] 8.1 Write integration test using bh_merge example
    - Test that calling bh_merge and referencing bh_merge_bh_vars_final produces no warning
    - **Validates: Requirements 1.3, 2.1, 2.2**

- [ ] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- The implementation is minimal because existing infrastructure already handles c_locals correctly
- The key change is passing workspace symbols to the Analyzer so it can look up cross-file programs
- Forward and backward scope resolution already preserve c_locals via merge_symbol_tables
