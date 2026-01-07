# Requirements Document

## Introduction

This specification addresses a code quality issue identified in PR 31: the LPAREN (parenthesized group) handling logic in the Stata parser is duplicated between `parseCommand` and `parseCommandBody` methods. This duplication violates the DRY (Don't Repeat Yourself) principle and creates maintenance burden. The refactoring will extract the parenthesized group parsing logic into a shared private method that both methods can use, ensuring consistent behavior and easier maintenance.

## Glossary

- **Parser**: The `StataParser` class in `src/parser/index.ts` that converts tokens into an Abstract Syntax Tree (AST)
- **LPAREN**: Left parenthesis token type representing `(`
- **RPAREN**: Right parenthesis token type representing `)`
- **Parenthesized_Group**: A varlist item enclosed in parentheses, e.g., `(var1 var2)` in `getmata (var1 var2)=matrix`
- **Varlist**: A list of variable/identifier nodes parsed as command arguments
- **parseCommand**: The main method for parsing Stata commands
- **parseCommandBody**: A helper method for parsing command body (varlist, expression, qualifiers, options) after the command name has been consumed
- **Nested_Parentheses**: Parentheses within parentheses, e.g., `((a b))`

## Requirements

### Requirement 1: Extract Shared Parenthesized Group Parsing Method

**User Story:** As a maintainer, I want the parenthesized group parsing logic extracted into a single shared method, so that I can maintain and update the logic in one place.

#### Acceptance Criteria

1. THE Parser SHALL provide a private method `parseParenthesizedGroup` that handles LPAREN token parsing
2. WHEN `parseParenthesizedGroup` is called, THE Parser SHALL consume the opening LPAREN token
3. WHEN parsing a parenthesized group, THE Parser SHALL track nested parenthesis depth correctly
4. WHEN parsing a parenthesized group, THE Parser SHALL preserve spacing between consecutive word-like tokens
5. WHEN the closing RPAREN is reached at depth 0, THE Parser SHALL consume it and return the parsed content
6. THE `parseParenthesizedGroup` method SHALL return an `IdentifierNode` containing the parenthesized content with surrounding parentheses

### Requirement 2: Refactor parseCommand to Use Shared Method

**User Story:** As a maintainer, I want `parseCommand` to use the shared parenthesized group parsing method, so that the code is not duplicated.

#### Acceptance Criteria

1. WHEN `parseCommand` encounters an LPAREN token in the varlist parsing loop, THE Parser SHALL delegate to `parseParenthesizedGroup`
2. THE Parser SHALL remove the inline LPAREN handling code from `parseCommand`
3. WHEN parsing commands like `getmata (var1 var2)=matrix`, THE Parser SHALL produce identical AST output as before the refactoring

### Requirement 3: Refactor parseCommandBody to Use Shared Method

**User Story:** As a maintainer, I want `parseCommandBody` to use the shared parenthesized group parsing method, so that the code is not duplicated.

#### Acceptance Criteria

1. WHEN `parseCommandBody` encounters an LPAREN token in the varlist parsing loop, THE Parser SHALL delegate to `parseParenthesizedGroup`
2. THE Parser SHALL remove the inline LPAREN handling code from `parseCommandBody`
3. WHEN parsing frame-prefixed commands like `frame myframe: getmata (xy)=m`, THE Parser SHALL produce identical AST output as before the refactoring

### Requirement 4: Maintain Parsing Consistency

**User Story:** As a developer, I want the refactored parser to produce identical results for all existing test cases, so that the refactoring does not introduce regressions.

#### Acceptance Criteria

1. FOR ALL valid Stata commands with parenthesized groups, parsing then comparing AST output SHALL produce equivalent results before and after refactoring
2. WHEN parsing nested parentheses like `((a b))`, THE Parser SHALL correctly track depth and produce `((a b))` as the content
3. WHEN parsing parenthesized groups followed by assignment operators, THE Parser SHALL correctly parse the subsequent `=` and expression tokens
4. WHEN parsing direct commands and frame-prefixed commands with identical parenthesized groups, THE Parser SHALL produce equivalent varlist content

### Requirement 5: Handle Edge Cases Consistently

**User Story:** As a developer, I want edge cases in parenthesized group parsing to be handled consistently, so that the parser behaves predictably.

#### Acceptance Criteria

1. WHEN parsing an unclosed parenthesized group (missing RPAREN), THE Parser SHALL handle it gracefully without crashing
2. WHEN parsing an empty parenthesized group `()`, THE Parser SHALL return an empty or whitespace-only content
3. WHEN parsing parenthesized groups containing macro references, THE Parser SHALL preserve the macro reference tokens
4. WHEN parsing parenthesized groups containing operators, THE Parser SHALL include them in the content
