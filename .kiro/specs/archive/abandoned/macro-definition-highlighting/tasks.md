# Implementation Plan: Macro Definition Highlighting

## Overview

This plan implements TextMate grammar enhancements to highlight macro names at their definition site. The implementation modifies `client/syntaxes/stata.tmLanguage.json` to add capture groups for macro names in definition commands.

## Tasks

- [ ] 1. Add local macro definition highlighting
  - [ ] 1.1 Add pattern for `local` command with macro name capture
    - Modify `commands-macro` section in `stata.tmLanguage.json`
    - Pattern: `\\b(loc(a(l)?)?)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b`
    - Capture group 1: `keyword.macro.stata`
    - Capture group 4: `entity.name.variable.macro.local.stata`
    - Place before existing simple `local` pattern
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 1.2 Write property test for local macro definition highlighting
    - **Property 1: Macro Definition Name Highlighting (local portion)**
    - **Validates: Requirements 1.1**

- [ ] 2. Add global macro definition highlighting
  - [ ] 2.1 Add pattern for `global` command with macro name capture
    - Pattern: `\\b(gl(o(b(a(l)?)?)?)?)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b`
    - Capture group 1: `keyword.macro.stata`
    - Capture group 6: `entity.name.variable.macro.global.stata`
    - Place before existing simple `global` pattern
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 2.2 Write property test for global macro definition highlighting
    - **Property 1: Macro Definition Name Highlighting (global portion)**
    - **Validates: Requirements 2.1**

  - [ ] 2.3 Write property test for local vs global scope distinction
    - **Property 3: Local vs Global Scope Distinction**
    - **Validates: Requirements 4.2**

- [ ] 3. Add temp command definition highlighting
  - [ ] 3.1 Add pattern for `tempvar`, `tempname`, `tempfile` with macro name capture
    - Pattern: `\\b(tempvar|tempname|tempfile)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b`
    - Capture group 1: `keyword.macro.stata`
    - Capture group 2: `entity.name.variable.macro.temp.stata`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.2 Write property test for temp command highlighting
    - **Property 4: Temp Command Name Highlighting**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 4. Checkpoint - Verify grammar changes
  - Ensure all tests pass, ask the user if questions arise.
  - Manually verify highlighting in VS Code with test file

- [ ] 5. Add regression tests
  - [ ] 5.1 Write property test for dereference highlighting preservation
    - **Property 5: Dereference Highlighting Preservation**
    - **Validates: Requirements 5.1**

  - [ ] 5.2 Write unit tests for edge cases
    - Test command without macro name
    - Test assignment with `=` operator
    - Test invalid macro names (starting with number)
    - _Requirements: 5.2, 5.3_

- [ ] 6. Add abbreviation equivalence tests
  - [ ] 6.1 Write property test for command abbreviation equivalence
    - **Property 2: Command Abbreviation Equivalence**
    - **Validates: Requirements 1.2, 2.2**

- [ ] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- The TextMate grammar is a static JSON file, so changes take effect immediately on reload
- Property tests use fast-check with the existing textmate-grammar test infrastructure
