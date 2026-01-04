# Requirements Document

## Introduction

This document specifies requirements for fixing flaky property-based tests in the Sight LSP test suite. The tests in question are failing intermittently due to generator issues that produce inputs which trigger expected formatter behavior (trailing whitespace removal) that the tests incorrectly flag as failures.

## Glossary

- **Property_Test**: A test that verifies a property holds for all generated inputs using fast-check
- **Generator**: A fast-check arbitrary that produces random test inputs
- **Trailing_Comment**: A comment that appears after code on the same line (using `//` or `/* */` syntax)
- **Source_Preserving_Formatter**: The formatter mode that preserves original source structure while applying formatting
- **Comment_Content**: The text content of a comment including the comment delimiters

## Requirements

### Requirement 1: Fix Comment Generator Trailing Whitespace

**User Story:** As a test maintainer, I want the trailing comment generator to produce comments without trailing whitespace, so that the formatting preservation test doesn't fail due to expected whitespace normalization.

#### Acceptance Criteria

1. WHEN the `arbitrary_trailing_comment()` generator produces a comment THEN the Generator SHALL NOT include trailing whitespace after the comment text
2. WHEN a `//` style comment is generated THEN the Generator SHALL produce content in the format `// <text>` where `<text>` has no trailing spaces
3. WHEN a `/* */` style comment is generated THEN the Generator SHALL produce content in the format `/* <text> */` where `<text>` has no trailing spaces
4. THE Generator SHALL continue to produce valid Stata trailing comments that are recognized by the lexer

### Requirement 2: Update Formatting Preservation Test Comparison Logic

**User Story:** As a test maintainer, I want the comment preservation test to compare normalized comment content, so that whitespace-only differences don't cause false failures.

#### Acceptance Criteria

1. WHEN comparing original and formatted comment content THEN the Test SHALL normalize whitespace before comparison
2. WHEN a comment's semantic content is preserved but whitespace differs THEN the Test SHALL consider the comments equivalent
3. THE Test SHALL still detect actual content changes (non-whitespace differences) as failures
4. IF the formatter removes trailing whitespace from comments THEN the Test SHALL NOT report this as a failure

### Requirement 3: Verify Other Mentioned Tests Are Not Actually Flaky

**User Story:** As a test maintainer, I want to confirm that the valid-block-terminators and orphan-closing-brace tests are stable, so that we don't make unnecessary changes.

#### Acceptance Criteria

1. WHEN running the `valid-block-terminators.prop.test.ts` tests multiple times THEN the Tests SHALL pass consistently
2. WHEN running the `orphan-closing-brace.prop.test.ts` tests multiple times THEN the Tests SHALL pass consistently
3. IF these tests are found to be stable THEN no changes SHALL be made to them
