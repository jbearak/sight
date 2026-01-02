# Implementation Plan: Forward Macro Reference Detection

## Overview

This implementation adds position-aware undefined macro detection to the Semantic Analyzer using preorder traversal indices. The changes are localized to `src/analyzer/index.ts` with a minor type addition.

## Tasks

- [x] 1. MUST: Reset preorder_index at start of analyze()
  - Add `this.preorder_index = 0;` as the FIRST line in analyze() method
  - This MUST happen before any other initialization
  - Failure to reset causes silent bugs when analyzer instance is reused
  - _Requirements: 4.4_

- [x] 2. Add definition_index field to MacroSymbol type
  - Add optional `definition_index?: number` field to MacroSymbol interface in src/types/index.ts
  - Uses snake_case to match codebase style
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Create shared AST traversal helper
  - [x] 3.1 Add traverse_ast_preorder method to SemanticAnalyzer
    - Takes nodes array and callback function
    - Increments preorder_index for each node BEFORE calling callback
    - Does NOT recurse into bodies - callers handle recursion with proper scope
    - _Requirements: 1.1, 3.5_
  - [x] 3.2 Refactor build_symbols to use traverse_ast_preorder
    - Replace manual loop with traverse_ast_preorder call
    - Pass node_index to process_node
    - _Requirements: 1.1_
  - [x] 3.3 Refactor detect_undefined_references to use traverse_ast_preorder
    - Reset preorder_index to 0 in analyze() before third pass
    - Replace manual loop with traverse_ast_preorder call
    - Pass node_index to check_node_references
    - _Requirements: 1.1, 3.5_

- [x] 4. Store definition_index when registering macros
  - [x] 4.1 Audit all macro registration points
    - Search: `grep -n "localMacros.set\|globalMacros.set" src/analyzer/index.ts`
    - Document each location found
    - _Requirements: 1.1_
  - [x] 4.2 Update process_macro_def
    - Accept node_index parameter
    - Check for existing macro; preserve existing definition_index if present (first definition wins)
    - Otherwise use current node_index
    - _Requirements: 1.1, 1.3_
  - [x] 4.3 Update process_loop
    - Accept node_index parameter
    - Set definition_index to loop header's node_index for loop variable
    - _Requirements: 3.2_
  - [x] 4.4 Update extract_tempvar_macro
    - Accept node_index parameter
    - Set definition_index for tempvar/tempfile/tempname macros
    - _Requirements: 3.3_
  - [x] 4.5 Update extract_unab_macro
    - Accept node_index parameter
    - Set definition_index for unab macro
    - _Requirements: 3.3_
  - [x] 4.6 Update register_implicit_locals
    - Accept node_index parameter
    - Set definition_index for syntax command implicit locals
    - _Requirements: 3.4_

