---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - macro-creating-options-first-definition: [Related other spec]
---

# Egen Command Parsing

## Overview

This specification addresses the parsing and analysis of `egen` commands, which have unique syntax patterns and variable creation semantics that require special handling in the LSP.

## Problem Statement

The `egen` command has a distinctive syntax that differs from standard Stata commands:
- `egen newvar = function(arguments) [if] [in] [, options]`
- Creates new variables with specific naming patterns
- Has function-specific argument parsing requirements
- Requires special handling for variable registration and completion

## Requirements

### R1: Egen Syntax Recognition
- The parser MUST recognize `egen` command syntax patterns
- Variable creation on the left side of `=` MUST be properly identified
- Function names and arguments MUST be parsed correctly
- Conditional expressions (`if`/`in`) MUST be handled appropriately

### R2: Variable Registration
- New variables created by `egen` MUST be registered in the symbol table
- Variable types SHOULD be inferred when possible based on the function used
- Variable registration MUST occur at the correct scope level

### R3: Function-Specific Parsing
- Different `egen` functions MAY have different argument patterns
- Common functions (mean, sum, count, etc.) SHOULD have specialized parsing
- Unknown functions SHOULD fall back to generic argument parsing

### R4: Completion Support
- Variable name completion SHOULD be available for `egen` arguments
- Function name completion SHOULD be provided after the `=` sign
- Option completion SHOULD be context-aware for the specific function

## Egen Function Categories

### Statistical Functions
- `mean()`, `median()`, `sum()`, `count()`, `min()`, `max()`
- `sd()`, `iqr()`, `pctile()`

### String Functions
- `concat()`, `ends()`, `group()`

### Other Functions
- `seq()`, `fill()`, `rank()`

## Test Cases

### Test Case 1: Basic Egen Parsing
```stata
egen avg_score = mean(score), by(group)
// Should register `avg_score` as a new variable
// Should recognize `score` and `group` as existing variables
```

### Test Case 2: Complex Arguments
```stata
egen total = sum(value) if category == "A", by(region year)
// Should parse conditional expression
// Should handle multiple by-variables
```

### Test Case 3: String Function
```stata
egen fullname = concat(firstname lastname), punct(" ")
// Should handle multiple arguments to concat
// Should recognize string function pattern
```

## Success Criteria

- Egen commands are parsed correctly
- New variables are properly registered
- Completion works for all argument positions
- Function-specific syntax is handled appropriately