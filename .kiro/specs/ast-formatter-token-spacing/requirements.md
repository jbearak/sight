# Requirements Document

## Introduction

The AST formatter (PrettyPrinter) currently produces output with missing spaces between tokens in expressions. When the lexer tokenizes Stata code, it strips whitespace tokens, and when the parser builds expression strings by concatenating token values, no spaces are added between operators and operands. This results in expressions like `y + z` being output as `y+z`, which while syntactically valid, is less readable and doesn't match the original formatting intent.

This feature will add intelligent token spacing to the AST formatter to produce properly spaced output while respecting Stata's syntax rules where spaces should not be added (e.g., inside parentheses like `if (x)` not `if ( x )`).

## Glossary

- **AST_Formatter**: The PrettyPrinter class that converts AST nodes back to Stata source code
- **Token_Spacing**: The whitespace characters between adjacent tokens in source code
- **Expression**: A Stata expression containing operators, operands, and function calls
- **Operator**: Arithmetic (+, -, *, /, ^), comparison (==, !=, <, >, <=, >=), or logical (&, |) operators
- **Operand**: Variables, numbers, strings, or macro references used with operators
- **Qualifier_Expression**: The expression following `if` or `in` qualifiers in Stata commands

## Requirements

### Requirement 0: String and Macro Literal Preservation

**User Story:** As a developer, I want the AST formatter to preserve the content of string literals and nested macro references, so that spacing changes don't alter the semantic meaning of my code.

#### Acceptance Criteria

1. WHEN the AST_Formatter encounters a string literal (double-quoted or compound) THEN the AST_Formatter SHALL NOT modify spacing within the string content
2. WHEN the AST_Formatter encounters a nested macro reference (e.g., `` `x`y'' `` or `` ${`x'`y'} ``) THEN the AST_Formatter SHALL NOT modify spacing within the macro reference
3. WHEN the AST_Formatter encounters a compound string containing expressions (e.g., `` `"`x'+`y'"' ``) THEN the AST_Formatter SHALL NOT modify spacing within the compound string

### Requirement 1: Operator Spacing

**User Story:** As a developer, I want the AST formatter to add spaces around operators in expressions, so that the formatted code is readable and follows common coding conventions.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs an arithmetic operator (+, -, *, /, ^) THEN the AST_Formatter SHALL add a space before and after the operator
2. WHEN the AST_Formatter outputs a comparison operator (==, !=, <, >, <=, >=) THEN the AST_Formatter SHALL add a space before and after the operator
3. WHEN the AST_Formatter outputs a logical operator (&, |) THEN the AST_Formatter SHALL add a space before and after the operator
4. WHEN the AST_Formatter outputs an assignment operator (=) THEN the AST_Formatter SHALL add a space before and after the operator

### Requirement 2: Parenthesis Spacing

**User Story:** As a developer, I want the AST formatter to handle parenthesis spacing correctly, so that control flow conditions and function calls follow Stata conventions.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs an opening parenthesis THEN the AST_Formatter SHALL NOT add a space after the opening parenthesis
2. WHEN the AST_Formatter outputs a closing parenthesis THEN the AST_Formatter SHALL NOT add a space before the closing parenthesis
3. WHEN the AST_Formatter outputs a function call THEN the AST_Formatter SHALL NOT add a space between the function name and opening parenthesis

### Requirement 3: Comma Spacing

**User Story:** As a developer, I want the AST formatter to add appropriate spacing around commas, so that option lists and function arguments are readable.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a comma THEN the AST_Formatter SHALL add a space after the comma
2. WHEN the AST_Formatter outputs a comma THEN the AST_Formatter SHALL NOT add a space before the comma

### Requirement 4: Keyword Spacing

**User Story:** As a developer, I want the AST formatter to add spaces around keywords in expressions, so that extended macro function syntax is readable.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs the keyword "of" in an extended macro function THEN the AST_Formatter SHALL add a space before and after the keyword
2. WHEN the AST_Formatter outputs the keyword "in" in a list expression THEN the AST_Formatter SHALL add a space before and after the keyword

### Requirement 5: Bracket Spacing

**User Story:** As a developer, I want the AST formatter to handle bracket spacing correctly, so that subscript expressions follow Stata conventions.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs an opening square bracket THEN the AST_Formatter SHALL NOT add a space before the opening bracket
2. WHEN the AST_Formatter outputs an opening square bracket THEN the AST_Formatter SHALL NOT add a space after the opening bracket
3. WHEN the AST_Formatter outputs a closing square bracket THEN the AST_Formatter SHALL NOT add a space before the closing bracket

### Requirement 6: Colon Spacing

**User Story:** As a developer, I want the AST formatter to handle colon spacing correctly for extended macro functions and by-prefix commands.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a colon in an extended macro function THEN the AST_Formatter SHALL add a space before and after the colon
2. WHEN the AST_Formatter outputs a colon after a by-prefix THEN the AST_Formatter SHALL NOT add a space before the colon
3. WHEN the AST_Formatter outputs a colon after a by-prefix THEN the AST_Formatter SHALL add a space after the colon

### Requirement 7: Curly Brace Spacing

**User Story:** As a developer, I want the AST formatter to handle curly brace spacing correctly for block delimiters.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs an opening curly brace THEN the AST_Formatter SHALL add a space before the opening brace
2. WHEN the AST_Formatter outputs an opening curly brace THEN the AST_Formatter SHALL NOT add a space after the opening brace
3. WHEN the AST_Formatter outputs a closing curly brace THEN the AST_Formatter SHALL NOT add a space before the closing brace
4. WHEN the AST_Formatter outputs a closing curly brace THEN the AST_Formatter SHALL NOT add a space after the closing brace

### Requirement 8: Unary Operator Spacing

**User Story:** As a developer, I want the AST formatter to handle unary operators correctly, so that negation and logical not are formatted properly.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a unary minus operator (at the start of an expression or after another operator) THEN the AST_Formatter SHALL NOT add a space between the operator and its operand
2. WHEN the AST_Formatter outputs a logical not operator (!) THEN the AST_Formatter SHALL NOT add a space between the operator and its operand
3. WHEN the AST_Formatter outputs a tilde negation operator (~) THEN the AST_Formatter SHALL NOT add a space between the operator and its operand
