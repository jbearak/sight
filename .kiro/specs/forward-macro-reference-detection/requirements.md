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

This feature enhances the Stata LSP's undefined macro detection to consider execution order. Currently, the analyzer builds a complete symbol table before checking for undefined references, which means a macro defined later in the file is incorrectly considered "defined" when referenced earlier. In Stata, code executes sequentially, so using a macro before it's defined should be flagged as an error.

Example of the bug:
```stata
di "`fruit'"        // Should warn: `fruit' is not yet defined
local fruit apple   // Definition comes after usage
```

## Glossary

- **Semantic_Analyzer**: The component that builds symbol tables and detects semantic issues like undefined macro references
- **Forward_Reference**: A reference to a macro that appears before the macro's definition in the source code
- **Symbol_Table**: A data structure mapping macro names to their definitions and locations
- **Document_Order**: The sequential position of AST nodes as they appear in the parsed document, reflecting execution order regardless of delimiter mode. Uses preorder traversal index for precise ordering of nested nodes.
- **Definition_Node**: The AST node where a macro is defined (macro_def, foreach, forvalues, tempvar, tempfile, tempname, syntax, etc.)
- **Reference_Node**: The AST node containing a macro reference
- **preorder_index**: A monotonically increasing counter assigned to each node during preorder AST traversal, ensuring nested nodes have distinct indices (uses snake_case to match codebase style)

## Requirements

### Requirement 1: Detect Forward Macro References

**User Story:** As a Stata developer, I want the LSP to warn me when I reference a local macro before it's defined, so that I can catch execution-order bugs before running my code.

#### Acceptance Criteria

1. WHEN a local macro reference appears in an AST node that precedes the macro's definition node in preorder traversal, THE Semantic_Analyzer SHALL report an undefined macro warning for that reference
2. WHEN a local macro reference appears in an AST node that follows the macro's definition node in preorder traversal, THE Semantic_Analyzer SHALL NOT report an undefined macro warning
3. WHEN multiple definitions of the same local macro exist, THE Semantic_Analyzer SHALL use the first definition's preorder index for forward reference detection (later redefinitions do not advance the availability boundary)
4. WHEN a macro reference and definition appear on the same line with `#delimit ;`, THE Semantic_Analyzer SHALL use preorder index to determine ordering (reference before definition in AST order = forward reference)

Note: "Preorder traversal" assigns a monotonically increasing index to each node as it's visited, ensuring nested nodes within programs, loops, and control flow have distinct indices that reflect execution order.

### Requirement 2: Handle Global Macros Correctly

**User Story:** As a Stata developer, I want global macro forward reference detection to work correctly, so that I get accurate warnings for global macros too.

#### Acceptance Criteria

1. WHEN a global macro reference appears in an AST node that precedes the macro's definition node in the same file (by preorder index), THE Semantic_Analyzer SHALL report an undefined macro warning for that reference
2. WHEN a global macro is defined in the workspace symbols (from another file), THE Semantic_Analyzer SHALL NOT report an undefined macro warning regardless of preorder index

### Requirement 3: Preserve Existing Behavior for Defined Macros

**User Story:** As a Stata developer, I want macros that are properly defined before use to continue working without false positives.

#### Acceptance Criteria

1. WHEN a local macro is defined and then referenced in a later AST node (by preorder index), THE Semantic_Analyzer SHALL NOT report an undefined macro warning
2. WHEN a macro is defined via loop variable (foreach/forvalues), THE Semantic_Analyzer SHALL assign the loop header's preorder index as the definition point; references within the loop body (which have higher preorder indices) SHALL NOT warn
3. WHEN a macro is defined via tempvar, tempfile, or tempname command, THE Semantic_Analyzer SHALL assign the command's preorder index as the definition point; references before the command SHALL warn
4. WHEN a macro is defined via syntax command in a program, THE Semantic_Analyzer SHALL assign the syntax node's preorder index as the definition point
5. WHEN a forward reference inside a program block appears before an inner local definition within the same program, THE Semantic_Analyzer SHALL correctly detect it as a forward reference (nested nodes have distinct preorder indices)

### Requirement 4: Handle Special Cases

**User Story:** As a Stata developer, I want the forward reference detection to handle edge cases correctly.

#### Acceptance Criteria

1. WHEN positional arguments (`0', `1', `2', etc.) are referenced, THE Semantic_Analyzer SHALL NOT report undefined macro warnings regardless of preorder index
2. WHEN the @lsp-ignore-next directive precedes a forward reference, THE Semantic_Analyzer SHALL NOT report an undefined macro warning for that reference (directive is applied before position checks)
3. WHEN a macro reference is inside an embedded language block (Mata/Python), THE Semantic_Analyzer SHALL NOT report Stata macro warnings
4. WHEN the Semantic_Analyzer is invoked multiple times (reused instance), THE Semantic_Analyzer SHALL reset the preorder index counter at the start of each analyze() call to prevent stale state
