# Requirements Document

## Introduction

This feature optimizes performance by replacing inefficient `content.split('\n')` patterns with O(1) lookups using pre-computed `line_offsets`. The LSP providers frequently need to access specific lines or characters at positions, and splitting the entire document content into an array on every request is wasteful when `DocumentState` already maintains a `line_offsets` array for this purpose.

## Glossary

- **Line_Offsets**: A pre-computed array where `line_offsets[n]` contains the character offset where line `n` begins in the document content
- **DocumentState**: The cached state for an open document, including content, tokens, AST, symbols, and line_offsets
- **Provider**: An LSP feature implementation (completion, hover, definition, diagnostics, formatter)
- **Hot_Path**: Code executed frequently during normal editor usage (e.g., on every keystroke or cursor movement)
- **Cold_Path**: Code executed infrequently (e.g., on explicit user action like format document)

## Requirements

### Requirement 1: Optimize Single Character Lookups

**User Story:** As a developer, I want the LSP to respond quickly to completion and hover requests, so that my editing experience feels responsive.

#### Acceptance Criteria

1. WHEN a Provider needs to access a single character at a position AND DocumentState is available, THE Provider SHALL use line_offsets for O(1) lookup instead of splitting content
2. WHEN line_offsets is unavailable (e.g., in tests with mock documents), THE Provider SHALL fall back gracefully to computing the offset or returning a safe default
3. THE optimization SHALL NOT change the observable behavior of any Provider

### Requirement 2: Optimize Single Line Text Extraction

**User Story:** As a developer, I want hover and definition lookups to be fast, so that I can quickly understand code without lag.

#### Acceptance Criteria

1. WHEN a Provider needs to extract a single line's text AND DocumentState is available, THE Provider SHALL use line_offsets to compute start/end positions and use substring instead of splitting all lines
2. WHEN extracting line text, THE Provider SHALL handle edge cases (last line, empty document, out-of-bounds position) correctly
3. THE optimization SHALL preserve exact string content including whitespace and special characters

### Requirement 3: Provide Utility Functions

**User Story:** As a maintainer, I want consistent utility functions for line access, so that optimizations are applied uniformly and code is DRY.

#### Acceptance Criteria

1. THE codebase SHALL provide a utility function to get a single line's text given DocumentState and line number
2. THE codebase SHALL provide a utility function to get a character at a position given DocumentState and Position
3. THE utility functions SHALL handle missing line_offsets gracefully with fallback behavior
4. THE utility functions SHALL be documented with JSDoc comments

### Requirement 4: Comprehensive Optimization Coverage

**User Story:** As a user, I want all line-splitting patterns optimized, so that the entire LSP benefits from consistent performance improvements.

#### Acceptance Criteria

1. THE optimization effort SHALL address all `content.split('\n')` patterns in completion provider and macro-completion module
2. THE optimization effort SHALL address all `content.split('\n')` patterns in hover provider
3. THE optimization effort SHALL address all `content.split('\n')` patterns in definition provider
4. THE optimization effort SHALL address all `content.split('\n')` patterns in diagnostics provider
5. THE optimization effort SHALL address all `content.split('\n')` patterns in formatter provider
6. THE optimization effort SHALL address all `content.split('\n')` patterns in directive-parser module
7. THE optimization effort SHALL address all `content.split('\n')` patterns in scope-resolver module
8. THE optimization effort SHALL address all `content.split('\n')` patterns in context-tracker module
9. THE optimization effort SHALL address all `content.split('\n')` patterns in analyzer module
10. THE optimization effort SHALL address all `content.split('\n')` patterns in document-store module
11. THE optimization effort SHALL address all `content.split('\n')` patterns in indexer module
12. THE optimization effort SHALL address all `content.split('\n')` patterns in comment-processor module
13. THE optimization effort SHALL address all `content.split('\n')` patterns in smcl-extractor module
