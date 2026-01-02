---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - forward-scope-resolution: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This specification addresses the handling of optional `.do` file extensions in Stata LSP. In Stata, the `.do` extension is optional when referencing do-files. For example, `do foo` and `do foo.do` are equivalent—Stata will execute `foo.do` if it exists.

Currently, the LSP emits false-positive "file not found" warnings when users write `do foo` and `foo.do` exists. The LSP should follow Stata's convention and correctly resolve paths without the `.do` extension.

### Scope

This specification covers:
1. `do`, `run`, `include` commands in Stata code
2. `@lsp-do`, `@lsp-run`, `@lsp-include` forward call directives
3. `@lsp-done-by`, `@lsp-included-by` backward directives
4. Diagnostics for missing files
5. Forward scope resolution
6. Backward scope resolution
7. Go-to-definition for file paths

## Glossary

- **Forward_Scope_Resolver**: Component that follows do/run/include commands to build forward scope
- **Scope_Resolver**: Component that follows @lsp-done-by/@lsp-included-by directives to build backward scope
- **Directive_Parser**: Component that parses @lsp-* directives from file headers and comments
- **Analyzer**: Component that performs semantic analysis and extracts forward calls from commands
- **Raw_Path**: The path as written by the user (e.g., `foo` or `foo.do`)
- **Resolved_Path**: The absolute filesystem path after resolution and fallback (e.g., `/path/to/foo.do`)

## Requirements

### Requirement 1: Path Resolution with .do Fallback

**User Story:** As a developer, I want the LSP to follow Stata's convention that `.do` extensions are optional, so that my code works whether or not I include the extension.

#### Acceptance Criteria

1. WHEN a `do`, `run`, or `include` command references a file without the `.do` extension AND the exact path does not exist BUT `path.do` exists, THE Analyzer SHALL resolve to `path.do`
2. WHEN a `do`, `run`, or `include` command references a file with the `.do` extension explicitly, THE Analyzer SHALL resolve to that path without modification
3. WHEN both `path` and `path.do` exist, THE Analyzer SHALL prefer the exact path specified
4. WHEN neither `path` nor `path.do` exists, THE Analyzer SHALL use the original path and allow diagnostics to be emitted

### Requirement 2: Directive Path Resolution with .do Fallback

**User Story:** As a developer, I want directives to follow the same `.do` extension convention as commands, so that my directives work consistently.

#### Acceptance Criteria

1. WHEN an `@lsp-do`, `@lsp-run`, or `@lsp-include` directive references a file without the `.do` extension AND the exact path does not exist BUT `path.do` exists, THE Directive_Parser SHALL resolve to `path.do`
2. WHEN an `@lsp-done-by` or `@lsp-included-by` directive references a file without the `.do` extension AND the exact path does not exist BUT `path.do` exists, THE Directive_Parser SHALL resolve to `path.do`
3. WHEN a directive references a file with the `.do` extension explicitly, THE Directive_Parser SHALL resolve to that path without modification
4. WHEN both `path` and `path.do` exist, THE Directive_Parser SHALL prefer the exact path specified

### Requirement 3: Accurate Diagnostics for Missing Files

**User Story:** As a developer, I want accurate diagnostics when files are truly missing, so that I can fix real problems without being confused by false positives.

#### Acceptance Criteria

1. WHEN a command or directive references `foo` AND neither `foo` nor `foo.do` exists, THE LSP SHALL emit a diagnostic indicating the file was not found
2. WHEN a command or directive references `foo` AND `foo.do` exists, THE LSP SHALL NOT emit a "file not found" diagnostic
3. WHEN a command or directive references `foo.do` AND `foo.do` does not exist, THE LSP SHALL emit a diagnostic indicating the file was not found
4. THE diagnostic message SHALL indicate which paths were tried (e.g., "Cannot read file: foo (also tried foo.do)")

### Requirement 4: Forward Scope Resolution with .do Fallback

**User Story:** As a developer, I want forward scope resolution to work correctly when I omit the `.do` extension, so that symbols from called files are visible.

#### Acceptance Criteria

1. WHEN a `do foo` command is encountered AND `foo.do` exists, THE Forward_Scope_Resolver SHALL resolve symbols from `foo.do`
2. WHEN an `@lsp-do: "foo"` directive is encountered AND `foo.do` exists, THE Forward_Scope_Resolver SHALL resolve symbols from `foo.do`
3. THE Forward_Scope_Resolver SHALL use the resolved path (with `.do` fallback applied) for all file operations

### Requirement 5: Backward Scope Resolution with .do Fallback

**User Story:** As a developer, I want backward scope resolution to work correctly when I omit the `.do` extension in directives, so that inherited symbols are visible.

#### Acceptance Criteria

1. WHEN an `@lsp-done-by: "parent"` directive is encountered AND `parent.do` exists, THE Scope_Resolver SHALL resolve symbols from `parent.do`
2. WHEN an `@lsp-included-by: "parent"` directive is encountered AND `parent.do` exists, THE Scope_Resolver SHALL resolve symbols from `parent.do`
3. THE Scope_Resolver SHALL use the resolved path (with `.do` fallback applied) for all file operations

### Requirement 6: Go-to-Definition for File Paths

**User Story:** As a developer, I want go-to-definition to work on file paths even when I omit the `.do` extension, so that I can navigate to called files.

#### Acceptance Criteria

1. WHEN the user invokes go-to-definition on a file path in a `do`, `run`, or `include` command AND the path omits `.do` AND `path.do` exists, THE Definition_Provider SHALL navigate to `path.do`
2. WHEN the user invokes go-to-definition on a file path in an `@lsp-do`, `@lsp-run`, `@lsp-include`, `@lsp-done-by`, or `@lsp-included-by` directive AND the path omits `.do` AND `path.do` exists, THE Definition_Provider SHALL navigate to `path.do`

### Requirement 7: Consistency Across All Path Contexts

**User Story:** As a developer, I want consistent behavior across all contexts where file paths are used, so that I don't have to remember different rules.

#### Acceptance Criteria

1. THE `.do` extension fallback behavior SHALL be consistent across:
   - `do`, `run`, `include` commands
   - `@lsp-do`, `@lsp-run`, `@lsp-include` directives
   - `@lsp-done-by`, `@lsp-included-by` directives
2. THE resolution order SHALL be: exact path first, then `path.do` if exact path doesn't exist
3. THE behavior SHALL NOT change based on whether the path is quoted or unquoted

---

## Appendix A: Example Scenarios

### A.1 Command Without Extension

```stata
* File: main.do
do analysis    // Should resolve to analysis.do if it exists
run cleanup    // Should resolve to cleanup.do if it exists
include utils  // Should resolve to utils.do if it exists
```

### A.2 Directive Without Extension

```stata
* File: child.do
* @lsp-done-by: "parent"     // Should resolve to parent.do if it exists
* @lsp-included-by: "utils"  // Should resolve to utils.do if it exists
* @lsp-do: "helper"          // Should resolve to helper.do if it exists
```

### A.3 Mixed Extensions

```stata
* File: main.do
do analysis.do  // Explicit extension - use as-is
do cleanup      // No extension - try cleanup, then cleanup.do
```

### A.4 Diagnostic Messages

When `missing` and `missing.do` both don't exist:
```
Warning: Cannot read file: missing (also tried missing.do)
```

When `existing.do` exists but user wrote `do existing`:
```
(No diagnostic - file found via .do fallback)
```
