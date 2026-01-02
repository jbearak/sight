---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - egen-command-parsing: [Related other spec]
---

# Macro-Creating Options First Definition

## Overview

This specification addresses the handling of first definition semantics for macro-creating options in Stata commands, ensuring that the first occurrence of a macro-creating option takes precedence when multiple definitions exist.

## Problem Statement

When Stata commands have options that create macros (like `local()` or `global()` options), and these options are specified multiple times in a single command, Stata uses "first definition wins" semantics. The LSP should accurately model this behavior for proper symbol resolution and diagnostics.

## Requirements

### R1: First Definition Precedence
- When a macro-creating option appears multiple times, the FIRST occurrence MUST take precedence
- Subsequent occurrences of the same option SHOULD be ignored for symbol creation
- Diagnostics SHOULD warn about duplicate macro-creating options

### R2: Option Parsing Order
- Options MUST be processed in left-to-right order as they appear in the command
- The first valid macro name encountered MUST be registered as the created symbol
- Invalid macro names SHOULD be skipped without affecting valid ones

### R3: Cross-Command Consistency
- First definition semantics MUST apply consistently across all commands with macro-creating options
- Built-in commands (like `levelsof`) and user-defined commands MUST follow the same rules
- The behavior MUST match Stata's actual execution semantics

## Affected Commands

### Built-in Commands
- `levelsof varname, local(macname)`
- `glevelsof varname, local(macname)`
- Commands with `generate()`, `replace()` options that create macros

### User-Defined Commands
- Programs with `syntax` declarations containing macro-creating options
- Commands using `c_local` with option arguments

## Test Cases

### Test Case 1: Duplicate Local Options
```stata
levelsof var, local(first) local(second)
// Should create macro `first`, not `second`
display "`first'"  // Should be valid
display "`second'" // Should show undefined warning
```

### Test Case 2: Mixed Valid/Invalid Names
```stata
levelsof var, local(123invalid) local(valid_name)
// Should create macro `valid_name` (first valid name)
display "`valid_name'" // Should be valid
```

### Test Case 3: User Program Options
```stata
program myprog
    syntax varlist, local(name) local(other)
    c_local `name' "value"  // First option wins
end

myprog var1, local(result) local(ignored)
display "`result'"  // Should be valid
display "`ignored'" // Should show undefined warning
```

## Success Criteria

- First definition semantics are correctly implemented
- Duplicate option warnings are generated
- Symbol resolution matches Stata behavior
- Consistent behavior across command types