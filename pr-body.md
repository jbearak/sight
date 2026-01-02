## Summary

Adds diagnostic detection for stray tokens that appear after comparison expressions in `if` and `in` qualifier conditions. For example, `if (x == y oops)` or `if x == y oops` now emit a diagnostic warning on the unexpected token.

## Changes

### New Error Codes
- `STRAY_TOKEN_IN_CONDITION = 3013` - for unexpected tokens after comparisons
- `SPLIT_LITERAL_IN_CONDITION = 3014` - for split literal patterns like `. 9`

### Parser Enhancements
- State machine in `parseIfQualifierExpression()` and `parseInQualifierExpression()` with states: INITIAL, AFTER_OPERAND, AFTER_COMPARE, AFTER_RHS
- Helper methods: `isComparisonOperator()`, `isLogicalOperator()`, `isArithmeticOperator()`, `isValidAfterComparison()`
- `detectSplitLiteral()` for patterns like `. 9` → `.9`, `. a` → `.a` (extended missing)

### Features
- Detects stray tokens after all comparison operators (`==`, `!=`, `~=`, `<`, `>`, `<=`, `>=`)
- Handles nested parentheses correctly
- Handles negation operators (`!`, `~`)
- Works across continuation lines (`///`)
- No false positives for valid compound expressions with `&`, `|`, arithmetic operators

### Tests
- 35 unit tests covering basic cases, edge cases, and diagnostic quality
- 8 property-based tests with 100 iterations each

## Spec
See `.kiro/specs/stray-token-in-condition/` for requirements, design, and task list.
