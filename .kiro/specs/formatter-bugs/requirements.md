# Requirements Document

## Introduction

The Sight LSP formatter has multiple critical bugs that corrupt Stata source code when formatting is applied. The formatter uses a lossy AST reconstruction approach that fails to preserve essential code elements including syntax statements, spacing around operators, string delimiters, and token boundaries. This document specifies requirements for fixing these bugs to ensure the formatter produces valid, semantically equivalent Stata code.

## Glossary

- **Formatter**: The code formatting provider that transforms Stata source code according to formatting rules
- **Pretty_Printer**: The component that converts AST nodes back to valid Stata source code
- **AST**: Abstract Syntax Tree - the parsed representation of Stata source code
- **Syntax_Statement**: A Stata `syntax` command that declares program arguments and options
- **Compound_String**: A Stata string literal using backtick-double-quote delimiters (`` `"..."' ``)
- **Double_Quoted_String**: A Stata string literal using double-quote delimiters (`"..."`)
- **Local_Macro_Reference**: A reference to a local macro using backtick-apostrophe delimiters (`` `name' ``)
- **Qualifier**: Stata `if` or `in` expressions that filter command execution
- **Block_Comment**: A multi-line comment using `/* ... */` delimiters
- **Line_Comment**: A single-line comment using `//` or `*` prefix

## Requirements

### Requirement 1: Preserve Syntax Statements

**User Story:** As a Stata developer, I want the formatter to preserve syntax statements in my programs, so that my program definitions remain valid and functional.

#### Acceptance Criteria

1. WHEN the Formatter processes a program containing a syntax statement, THE Pretty_Printer SHALL output the syntax statement with all arguments and options preserved
2. WHEN a syntax statement contains optional arguments in brackets, THE Pretty_Printer SHALL preserve the bracket notation
3. WHEN a syntax statement contains options after a comma, THE Pretty_Printer SHALL preserve all options with their specifications

### Requirement 2: Maintain Token Spacing

**User Story:** As a Stata developer, I want the formatter to include necessary spacing between tokens, so that my commands remain syntactically valid.

#### Acceptance Criteria

1. WHEN the Formatter outputs a command with multiple arguments, THE Pretty_Printer SHALL include spaces between argument tokens
2. WHEN the Formatter outputs a merge command with key variables, THE Pretty_Printer SHALL include spaces between variable names (e.g., `merge 1:1 var1 var2 var3 using file`)
3. WHEN the Formatter outputs a command with a using clause, THE Pretty_Printer SHALL include a space before the `using` keyword

### Requirement 3: Maintain Operator Spacing

**User Story:** As a Stata developer, I want the formatter to include appropriate spacing around comparison and logical operators, so that my expressions remain readable and valid.

#### Acceptance Criteria

1. WHEN the Formatter outputs an expression with comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`), THE Pretty_Printer SHALL include spaces around the operators
2. WHEN the Formatter outputs an expression with logical operators (`&`, `|`), THE Pretty_Printer SHALL include spaces around the operators
3. WHEN the Formatter outputs an if-qualifier expression, THE Pretty_Printer SHALL include appropriate spacing around operators

### Requirement 4: Avoid Spurious String Delimiter Spacing

**User Story:** As a Stata developer, I want the formatter to not add spurious spaces inside string delimiters, so that my string literals remain valid.

#### Acceptance Criteria

1. WHEN the Formatter outputs a Compound_String, THE Pretty_Printer SHALL NOT add a space after the opening `` `" `` delimiter
2. WHEN the Formatter outputs a Compound_String, THE Pretty_Printer SHALL NOT add a space before the closing `` "' `` delimiter
3. WHEN the Formatter outputs a Double_Quoted_String, THE Pretty_Printer SHALL NOT add a space after the opening `"` delimiter
4. WHEN the Formatter outputs a Double_Quoted_String, THE Pretty_Printer SHALL NOT add a space before the closing `"` delimiter
5. FOR ALL valid string literals, formatting SHALL produce string content identical to the original

### Requirement 5: Avoid Spurious Parenthesis Spacing

**User Story:** As a Stata developer, I want the formatter to not add spurious spaces inside parentheses, so that my function calls and option arguments remain clean.

#### Acceptance Criteria

1. WHEN the Formatter outputs a parenthesized expression, THE Pretty_Printer SHALL NOT add a space after the opening parenthesis
2. WHEN the Formatter outputs a parenthesized expression, THE Pretty_Printer SHALL NOT add a space before the closing parenthesis
3. WHEN the Formatter outputs option arguments in parentheses, THE Pretty_Printer SHALL NOT add spurious internal spaces

### Requirement 6: Maintain Comment Alignment

**User Story:** As a Stata developer, I want the formatter to maintain proper comment indentation, so that my code documentation remains properly aligned.

#### Acceptance Criteria

1. WHEN the Formatter outputs a Block_Comment at the start of a block, THE Pretty_Printer SHALL align the opening `/*` with the block's indentation level
2. WHEN the Formatter outputs a Line_Comment at the start of a line, THE Pretty_Printer SHALL align it with the appropriate indentation level
3. WHEN a comment appears within indented code, THE Pretty_Printer SHALL match the surrounding code's indentation

### Requirement 7: Avoid Spurious Macro Reference Spacing

**User Story:** As a Stata developer, I want the formatter to not add spurious spaces inside local macro references, so that my macro expansions work correctly.

#### Acceptance Criteria

1. WHEN the Formatter outputs a Local_Macro_Reference, THE Pretty_Printer SHALL NOT add a space after the opening backtick
2. WHEN the Formatter outputs a Local_Macro_Reference, THE Pretty_Printer SHALL NOT add a space before the closing apostrophe
3. WHEN a Local_Macro_Reference appears in a using clause, THE Pretty_Printer SHALL output the reference without internal spacing changes

### Requirement 8: Preserve Continuation Lines

**User Story:** As a Stata developer, I want the formatter to preserve continuation lines (using `///` or `/**/`), so that my intentionally multi-line statements remain readable.

#### Acceptance Criteria

1. WHEN the Formatter processes a statement with `///` continuation markers, THE Pretty_Printer SHALL preserve the line breaks at continuation points
2. WHEN the Formatter processes a statement with `/**/` continuation markers, THE Pretty_Printer SHALL preserve the line breaks at continuation points
3. WHEN a statement spans multiple lines for readability, THE Pretty_Printer SHALL NOT collapse it into a single line

### Requirement 9: Correct Indentation

**User Story:** As a Stata developer, I want the formatter to fix incorrect indentation, so that my code structure is visually clear.

#### Acceptance Criteria

1. WHEN the Formatter processes code inside a block (program, if, foreach, forvalues, while), THE Pretty_Printer SHALL indent the block contents by the configured indent size
2. WHEN the Formatter processes nested blocks, THE Pretty_Printer SHALL apply cumulative indentation for each nesting level
3. WHEN the Formatter processes a closing brace or `end` statement, THE Pretty_Printer SHALL align it with the corresponding opening statement
4. WHEN the Formatter processes continuation lines, THE Pretty_Printer SHALL indent continuation content by one indent level past the statement start

### Requirement 10: Produce Valid Output

**User Story:** As a Stata developer, I want the formatter to produce output that is syntactically valid Stata code, so that formatting doesn't break my code.

#### Acceptance Criteria

1. FOR ALL valid Stata programs, formatting SHALL produce syntactically valid Stata code
2. FOR ALL Stata commands, formatting SHALL produce output that Stata can execute without syntax errors
3. IF the Formatter cannot produce valid output, THEN the Formatter SHALL return no edits rather than corrupt the code
