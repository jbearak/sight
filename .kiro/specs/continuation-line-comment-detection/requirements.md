# Requirements Document

## Introduction

This feature fixes a false positive in the indentation diagnostic analyzer where continuation lines with trailing comments (e.g., `/// comment text`) are not correctly identified as continuation lines. In Stata, `///` is a line continuation marker, and any text after it on the same line is treated as a comment. The current implementation uses string manipulation (`endsWith('///')`) which fails when there's a comment after the continuation marker. The fix should leverage the existing `CONTINUATION` token type from the lexer.

## Glossary

- **Continuation_Line**: A line that continues a statement from the previous line, indicated by a `CONTINUATION` token on the previous line
- **Continuation_Token**: A token of type `CONTINUATION` produced by the lexer when it encounters `///`
- **Trailing_Comment**: Text that appears after `///` on the same line, which Stata treats as a comment (included in the `CONTINUATION` token value)
- **Indentation_Diagnostic_Analyzer**: The component that detects indentation issues in Stata code

## Requirements

### Requirement 1: Use Token-Based Continuation Detection

**User Story:** As a developer, I want the LSP to correctly identify continuation lines using the lexer's `CONTINUATION` tokens, so that I don't receive false positive indentation warnings.

#### Acceptance Criteria

1. WHEN detecting if a line is a continuation, THE Indentation_Diagnostic_Analyzer SHALL check for `CONTINUATION` tokens on the previous line rather than using string manipulation
2. WHEN a `CONTINUATION` token exists on a line (regardless of trailing comment text), THE Indentation_Diagnostic_Analyzer SHALL recognize the next line as a continuation line
3. THE Indentation_Diagnostic_Analyzer SHALL compute a set of continuation lines from the document's tokens for efficient lookup

### Requirement 2: Skip Continuation Lines in Unnecessary Indentation Check

**User Story:** As a developer, I want continuation lines to be excluded from unnecessary indentation diagnostics, so that I can align my continuation lines without receiving false warnings.

#### Acceptance Criteria

1. WHEN a continuation line has custom indentation for alignment purposes, THE Indentation_Diagnostic_Analyzer SHALL NOT emit an unnecessary indentation diagnostic
2. WHEN a line follows a line with a `CONTINUATION` token, THE Indentation_Diagnostic_Analyzer SHALL skip the unnecessary indentation check for that line

### Requirement 3: Trace Back Through Continuation Lines

**User Story:** As a developer, I want the indentation analyzer to correctly trace back through multi-line continuations to find the original statement's indentation.

#### Acceptance Criteria

1. WHEN tracing back to find the original statement indentation, THE Indentation_Diagnostic_Analyzer SHALL use the token-based continuation detection
2. WHEN multiple continuation lines exist, THE Indentation_Diagnostic_Analyzer SHALL correctly trace back to the original statement by checking for `CONTINUATION` tokens on each line