- [x] 5. Implement position-aware reference checking
  - [x] 5.1 Modify is_macro_defined to accept reference_index parameter
    - Add optional reference_index parameter
    - Compare against macro's definition_index when both are present
    - Return false if reference_index < definition_index (forward reference)
    - Skip position check for workspace globals (they're from other files)
    - _Requirements: 1.1, 1.2, 2.1, 2.2_
  - [x] 5.2 Update check_macro_reference to pass reference_index
    - Pass current node_index to is_macro_defined
    - _Requirements: 1.1_
  - [x] 5.3 Update check_extended_macro_reference to pass reference_index
    - Pass current node_index to is_macro_defined
    - _Requirements: 1.1_
  - [x] 5.4 Update check_token_macro_references
    - Note: Token-based checking does not have preorder indices; forward reference detection only works for AST-based macro references (extended functions)
    - _Requirements: 1.1, 2.1_

- [x] 6. Write property test for forward reference detection
  - **Property 1: Forward references produce warnings**
  - Generate Stata code with macro reference before definition
  - Verify analyzer produces undefined macro warning
  - Minimum 100 iterations
  - **Validates: Requirements 1.1, 2.1**

- [x] 7. Write property test for properly ordered references
  - **Property 2: Properly ordered references produce no warnings**
  - Generate Stata code with macro definition before reference
  - Verify analyzer produces no undefined macro warning
  - Minimum 100 iterations
  - **Validates: Requirements 1.2, 3.1**

- [x] 8. Write property test for first definition boundary
  - **Property 3: First definition determines forward reference boundary**
  - Generate Stata code with multiple macro definitions
  - Verify references before first definition warn, after don't
  - Minimum 100 iterations
  - **Validates: Requirements 1.3**

- [x] 9. Write property test for workspace globals
  - **Property 4: Workspace globals bypass position checking**
  - Create workspace symbols with global macro (simulating external file)
  - Verify references don't warn regardless of position
  - Minimum 100 iterations
  - **Validates: Requirements 2.2**

- [x] 10. Write property test for nested forward references
  - **Property 5: Nested forward references are detected**
  - Generate program blocks with inner forward references
  - Verify warnings produced for references before inner definitions
  - Minimum 100 iterations
  - **Validates: Requirements 3.5**

- [x] 11. Write unit tests for edge cases
  - Test loop variable references (inside body vs before loop)
  - Test tempvar/tempfile/tempname macro references (before and after)
  - Test positional arguments (`0', `1', etc.) - not applicable to extended function refs
  - Test @lsp-ignore-next directive with forward references - not applicable to extended function refs
  - Test same-line multi-statement with `#delimit ;` - not applicable to extended function refs
  - Test embedded Mata/Python blocks (no Stata macro warnings) - not applicable to extended function refs
  - Test analyzer instance reuse (preorder_index reset between documents)
  - Test file-local global vs workspace global distinction
  - **Validates: Requirements 1.4, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4**

- [x] 12. Update documentation
  - [x] 12.1 Update AGENTS.md with forward reference detection behavior
    - Add section explaining that undefined macro detection considers execution order
    - Document the distinction between file-local and workspace globals
    - _Requirements: All_
  - [x] 12.2 Update README.md with user-facing documentation
    - Add section on forward reference detection under diagnostics/features
    - Explain: Local macros must be defined before use (execution order)
    - Explain: Global macros in the same file must be defined before use
    - Explain: Global macros from other workspace files are assumed defined
    - Provide examples of forward reference warnings and how to fix them
    - _Requirements: All_

- [x] 13. Checkpoint - Run tests and verify
  - Run `bun test` to execute all tests
  - Verify all new tests pass
  - Verify full test suite passes (no regressions)
  - Verify property tests complete 100+ iterations
  - If tests fail: fix issues and re-run until all pass
  - Ask user if questions arise

## Implementation Notes

### Key Design Decisions

1. **Traversal helper does not recurse**: The `traverse_ast_preorder` method only increments the index and calls the callback. Recursion into program/control_flow bodies is handled by the callers (`process_program`, `process_control_flow`, `detect_undefined_references`) to maintain proper scope tracking.

2. **First definition wins**: When a macro is defined multiple times, only the first definition's `definition_index` is preserved. This matches Stata's behavior where a macro becomes "available" at its first definition point.

3. **Token-based checking limitation**: The token-based macro reference checking (`check_token_macro_references`) does not have preorder indices, so forward reference detection only works for AST-based macro references (primarily extended function macro references like `local result: list a - b`).

4. **Workspace globals bypass position checking**: Global macros from `workspace_symbols` (defined in other files) are assumed to be defined and bypass position checking entirely.

### Files Modified

- `src/types/index.ts`: Added `definition_index?: number` to `MacroSymbol` interface
- `src/analyzer/index.ts`: 
  - Added `preorder_index` instance variable
  - Added `traverse_ast_preorder` method
  - Updated all macro registration methods to accept and store `node_index`
  - Updated `is_macro_defined` to compare positions
  - Reset `preorder_index` at start of `analyze()` and before reference checking pass

### Test Files Added

- `tests/unit/forward-reference-detection.test.ts`: Unit tests for edge cases
- `tests/property/forward-reference-detection.prop.test.ts`: Property-based tests with fast-check

## User-Facing Behavior Summary (for documentation)

The LSP now detects "forward references" - using a macro before it's defined:

**Local macros (`local name value`):**
- Must be defined before use within the same file
- Warning: "Undefined local macro: \`name'" if referenced before definition

**Global macros in the same file (`global name value`):**
- Must be defined before use within the same file
- Warning: "Undefined global macro: name" if referenced before definition

**Global macros from other workspace files:**
- Assumed to be defined (no position checking)
- The workspace indexer tracks globals across files
- No warning even if referenced "early" in the current file

**Why this matters:**
Stata executes code sequentially. A macro doesn't exist until the line defining it runs. The LSP now catches bugs like:
```stata
local result: list fruit - other  // Warning: `fruit' not yet defined
local fruit apple banana
local other banana
```
