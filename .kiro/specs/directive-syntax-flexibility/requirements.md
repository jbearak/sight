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

This specification extends the cross-file awareness directive syntax to support flexible syntax variations for improved usability. Currently, the LSP recognizes `@lsp-done-by` and `@lsp-included-by` directives with a fixed syntax. This enhancement adds support for flexible syntax variations including optional colons and optional quotes around paths.

### Motivation

Users have requested more flexible directive syntax to reduce verbosity and align with common annotation patterns. Users want flexibility in whether to use colons after the directive name and whether to quote file paths.

### Stata File Extension Convention

Stata conventionally treats the `.do` extension as optional when referencing do-files. For example, `do myfile` and `do myfile.do` are equivalent. The LSP should follow this convention when resolving directive paths.

## Glossary

- **Directive**: A comment-based annotation declaring file dependencies
- **LSP**: Language Server Protocol
- **Path**: A file system path to a referenced file
- **Directive_Parser**: The component that extracts directives from file headers

## Requirements

### Requirement 1: Optional Colon After Directive Name

**User Story:** As a developer, I want flexibility in whether to include a colon after the directive name, so that I can use my preferred annotation style.

#### Acceptance Criteria

1. WHEN a directive is written as `@lsp-done-by path/to/file`, THE Directive_Parser SHALL recognize it as valid
2. WHEN a directive is written as `@lsp-done-by: path/to/file`, THE Directive_Parser SHALL recognize it as valid
3. WHEN a directive is written as `@lsp-included-by path/to/file`, THE Directive_Parser SHALL recognize it as valid
4. WHEN a directive is written as `@lsp-included-by: path/to/file`, THE Directive_Parser SHALL recognize it as valid
5. THE Directive_Parser SHALL treat directives with and without colons as semantically equivalent

### Requirement 2: Optional Quotes Around Paths

**User Story:** As a developer, I want flexibility in whether to quote file paths, so that I can use my preferred style for simple paths.

#### Acceptance Criteria

1. WHEN a directive path is written without quotes as `@lsp-done-by path/to/file`, THE Directive_Parser SHALL extract `path/to/file` as the path
2. WHEN a directive path is written with quotes as `@lsp-done-by "path/to/file"`, THE Directive_Parser SHALL extract `path/to/file` as the path
3. WHEN a directive path is written without quotes as `@lsp-included-by path/to/file`, THE Directive_Parser SHALL extract `path/to/file` as the path
4. WHEN a directive path is written with quotes as `@lsp-included-by "path/to/file"`, THE Directive_Parser SHALL extract `path/to/file` as the path
5. THE Directive_Parser SHALL treat quoted and unquoted paths as semantically equivalent when the path contains no spaces

### Requirement 3: Equivalent Directive Forms

**User Story:** As a developer, I want all syntax variations to produce identical results, so that I can choose my preferred style without affecting behavior.

#### Acceptance Criteria

1. THE following four forms SHALL be equivalent for `@lsp-done-by`:
   - `@lsp-done-by path/to/file`
   - `@lsp-done-by: path/to/file`
   - `@lsp-done-by "path/to/file"`
   - `@lsp-done-by: "path/to/file"`
2. THE following four forms SHALL be equivalent for `@lsp-included-by`:
   - `@lsp-included-by path/to/file`
   - `@lsp-included-by: path/to/file`
   - `@lsp-included-by "path/to/file"`
   - `@lsp-included-by: "path/to/file"`

### Requirement 4: Stata .do Extension Convention

**User Story:** As a developer, I want the LSP to follow Stata's convention that `.do` extensions are optional, so that my directives work whether or not I include the extension.

#### Acceptance Criteria

1. WHEN a directive references a file without the `.do` extension and the file is not found, THE Directive_Parser SHALL check for the file with `.do` appended
2. WHEN a directive references `path/to/file` and `path/to/file` does not exist but `path/to/file.do` exists, THE Directive_Parser SHALL resolve to `path/to/file.do`
3. WHEN a directive references `path/to/file.do` explicitly, THE Directive_Parser SHALL resolve to `path/to/file.do` without modification
4. WHEN both `path/to/file` and `path/to/file.do` exist, THE Directive_Parser SHALL prefer the exact path specified

### Requirement 5: Backward Compatibility

**User Story:** As a developer with existing directive comments, I want my existing directives to continue working, so that I don't need to update my codebase.

#### Acceptance Criteria

1. THE Directive_Parser SHALL continue to recognize all previously valid directive syntax
2. THE Directive_Parser SHALL not change the behavior of existing valid directives
3. WHEN processing a file with mixed old and new syntax styles, THE Directive_Parser SHALL process all directives correctly

### Requirement 6: Comment Style Support

**User Story:** As a developer, I want to use directives in both `*` and `//` comment styles, so that I can use my preferred Stata comment syntax.

#### Acceptance Criteria

1. WHEN a directive appears in a `*` style comment, THE Directive_Parser SHALL recognize it
2. WHEN a directive appears in a `//` style comment, THE Directive_Parser SHALL recognize it
3. THE Directive_Parser SHALL treat directives in both comment styles equivalently

---

## Appendix A: Complete Syntax Forms

The following table shows all valid directive syntax combinations:

| Directive Type | Colon | Quotes | Example |
|---------------|-------|--------|---------|
| @lsp-done-by | No | No | `* @lsp-done-by path/to/file` |
| @lsp-done-by | Yes | No | `* @lsp-done-by: path/to/file` |
| @lsp-done-by | No | Yes | `* @lsp-done-by "path/to/file"` |
| @lsp-done-by | Yes | Yes | `* @lsp-done-by: "path/to/file"` |
| @lsp-included-by | No | No | `* @lsp-included-by path/to/file` |
| @lsp-included-by | Yes | No | `* @lsp-included-by: path/to/file` |
| @lsp-included-by | No | Yes | `* @lsp-included-by "path/to/file"` |
| @lsp-included-by | Yes | Yes | `* @lsp-included-by: "path/to/file"` |

All forms above are also valid with `//` comment style instead of `*`.

## Appendix B: Example Usage

### B.1 Without Colon or Quotes

```stata
* @lsp-done-by orchestrator.do
* @lsp-included-by utils.do

* Main analysis code
use data.dta, clear
```

### B.2 With Colon

```stata
* @lsp-done-by: orchestrator.do
* @lsp-included-by: utils.do

* Main analysis code
use data.dta, clear
```

### B.3 With Quotes

```stata
* @lsp-done-by "path/to/orchestrator.do"
* @lsp-included-by "path/to/utils.do"

* Main analysis code
use data.dta, clear
```

### B.4 Mixed Styles (All Equivalent)

```stata
* @lsp-done-by orchestrator
* @lsp-done-by: orchestrator.do
// @lsp-done-by "orchestrator.do"
// @lsp-done-by: "orchestrator"

* All four directives above reference the same file
```

### B.5 Without .do Extension

```stata
* @lsp-done-by orchestrator
* @lsp-included-by utils

* The LSP will look for orchestrator.do and utils.do if the exact paths don't exist
```
