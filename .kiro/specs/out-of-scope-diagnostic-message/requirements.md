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

This specification addresses a bug in the diagnostic message generation for out-of-scope symbols in cross-file scope resolution. When a local macro is inaccessible due to inheritance rules (done-by/run-by boundaries don't inherit locals), the diagnostic message incorrectly states the symbol is "defined after the call site" instead of explaining that "local macros are not inherited via do/run".

## Glossary

- **Out_Of_Scope_Symbol**: A symbol that exists in a parent file but is not accessible in the current file's scope
- **Inheritance_Excludes_Locals**: The reason code indicating a local macro is out of scope because done-by/run-by directives don't inherit local macros
- **After_Call_Site**: The reason code indicating a symbol is out of scope because it's defined after the call site line in the parent file
- **Done_By_Directive**: The `@lsp-done-by` directive that establishes a parent-child relationship where locals are NOT inherited
- **Included_By_Directive**: The `@lsp-included-by` directive that establishes a parent-child relationship where locals ARE inherited
- **Scope_Chain**: The ordered list of files contributing symbols to the current file's scope
- **Call_Site_Line**: The line number in a parent file where the child file is executed

## Requirements

### Requirement 1: Correct Diagnostic Message for Inheritance-Excluded Locals

**User Story:** As a developer, I want to see an accurate diagnostic message when a local macro is inaccessible due to inheritance rules, so that I understand why the symbol is unavailable and how to fix it.

#### Acceptance Criteria

1. WHEN a local macro is referenced in a file using `@lsp-done-by` AND the local is defined in an ancestor file, THEN THE Diagnostics_Provider SHALL display the message "'name' is defined in file but local macros are not inherited via do/run (use include or @lsp-included-by)"
2. WHEN multiple out-of-scope entries exist for the same symbol with different reasons, THEN THE Scope_Resolver SHALL prioritize `inheritance_excludes_locals` over `after_call_site`
3. WHEN a local macro is stripped from ancestor chain entries due to a done-by boundary, THEN THE Scope_Resolver SHALL ensure the out-of-scope entry has reason `inheritance_excludes_locals`

### Requirement 2: Out-of-Scope Symbol Deduplication

**User Story:** As a developer, I want consistent diagnostic messages regardless of the internal order of scope resolution, so that I can trust the diagnostic information.

#### Acceptance Criteria

1. WHEN the same symbol appears multiple times in out_of_scope_symbols with different reasons, THEN THE Scope_Resolver SHALL deduplicate entries preferring `inheritance_excludes_locals` over `after_call_site`
2. WHEN stripping locals from ancestor chain entries after recursion, THEN THE Scope_Resolver SHALL remove any existing `after_call_site` entries for those locals before adding `inheritance_excludes_locals` entries

### Requirement 3: Accurate Call Site Line in Diagnostics

**User Story:** As a developer, I want the call site line number in diagnostics to be accurate and meaningful, so that I can locate the relevant code.

#### Acceptance Criteria

1. WHEN an out-of-scope diagnostic is displayed with reason `after_call_site`, THEN THE Diagnostics_Provider SHALL show the correct 1-indexed line number where the call occurs
2. WHEN an out-of-scope diagnostic is displayed with reason `inheritance_excludes_locals`, THEN THE Diagnostics_Provider SHALL NOT display a call site line number (since it's not relevant)

### Requirement 4: Hover Provider Suppresses Unrelated Symbol Info for Out-of-Scope References

**User Story:** As a developer, I want the hover popup to only show relevant information for the symbol type I'm referencing, so that I'm not confused by unrelated symbols with the same name but different types.

#### Acceptance Criteria

1. WHEN hovering over a local macro reference (`` `name' ``) that is out-of-scope, THEN THE Hover_Provider SHALL NOT display information about variables, globals, or other symbol types with the same name
2. WHEN hovering over a global macro reference (`$name` or `${name}`) that is out-of-scope, THEN THE Hover_Provider SHALL NOT display information about variables, locals, or other symbol types with the same name
3. WHEN hovering over a valid symbol reference (not out-of-scope), THEN THE Hover_Provider SHALL display all matching symbol information as before
4. THE Hover_Provider SHALL determine the reference type from the syntax context (backtick-quote for local, dollar sign for global, bare identifier for variable/program)
