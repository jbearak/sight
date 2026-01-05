# Requirements Document

## Introduction

The AST formatter (PrettyPrinter) currently modifies content inside string literals when formatting expressions. When a string literal contains macro references or other tokens, the `format_expression_spacing()` function adds spaces around these tokens, corrupting the string content. For example, `` `"`macro'"' `` becomes `` `" `macro' "' ``, which changes the semantic meaning of the code.

This is a follow-up to the ast-formatter-token-spacing spec. While that spec correctly implemented protected region detection in the `format_expression_spacing()` function, the issue may be in the PrettyPrinter calling `format_expression_spacing()` on string literal values, or potentially in how the AST represents string literals.

The AST formatter should preserve string literals exactly as they appear in the source, without any spacing modifications to their content.

## Scope

- **Changes**: Only the AST formatter (PrettyPrinter) will be modified
- **Testing**: Tests must run against both formatter modes (AST and source-preserving) to ensure consistent behavior
- **Priority**: String literal preservation issues should be fixed first, followed by macro extended function spacing

## Concrete Test Case

The following input document MUST be preserved exactly by the AST formatter:

**Input:**
```stata
if (`"`macro'"') {
    `"`macro'"'
    "`macro'"
    `"text"'
    "text"
}
else {
    `"`macro'"'
    "`macro'"
    `"text"'
    "text"
}
di `" `macro' "'
di " `macro' "
di " text "
`" `macro' "'
" `macro' "
"text"
```

**Current (incorrect) output:**
```stata
if (`" `macro' "') {
    `macro' "'
    `macro' "
}
else {
    `macro' "'
    `macro' "
}
di `"  `macro'  "'
di "  `macro'  "
di " text "
`macro'  "'
`macro'  "

```

**Expected output:** The input document should be reproduced exactly as-is.

## Additional Test Cases

### Macro Extended Function Spacing

**Input:**
```stata
local macro : other_macro - another_macro
```

**Current (incorrect) output:**
```stata
local macro : other_macro -another_macro
```

**Expected output:** The input should be preserved exactly (space after `-` must be retained).

### Strings in Control Flow Conditions

**Input:**
```stata
if "`myvar'" == "value" {
    display "match"
}
```

**Expected output:** Preserved exactly.

### Strings Passed to User-Defined Programs

**Input:**
```stata
my_program `"`complex_string'"' "simple_string"
```

**Expected output:** Preserved exactly.

### Multi-line Compound Strings

**Input:**
```stata
local long_text `"This is a
multi-line
compound string"'
```

**Expected output:** Preserved exactly.

### Embedded Mata Block with String Literals

**Input:**
```stata
mata:
    st_local("result", `"`macro'"')
    printf("`macro'")
    printf(`" `macro' "')
end
```

**Expected output:** Preserved exactly (embedded blocks should pass through unchanged).

## Glossary

- **AST_Formatter**: The PrettyPrinter class that converts AST nodes back to Stata source code
- **String_Literal**: A double-quoted string ("...") or compound string (`` `"..."' ``) in Stata
- **Compound_String**: A Stata string delimited by `` `" `` and `` "' `` that can contain unbalanced quotes
- **Expression_Spacing**: The `format_expression_spacing()` function that adds spaces around operators in expressions
- **Token_Value**: The raw string value of a token as it appears in the source code

## Requirements

### Requirement 1: String Literal Content Preservation

**User Story:** As a developer, I want the AST formatter to preserve string literal content exactly as written, so that my string values are not corrupted by formatting.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a double-quoted string literal THEN the AST_Formatter SHALL output the string content exactly as it appears in the token value
2. WHEN the AST_Formatter outputs a compound string literal THEN the AST_Formatter SHALL output the string content exactly as it appears in the token value
3. WHEN a string literal contains macro references (e.g., `` `macro' `` or `$macro`) THEN the AST_Formatter SHALL NOT add spaces around the macro references
4. WHEN a string literal contains operators (e.g., `+`, `-`, `*`) THEN the AST_Formatter SHALL NOT add spaces around the operators
5. WHEN the AST_Formatter outputs a string literal THEN the AST_Formatter SHALL preserve all delimiters (opening and closing quotes)
6. WHEN the AST_Formatter outputs a standalone string literal on its own line THEN the AST_Formatter SHALL NOT delete the string literal

### Requirement 2: Expression Context Distinction

