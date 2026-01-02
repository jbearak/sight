---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This specification addresses the recognition of Stata's extended macro functions in macro definitions. Currently, the LSP does not recognize macros defined using extended macro function syntax (e.g., `local name: list a - b`), causing false positive "Undefined local macro" warnings.

Extended macro functions are a powerful Stata feature that allows macros to be defined using various operations like list manipulation, string functions, and property queries. The syntax uses a colon (`:`) after the macro name followed by the function name and arguments.

## Glossary

- **Extended_Macro_Function**: A Stata syntax for defining macros using built-in functions, written as `local name: function args` or `global name: function args`
- **List_Function**: Extended macro functions that operate on lists (e.g., `list a - b`, `list a & b`, `list a | b`)
- **Diagnostic_Provider**: The LSP component that analyzes code and reports errors/warnings
- **Macro_Definition**: A statement that creates or assigns a value to a macro

## Requirements

### Requirement 1: Extended Macro Function Definition Recognition

**User Story:** As a Stata developer, I want the LSP to recognize macros defined using extended macro function syntax, so that I don't receive false "Undefined local macro" warnings.

#### Acceptance Criteria

1. WHEN a `local name: function args` statement is encountered, THE Diagnostic_Provider SHALL recognize it as a valid macro definition for `name`
2. WHEN a `global name: function args` statement is encountered, THE Diagnostic_Provider SHALL recognize it as a valid macro definition for `name`
3. THE Diagnostic_Provider SHALL NOT report "Undefined local macro" for macros defined using extended macro function syntax
4. WHEN the defined macro is subsequently used, THE Diagnostic_Provider SHALL recognize it as defined

### Requirement 2: List Function Recognition

**User Story:** As a Stata developer, I want the LSP to recognize all list manipulation functions in extended macro syntax, so that common patterns like set operations work correctly.

#### Acceptance Criteria

1. WHEN `local name: list a - b` (set difference) is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
2. WHEN `local name: list a & b` (set intersection) is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
3. WHEN `local name: list a | b` (set union) is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
4. WHEN `local name: list sizeof a` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
5. WHEN `local name: list posof "item" in a` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
6. WHEN `local name: list sort a` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
7. WHEN `local name: list uniq a` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
8. WHEN `local name: list dups a` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
9. WHEN `local name: list clean a` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined

### Requirement 3: Other Extended Macro Functions

**User Story:** As a Stata developer, I want the LSP to recognize other common extended macro functions, so that various macro definition patterns work correctly.

#### Acceptance Criteria

1. WHEN `local name: word count string` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
2. WHEN `local name: word # of string` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
3. WHEN `local name: subinstr local a "from" "to"` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
4. WHEN `local name: type varname` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
5. WHEN `local name: format varname` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
6. WHEN `local name: label varname` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
7. WHEN `local name: variable label varname` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
8. WHEN `local name: value label varname` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
9. WHEN `local name: data label` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
10. WHEN `local name: display expr` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
11. WHEN `local name: length local macname` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
12. WHEN `local name: piece # # of string` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
13. WHEN `local name: permname suggested_name` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
14. WHEN `local name: tempvar` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined
15. WHEN `local name: tempfile` is encountered, THE Diagnostic_Provider SHALL recognize `name` as defined

### Requirement 4: Macro References in Extended Functions

**User Story:** As a Stata developer, I want the LSP to correctly identify macro references within extended macro function arguments, so that undefined macro warnings are accurate.

#### Acceptance Criteria

1. WHEN `local name: list a - b` is encountered, THE Diagnostic_Provider SHALL recognize that `a` and `b` are macro references
2. IF a macro referenced in an extended function argument is undefined, THE Diagnostic_Provider SHALL report "Undefined local macro" for that reference
3. THE Diagnostic_Provider SHALL distinguish between the macro being defined (left of colon) and macros being referenced (in function arguments)
4. WHEN `local name: list a & b` is encountered, THE Diagnostic_Provider SHALL check both `a` and `b` for being defined
5. WHEN `local name: list a | b` is encountered, THE Diagnostic_Provider SHALL check both `a` and `b` for being defined
6. WHEN `local name: list a - b` is encountered, THE Diagnostic_Provider SHALL check both `a` and `b` for being defined
7. WHEN `local name: list sizeof a` is encountered, THE Diagnostic_Provider SHALL check if `a` is defined
8. WHEN `local name: list sort a`, `list uniq a`, `list dups a`, or `list clean a` is encountered, THE Diagnostic_Provider SHALL check if `a` is defined

### Requirement 5: Completion Support for Extended Function Arguments

**User Story:** As a Stata developer, I want the LSP to provide macro completions when typing extended macro function arguments, so that I can easily reference existing macros.

#### Acceptance Criteria

1. WHEN the cursor is positioned after `local name: list ` THE Completion_Provider SHALL suggest defined local macros
2. WHEN the cursor is positioned after `local name: list a - ` THE Completion_Provider SHALL suggest defined local macros
3. WHEN the cursor is positioned after `local name: list a & ` THE Completion_Provider SHALL suggest defined local macros
4. WHEN the cursor is positioned after `local name: list a | ` THE Completion_Provider SHALL suggest defined local macros
5. THE Completion_Provider SHALL filter suggestions based on the typed prefix

### Requirement 6: Parser Support for Extended Macro Syntax

**User Story:** As a Stata developer, I want the parser to correctly parse extended macro function syntax, so that the AST accurately represents these constructs.

#### Acceptance Criteria

1. WHEN parsing `local name: function args`, THE Parser SHALL create a macro definition node with the extended function information
2. THE Parser SHALL preserve the function name and arguments in the AST node
3. THE Parser SHALL handle whitespace variations in extended macro syntax (e.g., `local x:list a-b` vs `local x : list a - b`)
4. THE Parser SHALL identify the positions of macro references within extended function arguments for accurate diagnostics and completions

