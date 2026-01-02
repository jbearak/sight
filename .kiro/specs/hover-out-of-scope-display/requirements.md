---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature enhances the hover provider to display out-of-scope symbols with a clear "(out of scope)" indicator instead of falling through to show unrelated symbols of different types. Currently, when hovering over a local macro reference that is out-of-scope (e.g., defined after the call site or excluded by inheritance rules), the hover provider returns no match for the local macro and falls through to display a variable with the same name from a different source file. This is confusing because the user is referencing a local macro, not a variable.

## Glossary

- **Hover_Provider**: The LSP component that provides hover information when the user hovers over a symbol in the editor
- **Out_of_Scope_Symbol**: A symbol that exists in the scope chain but is not accessible at the current position due to call-site filtering or inheritance rules
- **Reference_Type**: The syntactic type of a symbol reference (local macro uses backtick-quote syntax, global macro uses $ prefix)
- **Resolved_Scope**: The result of cross-file scope resolution containing both in-scope and out-of-scope symbols

## Requirements

### Requirement 1: Display Out-of-Scope Local Macros

**User Story:** As a developer, I want to see hover information for out-of-scope local macros with a clear indicator, so that I understand why the symbol is not accessible rather than seeing unrelated symbol information.

#### Acceptance Criteria

1. WHEN hovering over a local macro reference (backtick-quote syntax) that is out-of-scope, THE Hover_Provider SHALL display the local macro information with "(out of scope)" appended to the name
2. WHEN an out-of-scope local macro is displayed, THE Hover_Provider SHALL include the source file link and definition line
3. WHEN an out-of-scope local macro is displayed, THE Hover_Provider SHALL NOT fall through to display other symbol types (variables, programs, etc.) with the same name

### Requirement 2: Display Out-of-Scope Global Macros

**User Story:** As a developer, I want to see hover information for out-of-scope global macros with a clear indicator, so that I understand why the symbol is not accessible.

#### Acceptance Criteria

1. WHEN hovering over a global macro reference ($ prefix syntax) that is out-of-scope, THE Hover_Provider SHALL display the global macro information with "(out of scope)" appended to the name
2. WHEN an out-of-scope global macro is displayed, THE Hover_Provider SHALL include the source file link and definition line
3. WHEN an out-of-scope global macro is displayed, THE Hover_Provider SHALL NOT fall through to display other symbol types with the same name

### Requirement 3: Preserve In-Scope Symbol Display

**User Story:** As a developer, I want in-scope symbols to continue displaying normally without any "(out of scope)" indicator.

#### Acceptance Criteria

1. WHEN hovering over a symbol that is in-scope, THE Hover_Provider SHALL display the symbol information without any "(out of scope)" indicator
2. WHEN hovering over a symbol that has no out-of-scope match, THE Hover_Provider SHALL continue to fall through to other symbol types as before

### Requirement 4: Reference Type Matching

**User Story:** As a developer, I want the hover provider to respect the syntactic context of my reference, so that local macro syntax shows local macro info and global macro syntax shows global macro info.

#### Acceptance Criteria

1. WHEN the reference uses local macro syntax (backtick-quote), THE Hover_Provider SHALL only check for out-of-scope local macros
2. WHEN the reference uses global macro syntax ($ prefix), THE Hover_Provider SHALL only check for out-of-scope global macros
3. WHEN the reference uses bare identifier syntax, THE Hover_Provider SHALL NOT display out-of-scope macro information (continue existing behavior)