**User Story:** As a developer, I want the AST formatter to distinguish between expression contexts and string contexts, so that spacing is only applied where appropriate.

#### Acceptance Criteria

1. WHEN the AST_Formatter processes an expression node (ifExpression, inExpression, assignment) THEN the AST_Formatter SHALL apply expression spacing rules
2. WHEN the AST_Formatter processes a string literal node THEN the AST_Formatter SHALL NOT apply expression spacing rules
3. WHEN the AST_Formatter processes option arguments THEN the AST_Formatter SHALL apply expression spacing rules only to non-string content
4. WHEN the AST_Formatter processes macro extended function syntax (e.g., `: other_macro - another_macro`) THEN the AST_Formatter SHALL preserve spaces both before and after operators

### Requirement 3: Nested String Preservation

**User Story:** As a developer, I want nested compound strings to be preserved exactly, so that complex string constructions are not corrupted.

#### Acceptance Criteria

1. WHEN a compound string contains nested compound strings (e.g., `` `"`"`nested'"'"' ``) THEN the AST_Formatter SHALL preserve the entire structure unchanged
2. WHEN a compound string contains local macro references (e.g., `` `"`macro'"' ``) THEN the AST_Formatter SHALL preserve the macro reference without added spaces
3. WHEN a compound string contains global macro references (e.g., `` `"$macro"' ``) THEN the AST_Formatter SHALL preserve the macro reference without added spaces
4. WHEN a compound string literal appears inside a block THEN the AST_Formatter SHALL preserve the opening delimiter (`` `" ``)

### Requirement 4: Round-Trip Consistency

**User Story:** As a developer, I want the AST formatter to produce output that matches the original source for string literals, so that formatting doesn't introduce unintended changes.

#### Acceptance Criteria

1. FOR ALL valid Stata source files containing string literals, parsing then formatting SHALL produce string literals identical to the original
2. FOR ALL compound strings with embedded macros, parsing then formatting SHALL preserve the exact content
3. FOR ALL string literals in control flow conditions, parsing then formatting SHALL preserve the exact content

### Requirement 5: Display Command String Preservation

**User Story:** As a developer, I want display commands with string arguments to be preserved exactly, so that my output formatting is not changed.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a display command with a string argument THEN the AST_Formatter SHALL preserve the string content exactly
2. WHEN the AST_Formatter outputs a display command with a compound string argument THEN the AST_Formatter SHALL preserve the compound string content exactly
3. WHEN the AST_Formatter outputs a display command with multiple string arguments THEN the AST_Formatter SHALL preserve each string content exactly

### Requirement 6: AST Investigation

**User Story:** As a developer, I want to ensure the AST correctly represents string literals, so that the formatter has accurate data to work with.

#### Acceptance Criteria

1. WHEN the parser creates an AST node for a string literal THEN the AST node SHALL contain the exact original string content including delimiters
2. WHEN the parser creates an AST node for a compound string THEN the AST node SHALL preserve the complete compound string structure
3. WHEN the parser creates an AST node for a string containing macros THEN the AST node SHALL preserve the macro syntax exactly as written

### Requirement 7: String Delimiter Preservation

**User Story:** As a developer, I want string delimiters to be preserved exactly, so that my strings remain syntactically valid after formatting.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a compound string THEN the AST_Formatter SHALL include the opening delimiter (`` `" ``)
2. WHEN the AST_Formatter outputs a compound string THEN the AST_Formatter SHALL include the closing delimiter (`` "' ``)
3. WHEN the AST_Formatter outputs a double-quoted string THEN the AST_Formatter SHALL include both opening and closing double quotes
4. IF a string literal's opening delimiter is missing from the output THEN the AST_Formatter SHALL be considered to have a bug

### Requirement 8: Concrete Test Case Verification

**User Story:** As a developer, I want the specific failing examples to be included as unit tests, so that we can verify the fix addresses the exact reported issues.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests with the exact input documents from the Concrete Test Case and Additional Test Cases sections
2. THE unit tests SHALL verify that the AST formatter output matches the input exactly
3. THE unit tests SHALL run against both formatter modes (AST and source-preserving) using dual-mode test helpers
4. IF the test fails THEN the test output SHALL clearly show the differences between expected and actual output
5. THE test suite SHALL include a test for embedded Mata blocks containing string literals with macros
