---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - embedded-language-detection: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This specification addresses gaps in property-based test coverage identified during a review of all specs in the Stata LSP workspace. While the test suite has 443 passing tests with good unit and integration coverage, several critical correctness properties from the design documents lack dedicated property-based tests. This spec adds those missing property tests to ensure the LSP implementation is rigorously validated.

## Glossary

- **Property_Based_Test**: A test that verifies a universal property holds across many randomly generated inputs
- **Round_Trip_Property**: The property that parsing then printing then parsing produces an equivalent result
- **AST_Equivalence**: Two ASTs are equivalent if they have identical node structure, token content, and trivia content (ignoring source ranges)
- **Generator**: A function that produces random valid inputs for property testing
- **Shrinking**: The process of finding minimal failing examples when a property test fails

## Requirements

### Requirement 1: Parser Round-Trip Property Test

**User Story:** As a developer, I want to verify that the parser and pretty-printer are inverses, so that formatting never corrupts code.

#### Acceptance Criteria

1. FOR ALL valid Stata ASTs, printing then parsing SHALL produce an equivalent AST
2. THE Property_Test SHALL use a generator that produces valid AST nodes (commands, programs, macros, control flow)
3. THE Property_Test SHALL define AST equivalence as identical node structure, token content, and trivia content, ignoring source ranges
4. THE Property_Test SHALL run minimum 100 iterations
5. WHEN the property fails, THE Property_Test SHALL provide a minimal failing example via shrinking

### Requirement 2: Lexer Tokenization Property Test

**User Story:** As a developer, I want to verify that the lexer correctly tokenizes all valid Stata source code, so that parsing is accurate.

#### Acceptance Criteria

1. FOR ALL valid Stata source code, THE Lexer SHALL produce tokens that can be concatenated back to the original source (modulo whitespace normalization)
2. THE Property_Test SHALL verify delimiter mode handling (`#delimit cr` vs `#delimit ;`)
3. THE Property_Test SHALL verify `///` continuation handling
4. THE Property_Test SHALL verify string boundary detection (simple and compound quotes)
5. THE Property_Test SHALL verify `${name}` is tokenized as a single MACRO_REF_GLOBAL token
6. THE Property_Test SHALL verify tokens have accurate source spans

### Requirement 3: Completion Relevance Property Test

**User Story:** As a developer, I want to verify that completions are always relevant to the context, so that users get useful suggestions.

#### Acceptance Criteria

1. FOR ALL command completion contexts, THE Completion_Provider SHALL return items that match the prefix
2. FOR ALL macro completion contexts, THE Completion_Provider SHALL return defined macros
3. FOR ALL option completion contexts, THE Completion_Provider SHALL return valid options for the current command
4. THE Property_Test SHALL verify user-defined symbols take precedence over built-ins

### Requirement 4: Diagnostic Accuracy Property Test

**User Story:** As a developer, I want to verify that diagnostics are accurate and don't accumulate, so that users see correct error information.

#### Acceptance Criteria

1. FOR ALL malformed Stata source code, THE Diagnostics_Provider SHALL report errors at accurate positions
2. FOR ALL valid Stata source code, THE Diagnostics_Provider SHALL NOT report false positive errors
3. THE Property_Test SHALL verify diagnostics are cleared on document update
4. THE Property_Test SHALL verify specific error patterns are detected:
   - `} else {` on same line
   - Closing brace not alone on line
   - `program define` without `end`
   - Unclosed block structures
   - Unbalanced string quotes

### Requirement 5: Formatting Semantic Preservation Property Test

**User Story:** As a developer, I want to verify that formatting preserves semantic meaning, so that formatted code behaves identically.

#### Acceptance Criteria

1. FOR ALL valid Stata documents, formatting SHALL produce code that parses to an equivalent AST
2. THE Property_Test SHALL verify only whitespace and indentation change
3. THE Property_Test SHALL verify comments are preserved and associated with the same nodes
4. THE Property_Test SHALL verify no token normalization occurs (abbreviations NOT expanded)

### Requirement 6: Go-to-Definition Correctness Property Test

**User Story:** As a developer, I want to verify that go-to-definition always returns correct locations, so that navigation is reliable.

#### Acceptance Criteria

1. FOR ALL defined symbols (macros, programs), go-to-definition SHALL return the definition location
2. FOR ALL undefined symbols, go-to-definition SHALL return an empty result (not an error)
3. THE Property_Test SHALL verify local macro definitions are found within the current file
4. THE Property_Test SHALL verify global macro definitions are found across files

### Requirement 7: Hover Information Completeness Property Test

**User Story:** As a developer, I want to verify that hover provides complete information, so that users can understand code without leaving the editor.

#### Acceptance Criteria

1. FOR ALL built-in commands, hover SHALL return syntax and description
2. FOR ALL user-defined macros, hover SHALL return definition location and value
3. FOR ALL user-defined programs, hover SHALL return signature and location
4. THE Property_Test SHALL verify hover returns null for non-hoverable positions

### Requirement 8: Symbol Information Completeness Property Test

**User Story:** As a developer, I want to verify that document symbols include all defined symbols, so that the outline view is complete.

#### Acceptance Criteria

1. FOR ALL documents with programs, THE Symbol_Provider SHALL include all programs in document symbols
2. FOR ALL documents with macros, THE Symbol_Provider SHALL include all macros in document symbols
3. THE Property_Test SHALL verify symbol kind, name, and location are correct
4. THE Property_Test SHALL verify embedded language blocks appear as structural elements
