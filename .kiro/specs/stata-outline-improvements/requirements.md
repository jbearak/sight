# Requirements Document

## Introduction

This document specifies requirements for improving the Stata LSP outline/document symbols feature to better detect heading patterns in Stata .do files. The current section detector (`src/providers/section-detector.ts`) extracts heading patterns for display in VS Code's Outline panel but has gaps in pattern recognition and produces false positives.

The improvements will enhance the developer experience by providing more accurate and comprehensive document structure visualization, making it easier to navigate large Stata .do files.

## Glossary

- **Section_Detector**: The module responsible for identifying heading patterns in Stata .do files
- **Outline_Panel**: VS Code's Outline view that displays document structure
- **Banner_Section**: A three-line heading pattern with delimiter lines above and below the heading text
- **Block_Comment_Heading**: A multi-line comment block with asterisk borders used as a section heading
- **Delimiter_Repetition**: The count of repeated delimiter characters (e.g., `//` vs `///`)
- **Nesting_Level**: The hierarchical depth of a heading in the document structure
- **False_Positive**: A line incorrectly identified as a section heading
- **List_Item**: A comment line that is part of a list, not a standalone heading
- **Single_Line_Section**: A heading pattern on one line (e.g., `// Section Name ----`)
- **Starred_Inline_Section**: A heading pattern with asterisks on both sides (e.g., `*** SECTION NAME ***`)
- **Numbered_Section**: A heading pattern with numeric prefix (e.g., `* 1.1 Section Name`)

## Requirements

### Requirement 1: Block Comment Heading Detection

**User Story:** As a Stata developer, I want block comment headings with asterisk borders to be recognized as sections, so that I can navigate to major code divisions marked with this common pattern.

#### Acceptance Criteria

1. WHEN a multi-line comment block has asterisk borders on top and bottom lines AND contains heading text in the middle THEN the Section_Detector SHALL identify it as a section
2. WHEN the top border line consists of 4 or more asterisks with optional whitespace THEN the Section_Detector SHALL recognize it as a valid block comment delimiter
3. WHEN the bottom border line consists of 4 or more asterisks with optional whitespace THEN the Section_Detector SHALL recognize it as a valid block comment delimiter
4. WHEN the middle line contains non-delimiter text preceded by comment markers THEN the Section_Detector SHALL extract that text as the section name
5. WHEN a block comment heading is detected THEN the Section_Detector SHALL mark all three lines as consumed to prevent duplicate detection


### Requirement 2: Banner Section Nesting Levels

**User Story:** As a Stata developer, I want banner sections with different delimiter repetition counts to indicate nesting levels, so that the outline reflects the hierarchical structure of my code organization.

#### Acceptance Criteria

1. WHEN a banner section uses single-character delimiters (e.g., `//` or `*`) THEN the Section_Detector SHALL assign it nesting level 1
2. WHEN a banner section uses double-character delimiters (e.g., `////` or `**`) THEN the Section_Detector SHALL assign it nesting level 2
3. WHEN a banner section uses triple-character delimiters (e.g., `//////` or `***`) THEN the Section_Detector SHALL assign it nesting level 3
4. WHEN a banner section uses N repeated delimiter characters THEN the Section_Detector SHALL derive the nesting level from the repetition count
5. WHEN both top and bottom delimiter lines have different repetition counts THEN the Section_Detector SHALL use the minimum count for level determination


### Requirement 3: Pure Heading Line Validation

**User Story:** As a Stata developer, I want only lines that contain exclusively heading patterns to be recognized as sections, so that comments with mixed content are not incorrectly detected as headings.

#### Acceptance Criteria

1. WHEN a line contains a heading pattern AND additional non-heading text THEN the Section_Detector SHALL not recognize it as a heading
2. WHEN a line contains only a comment marker and heading pattern (no other text) THEN the Section_Detector SHALL consider it as a valid heading candidate
3. WHEN a line contains a heading pattern followed by code or other content THEN the Section_Detector SHALL not recognize it as a heading
4. WHEN validating single-line sections THEN the Section_Detector SHALL require the line to contain only the comment marker, heading text, and delimiter characters
5. WHEN validating numbered sections THEN the Section_Detector SHALL require the line to contain only the comment marker and the numbered heading pattern


### Requirement 4: Backward Compatibility

**User Story:** As a Stata developer with existing .do files, I want the improved section detector to continue recognizing all previously supported heading patterns, so that my existing document structure remains intact.

#### Acceptance Criteria

1. WHEN a single-line section pattern is present (e.g., `// Section Name ----`) THEN the Section_Detector SHALL continue to detect it as before
2. WHEN a banner section pattern is present with matching delimiters THEN the Section_Detector SHALL continue to detect it as before
3. WHEN a starred inline section pattern is present (e.g., `*** NAME ***`) THEN the Section_Detector SHALL continue to detect it as before
4. WHEN a numbered section pattern is present (e.g., `* 1.1 Name`) THEN the Section_Detector SHALL continue to detect it as before
5. WHEN multiple pattern types are present in the same file THEN the Section_Detector SHALL detect all of them according to priority rules


### Requirement 5: Performance Preservation

**User Story:** As a Stata developer working with large .do files, I want section detection to remain fast, so that the outline updates quickly as I edit my code.

#### Acceptance Criteria

1. WHEN processing a document with N lines THEN the Section_Detector SHALL complete in O(N) time complexity
2. WHEN detecting sections THEN the Section_Detector SHALL use a single-pass algorithm with consumed line tracking
3. WHEN checking for list item patterns THEN the Section_Detector SHALL use bounded lookahead (maximum 5 lines) to avoid O(N²) behavior
4. WHEN multiple detection phases run THEN the Section_Detector SHALL skip already-consumed lines to prevent redundant processing
5. WHEN extracting section names THEN the Section_Detector SHALL use efficient string operations without repeated allocations

