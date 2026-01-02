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

This document specifies the requirements for fixing 11 failing tests in the Stata LSP. The failures fall into several categories:

1. **Context Tracker Error Code Mismatch**: The context tracker returns `INVALID_DELIMITER_POSITION` (4007) instead of `MISMATCHED_END_PYTHON` (4005) for `end python` commands outside python context.

2. **Parser Content Extraction Bug**: The parser fails to correctly extract content between start and end delimiters when content contains special characters like `# !`.

3. **Extended Macro Definition Recognition**: The analyzer produces false positive undefined macro warnings for macros defined with extended functions like `: subinstr`.

4. **Symbol Provider Embedded Block Detection**: The symbol provider fails to include embedded language blocks (mata/python) as structural elements in document symbols.

5. **Parser AST Node Count**: The parser produces 2 AST nodes instead of 1 for `unab` commands.

## Glossary

- **Context_Tracker**: Component that tracks language context (Stata/Mata/Python) during parsing
- **Parser**: Component that builds AST from tokens
- **Analyzer**: Component that performs semantic analysis and builds symbol tables
- **Symbol_Provider**: Component that provides document symbols for LSP
- **Extended_Macro_Function**: Macro definition using colon syntax like `local x : list a - b`
- **Embedded_Block**: A mata or python code block within Stata code
- **MISMATCHED_END_PYTHON**: Error code 4005 for `end python` outside python context
- **INVALID_DELIMITER_POSITION**: Error code 4007 for invalid delimiter syntax

## Requirements

### Requirement 1: Context Tracker Error Code for End Python

**User Story:** As a developer, I want the context tracker to emit the correct error code for `end python` commands outside python context, so that tests pass and error handling is consistent.

#### Acceptance Criteria

1. WHEN an `end python` command appears outside any embedded language context (Stata context), THE Context_Tracker SHALL emit a diagnostic with code `MISMATCHED_END_PYTHON` (4005)
2. WHEN an `end python` command appears inside a mata block, THE Context_Tracker SHALL emit a diagnostic with code `MISMATCHED_END_PYTHON` (4005)
3. THE Context_Tracker SHALL emit `INVALID_DELIMITER_POSITION` (4007) only for malformed syntax like `end mata` inside mata blocks
4. THE Context_Tracker SHALL NOT emit `INVALID_DELIMITER_POSITION` for `end python` commands regardless of context

### Requirement 2: Parser Content Extraction

**User Story:** As a developer, I want the parser to correctly extract content between embedded block delimiters regardless of content characters, so that all valid embedded content is preserved.

#### Acceptance Criteria

1. WHEN parsing an embedded block with content containing special characters (e.g., `# !`), THE Parser SHALL extract all content words correctly
2. FOR ALL valid embedded blocks, THE Parser SHALL produce exactly one AST node of type `embedded_block`
3. THE Parser SHALL preserve the word count of content between start and end delimiters
4. THE Parser SHALL apply raw content extraction only within embedded blocks (mata/python)
5. THE Parser SHALL preserve existing comment handling semantics for Stata code outside embedded blocks

### Requirement 3: Extended Macro Definition Recognition

**User Story:** As a developer, I want the analyzer to recognize all extended macro definitions and not produce false positive undefined macro warnings, so that valid code does not show spurious errors.

#### Acceptance Criteria

1. WHEN a macro is defined using a recognized extended function syntax (e.g., `local x : subinstr ...`), THE Analyzer SHALL register the macro in the symbol table
2. WHEN a macro defined with extended function syntax is referenced, THE Analyzer SHALL NOT emit an undefined macro warning
3. WHEN multiple macros are defined with extended function syntax, THE Analyzer SHALL register all of them without conflicts
4. THE Analyzer SHALL recognize only the following extended function types: `list`, `word`, `subinstr`, `length`, `substr`, `upper`, `lower`, `type`, `format`, `label`, `variable`, `value`, `data`, `display`, `permname`, `tempvar`, `tempfile`
5. WHEN a macro is defined using an unrecognized colon form (e.g., `local x : unknownfunc ...`), THE Analyzer SHALL still register the macro but MAY emit a warning for unrecognized function
6. THE Analyzer SHALL NOT suppress undefined macro warnings for macros that are genuinely undefined

### Requirement 4: Symbol Provider Embedded Block Detection

**User Story:** As a developer, I want the symbol provider to include embedded language blocks as structural elements, so that document outline shows mata and python blocks.

#### Acceptance Criteria

1. WHEN a document contains mata blocks, THE Symbol_Provider SHALL include them as symbols with kind `Module`
2. WHEN a document contains python blocks, THE Symbol_Provider SHALL include them as symbols with kind `Module`
3. FOR ALL embedded blocks in a document, THE Symbol_Provider SHALL include a corresponding symbol with label "Mata Block" or "Python Block"

### Requirement 5: Parser Unab Command AST

**User Story:** As a developer, I want the parser to produce exactly one AST node for `unab` commands, so that the AST structure is correct and consistent.

#### Acceptance Criteria

1. WHEN parsing an `unab` command (e.g., `unab my_vars: var1 var2 var3`), THE Parser SHALL produce exactly one AST node
2. THE Parser SHALL produce an AST node of type `command` for `unab` commands
3. THE Parser SHALL NOT produce additional spurious nodes for `unab` commands
