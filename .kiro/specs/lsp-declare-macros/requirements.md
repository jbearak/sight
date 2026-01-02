---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - None
Status: Active
Related Specs:
  - None
---

# LSP Declare Macros

## Overview

This specification defines LSP directives for manually declaring local and global macros in Stata code, allowing developers to suppress undefined macro warnings and provide completion hints for macros that are defined outside the current analysis scope.

## Problem Statement

The LSP analyzer can only detect macros defined within the files it analyzes. Macros defined in:
- Data files loaded via `use` commands
- External programs or ado-files not in the workspace
- Interactive Stata sessions
- Dynamic macro creation patterns

These macros appear as "undefined" to the LSP, generating false positive warnings and missing from completion suggestions.

## Requirements

### R1: Local Macro Declaration
- `@lsp-local macroname` directive MUST declare a local macro
- Declared local macros MUST be available for completion
- References to declared local macros MUST NOT generate undefined warnings
- Multiple macros MAY be declared in a single directive: `@lsp-local macro1 macro2 macro3`

### R2: Global Macro Declaration  
- `@lsp-global macroname` directive MUST declare a global macro
- Declared global macros MUST be available for completion
- References to declared global macros MUST NOT generate undefined warnings
- Multiple macros MAY be declared in a single directive: `@lsp-global macro1 macro2 macro3`

### R3: Directive Placement and Scope
- Directives MUST be placed in comment lines
- Local macro declarations MUST only affect the current file
- Global macro declarations MUST be available across the workspace
- Directives MUST take effect from the point of declaration forward

### R4: Syntax Flexibility
- Directives SHOULD support both colon and non-colon syntax
- `@lsp-local: macroname` and `@lsp-local macroname` MUST both be valid
- Macro names SHOULD be validated for Stata naming rules
- Invalid macro names SHOULD generate warnings

## Directive Syntax

### Basic Syntax
```stata
* @lsp-local mylocal
* @lsp-global myglobal
```

### Colon Syntax
```stata
* @lsp-local: mylocal
* @lsp-global: myglobal
```

### Multiple Declarations
```stata
* @lsp-local var1 var2 var3
* @lsp-global config_path data_dir output_file
```

## Test Cases

### Test Case 1: Local Macro Declaration
```stata
* @lsp-local loaded_vars
use dataset.dta
display "`loaded_vars'"  // Should not show undefined warning
```

### Test Case 2: Global Macro Declaration
```stata
* @lsp-global project_root
global project_root "/path/to/project"
// In another file:
display "$project_root"  // Should not show undefined warning
```

### Test Case 3: Multiple Declarations
```stata
* @lsp-local temp1 temp2 temp3
* @lsp-global config debug_mode
forvalues i = 1/3 {
    display "`temp`i''"  // All should be valid
}
```

### Test Case 4: Invalid Names
```stata
* @lsp-local 123invalid _valid
// Should warn about 123invalid, accept _valid
```

## Success Criteria

- Declared macros appear in completion suggestions
- No undefined warnings for declared macros
- Syntax validation works correctly
- Scope rules are properly enforced