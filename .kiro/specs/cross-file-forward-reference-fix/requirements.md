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

This specification addresses a bug in the LSP's forward reference detection when cross-file awareness directives (`@lsp-included-by` or `@lsp-done-by`) are present. Currently, the diagnostics provider incorrectly suppresses forward reference warnings for macros defined later in the same file when cross-file scope resolution is active.

## Glossary

- **Forward_Reference**: A reference to a macro that appears before the macro's definition in execution order
- **Cross_File_Directive**: A comment directive (`@lsp-included-by` or `@lsp-done-by`) that establishes a relationship between files for symbol resolution
- **Diagnostics_Provider**: The LSP component responsible for filtering and publishing diagnostic messages
- **Scope_Resolver**: The component that resolves symbols across files following directive chains
- **Local_Macro**: A macro defined with `local` command, scoped to the containing do-file or program
- **Source_URI**: The URI of the file where a symbol is originally defined

## Requirements

### Requirement 1: Preserve Forward Reference Warnings for Same-File Symbols

**User Story:** As a developer, I want to see warnings when I reference a local macro before it's defined in the same file, so that I can identify potential runtime errors.

#### Acceptance Criteria

1. WHEN a local macro is referenced before its definition in the same file AND cross-file directives are present, THEN THE Diagnostics_Provider SHALL emit an undefined macro warning
2. WHEN a local macro is referenced after its definition in the same file, THEN THE Diagnostics_Provider SHALL NOT emit an undefined macro warning
3. WHEN checking if a symbol suppresses an undefined macro diagnostic, THE Diagnostics_Provider SHALL compare the symbol's Source_URI against the current document URI

### Requirement 2: Suppress Warnings for Cross-File Symbols

**User Story:** As a developer, I want warnings to be suppressed for macros that are defined in parent files via cross-file directives, so that I don't see false positives.

#### Acceptance Criteria

1. WHEN a local macro is defined in a parent file via `@lsp-included-by` directive, THEN THE Diagnostics_Provider SHALL NOT emit an undefined macro warning for references to that macro
2. WHEN a global macro is defined in a parent file via `@lsp-done-by` or `@lsp-included-by` directive, THEN THE Diagnostics_Provider SHALL NOT emit an undefined macro warning for references to that macro
3. WHEN a symbol's Source_URI differs from the current document URI, THE Diagnostics_Provider SHALL suppress the undefined symbol diagnostic

### Requirement 3: Detect Undefined Macros in String Literals

**User Story:** As a developer, I want the LSP to detect undefined macros within string literals, so that I can catch errors where macros are referenced inside quoted strings.

#### Acceptance Criteria

1. WHEN a macro reference appears within a string literal (e.g., `di "`apple'"`), THEN THE LSP SHALL detect and warn about undefined macros
2. WHEN a macro reference appears outside quotes (e.g., `di `apple'`), THEN THE LSP SHALL continue to detect and warn about undefined macros as before
3. THE LSP SHALL parse macro references within string content and apply the same undefined symbol detection logic

**Example:**
```stata
// berry.do
di "`apple'"  // Should warn: undefined macro 'apple'
```

### Requirement 4: Maintain Existing Cross-File Behavior

**User Story:** As a developer, I want the existing cross-file awareness features to continue working correctly, so that my workflow is not disrupted.

#### Acceptance Criteria

1. WHEN a symbol is defined after the call site in a parent file, THEN THE Diagnostics_Provider SHALL emit an out-of-scope diagnostic (if configured)
2. WHEN multiple files define the same symbol, THE Scope_Resolver SHALL apply the existing shadowing rules (nearer symbols shadow more distant ones)
3. WHEN a directive chain contains cycles, THE Scope_Resolver SHALL detect and report the cycle
