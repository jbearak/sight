# Requirements Document

## Introduction

This feature implements incremental parsing for the Stata LSP, enabling the lexer and parser to re-process only changed ranges of a document rather than re-parsing the entire file on every edit. This significantly reduces latency for large files and improves editor responsiveness.

## Glossary

- **Incremental_Parser**: The component that identifies changed regions and reuses existing AST nodes for unchanged portions
- **Edit_Range**: A contiguous region of text that was modified, inserted, or deleted
- **AST_Node**: A node in the Abstract Syntax Tree produced by the parser
- **Reusable_Node**: An AST node from a previous parse that can be retained because its source text is unchanged
- **Invalidation_Zone**: The region of the AST that must be re-parsed due to an edit

## Requirements

### Requirement 1: Detect Changed Ranges

**User Story:** As a developer editing Stata code, I want the LSP to identify only the portions of my document that changed, so that unchanged code doesn't need to be re-processed.

#### Acceptance Criteria

1. WHEN a document edit is received, THE Incremental_Parser SHALL compute the minimal Edit_Range affected by the change
2. WHEN multiple edits occur in a single update, THE Incremental_Parser SHALL merge overlapping Edit_Ranges into consolidated regions
3. WHEN an edit is purely additive (insertion), THE Incremental_Parser SHALL identify the insertion point and affected line boundaries

### Requirement 2: Reuse Unchanged AST Nodes

**User Story:** As a developer working with large Stata files, I want the parser to reuse AST nodes for unchanged code, so that editing is fast even in large files.

#### Acceptance Criteria

1. WHEN an edit does not affect an AST_Node's source range, THE Incremental_Parser SHALL retain that node without re-parsing
2. WHEN an edit occurs within a block (program, foreach, etc.), THE Incremental_Parser SHALL re-parse only that block and its descendants
3. WHEN line offsets change due to insertions/deletions, THE Incremental_Parser SHALL adjust position information in Reusable_Nodes

### Requirement 3: Handle Invalidation Correctly

**User Story:** As a developer, I want the incremental parser to correctly identify when changes require re-parsing larger regions, so that the AST remains accurate.

#### Acceptance Criteria

1. WHEN an edit changes delimiter mode (#delimit), THE Incremental_Parser SHALL invalidate and re-parse from that point to end of file
2. WHEN an edit changes block structure (adding/removing `{` or `}`), THE Incremental_Parser SHALL expand the Invalidation_Zone to include the entire affected block
3. WHEN an edit affects a macro definition, THE Incremental_Parser SHALL mark dependent nodes for re-analysis
4. IF an incremental parse produces an inconsistent AST, THEN THE Incremental_Parser SHALL fall back to a full re-parse

### Requirement 4: Maintain Parse Correctness

**User Story:** As a developer, I want incremental parsing to produce identical results to full parsing, so that I can trust the LSP's analysis.

#### Acceptance Criteria

1. FOR ALL valid Stata documents and edit sequences, incrementally parsing SHALL produce an AST equivalent to full parsing
2. WHEN trivia (comments, whitespace) is edited, THE Incremental_Parser SHALL update trivia attachment without re-parsing code nodes
3. THE Incremental_Parser SHALL preserve all diagnostic information for unchanged regions

### Requirement 5: Performance Improvement

**User Story:** As a developer editing large files, I want incremental parsing to be significantly faster than full parsing, so that the editor remains responsive.

#### Acceptance Criteria

1. WHEN editing a single line in a 1000+ line file, THE Incremental_Parser SHALL complete in under 50ms on typical hardware
2. WHEN the edit affects less than 10% of the document, THE Incremental_Parser SHALL reuse at least 80% of existing AST nodes
3. THE Incremental_Parser SHALL not increase memory usage by more than 20% compared to non-incremental parsing
