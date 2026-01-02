---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - None
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Done-by Locals Bug Fix

## Overview

This specification addresses a bug in the handling of local macros when using `@lsp-done-by` directives for cross-file scope resolution.

## Problem Statement

When a file uses `@lsp-done-by` to inherit scope from a parent file, local macros from the parent are incorrectly being made available in the child file. According to Stata semantics, local macros should not be inherited through `do` commands - only global macros, programs, scalars, matrices, and variables should be inherited.

## Requirements

### R1: Local Macro Inheritance Restriction
- Local macros defined in parent files MUST NOT be inherited through `@lsp-done-by` directives
- Only the following symbol types should be inherited:
  - Global macros
  - Programs
  - Scalars
  - Matrices
  - Variables

### R2: Include vs Do Distinction
- `@lsp-included-by` directives SHOULD inherit local macros (as `include` preserves local scope)
- `@lsp-done-by` directives MUST NOT inherit local macros (as `do` creates new local scope)

### R3: Diagnostic Accuracy
- Undefined local macro warnings should be accurate after fixing inheritance
- No false positives should occur for properly scoped local macros

## Test Cases

### Test Case 1: Done-by Local Exclusion
```stata
// caller.do
local caller_local "should not be visible"
global caller_global "should be visible"
do callee.do

// callee.do
// @lsp-done-by: "caller.do"
display "`caller_local'"  // Should show undefined warning
display "$caller_global"  // Should be valid
```

### Test Case 2: Include-by Local Inclusion
```stata
// parent.do
local parent_local "should be visible"
include child.do

// child.do
// @lsp-included-by: "parent.do"
display "`parent_local'"  // Should be valid
```

## Success Criteria

- Local macros are not inherited through `@lsp-done-by` directives
- Global symbols are still properly inherited
- Diagnostic accuracy is maintained
- Include vs do semantics are correctly distinguished