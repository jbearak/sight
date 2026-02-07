# Design Document: Stata Outline Improvements

## Overview

This design extends the existing section detector (`src/providers/section-detector.ts`) to support block comment headings, banner section nesting levels, and improved false positive filtering. The implementation maintains the existing multi-phase detection architecture while adding new pattern recognition capabilities and validation logic.

The design preserves the O(N) single-pass performance characteristic and maintains backward compatibility with all existing heading patterns.

## Architecture

The section detector follows a pipeline architecture with four detection phases:

1. **Single-line sections** (highest priority)
2. **Banner sections** (including new block comment headings)
3. **Starred inline sections**
4. **Numbered sections** (lowest priority, with new false positive filtering)

Each phase operates on the document content and line offsets, marking consumed lines to prevent overlapping detections. The phases run sequentially, with later phases skipping lines already consumed by earlier phases.


## Components and Interfaces

### Block Comment Heading Detector

**Purpose**: Detect multi-line comment blocks with asterisk borders used as section headings.

**Pattern Recognition**:
```text
/********************************************************************
 Current contraceptive methods for Rounds IV-VIII (v307_01-v307_21)
*******************************************************************/
```

**Algorithm**:
1. For each line i in the document (where i > 0 and i < total_lines - 1):
   - Check if line i-1 is an asterisk delimiter (4+ asterisks, optional whitespace)
   - Check if line i+1 is an asterisk delimiter (4+ asterisks, optional whitespace)
   - If both checks pass, extract heading text from line i
   - Strip leading/trailing asterisks and whitespace from heading text
   - If heading text is non-empty and not delimiter-only, create section
   - Mark lines i-1, i, and i+1 as consumed

**Integration**: This detector runs as part of Phase 2 (banner sections), before the existing banner detection logic.


### Banner Section Nesting Level Calculator

**Purpose**: Derive nesting levels from delimiter repetition counts in banner sections.

**Current Behavior**: All banner sections are assigned level 1.

**New Behavior**: Level is derived from delimiter character repetition count.

**Algorithm**:
1. When classifying a delimiter line, count the number of delimiter characters
2. For pure delimiter lines (e.g., `****`, `//////`), count total characters
3. For comment-prefixed delimiters (e.g., `// ====`, `* ----`), count repeated delimiter chars after prefix
4. Derive level from count:
   - 4 characters → level 1
   - 5-7 characters → level 2
   - 8-11 characters → level 3
   - 12+ characters → level 4
5. For banner sections with top and bottom delimiters, use minimum of the two counts

**Function Signature**:
```typescript
function count_delimiter_chars(line: string, kind: DelimiterKind): number
```

**Integration**: Modify `detect_banner_sections()` to call this function and assign the calculated level.


### Pure Heading Line Validator

**Purpose**: Ensure that only lines containing exclusively heading patterns are recognized as headings.

**Problem Pattern**:
```stata
// For DHS datasets for round I-III they contain v312, a variable indicating...
    * 0 not using 
    * 1 pill
    * 2 iud 
    * 3 injections
```

Lines "0 not using" through "3 injections" should NOT be detected because they are indented list items, not standalone headings at the document structure level.

**Key Insight**: Valid section headings are lines that contain ONLY the heading pattern. They don't have additional explanatory text, code, or other content. This is the simplest and most reliable way to distinguish headings from list items or inline comments.

**Current Patterns Already Enforce This**:

Looking at the existing patterns:
- `SLASH_SECTION_PATTERN`: `// Section Name ----` (requires trailing delimiter)
- `STAR_SECTION_PATTERN`: `* Section Name ----` (requires trailing delimiter)
- `STARRED_INLINE_PATTERN`: `*** Section Name ***` (requires surrounding asterisks)
- `NUMBERED_SECTION_PATTERN`: `* 1.1 Name` (just number and text)

The first three patterns already enforce "heading only" through their structure. The problematic pattern is `NUMBERED_SECTION_PATTERN`, which matches lines like:
- `* 1. Section Name` ✓ (valid heading)
- `    * 0 not using` ✗ (indented list item)

**Solution**: Add indentation check to numbered section detection.

**Algorithm**:
```typescript
function is_standalone_heading(line: string): boolean {
    // Check if line has significant leading whitespace
    // Valid headings start at column 0 or have minimal indentation (< 4 spaces)
    const leading_whitespace = line.length - line.trimStart().length;
    
    // Reject lines with 4+ spaces or any tabs
    if (leading_whitespace >= 4 || line.startsWith('\t')) {
        return false;
    }
    
    return true;
}
```

**Integration**: Call this function in `detect_numbered_sections()` before creating a section. Skip section creation if function returns false.

**Why This Works**: 
- Document-level headings are typically at column 0 or minimally indented
- List items are indented to show they're subordinate to explanatory text
- The 4-space threshold matches common indentation conventions (1 tab = 4 spaces)


## Data Models

### Extended DelimiterKind Type

No changes needed. The existing `DelimiterKind` type already supports asterisk delimiters.

### RawSection Interface

No changes needed. The existing interface supports arbitrary nesting levels via the `level` field.

### New Helper Function Return Types

```typescript
// Returns the count of delimiter characters in a line
function count_delimiter_chars(line: string, kind: DelimiterKind): number

// Returns true if a line is a standalone heading (not indented list content)
function is_standalone_heading(line: string): boolean

// Returns true if a line is a pure asterisk delimiter
function is_asterisk_delimiter(line: string): boolean
```


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Block Comment Heading Detection

*For any* valid three-line block comment pattern with asterisk borders on lines i-1 and i+1, and heading text on line i, the Section_Detector should identify it as a section with the extracted heading text as the name.

**Validates: Requirements 1.1, 1.4**

### Property 2: Asterisk Delimiter Validation

*For any* line consisting of 4 or more asterisks with optional leading/trailing whitespace, the delimiter validation function should recognize it as a valid block comment delimiter.

**Validates: Requirements 1.2, 1.3**

### Property 3: Block Comment Line Consumption

*For any* detected block comment heading spanning lines i-1, i, and i+1, all three line numbers should appear in the consumed lines set after detection completes.

**Validates: Requirements 1.5**


### Property 4: Banner Section Level Derivation

*For any* banner section with delimiter lines containing N delimiter characters, the assigned nesting level should be correctly derived from N according to the level calculation formula (4 chars → level 1, 5-7 → level 2, 8-11 → level 3, 12+ → level 4).

**Validates: Requirements 2.4**

### Property 5: Minimum Level for Mismatched Delimiters

*For any* banner section where the top delimiter has N characters and the bottom delimiter has M characters (where N ≠ M), the assigned nesting level should be derived from min(N, M).

**Validates: Requirements 2.5**

### Property 6: Pure Heading Line Validation

*For any* line with 4 or more spaces of leading whitespace or starting with a tab character, if it matches a numbered section pattern, it should not be detected as a section.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 7: Backward Compatibility for Mixed Patterns

*For any* document containing multiple section pattern types (single-line, banner, starred inline, numbered), all valid patterns should be detected according to their respective detection rules and priority ordering.

**Validates: Requirements 4.5**

### Property 8: No Duplicate Line Detection

*For any* document, no line number should appear as the start line of more than one detected section.

**Validates: Requirements 5.4**


## Error Handling

### Invalid Block Comment Patterns

**Scenario**: Block comment with mismatched delimiters (e.g., top line has asterisks, bottom line has dashes)

**Handling**: Skip detection for this pattern. The existing banner section detector will handle it if it matches standard banner rules.

### Empty or Delimiter-Only Heading Text

**Scenario**: Block comment middle line contains only asterisks, whitespace, or is empty after stripping

**Handling**: Skip section creation. Use the existing `is_delimiter_only()` helper to validate extracted text.

### Malformed Delimiter Lines

**Scenario**: Lines with fewer than 4 delimiter characters

**Handling**: Do not recognize as valid delimiters. Existing validation logic already handles this.

### List Item Detection Edge Cases

**Scenario**: A single numbered comment line that is indented with 4+ spaces

**Handling**: Do not detect as a section. The indentation check will filter it out.

**Scenario**: A numbered comment line at column 0 that looks like a list item

**Handling**: Allow detection as a section. If it's at column 0, it's formatted as a heading, not a list item.

**Scenario**: Mixed indentation (tabs and spaces)

**Handling**: Any line starting with a tab is considered indented content, not a heading.


## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs

Both testing approaches are complementary and necessary. Unit tests catch concrete bugs in specific scenarios, while property tests verify general correctness across a wide range of inputs.

### Property-Based Testing

**Library**: Use `fast-check` (already used in the project)

**Configuration**: Each property test should run a minimum of 100 iterations to ensure adequate coverage through randomization.

**Test Tagging**: Each property-based test must include a comment tag referencing the design document property:

```typescript
// Feature: stata-outline-improvements, Property 1: Block Comment Heading Detection
```

**Property Test Coverage**:

1. **Property 1 - Block Comment Heading Detection**
   - Generate random three-line block comment patterns
   - Vary heading text content (alphanumeric, special chars, mixed)
   - Verify section is detected with correct name extraction

2. **Property 2 - Asterisk Delimiter Validation**
   - Generate lines with 4-20 asterisks
   - Add random leading/trailing whitespace
   - Verify all are recognized as valid delimiters

3. **Property 3 - Block Comment Line Consumption**
   - Generate documents with block comment headings at various positions
   - Verify consumed set contains all three line numbers for each heading

4. **Property 4 - Banner Section Level Derivation**
   - Generate banner sections with 4-20 delimiter characters
   - Verify level calculation matches formula for all counts

5. **Property 5 - Minimum Level for Mismatched Delimiters**
   - Generate banner sections with different top/bottom delimiter counts
   - Verify level is derived from minimum count

6. **Property 6 - Pure Heading Line Validation**
   - Generate numbered comment lines with varying indentation (0-10 spaces, tabs)
   - Verify lines with 4+ spaces or tabs are not detected as sections
   - Verify lines with 0-3 spaces are detected as sections

7. **Property 7 - Backward Compatibility for Mixed Patterns**
   - Generate documents with multiple pattern types
   - Verify all valid patterns are detected

8. **Property 8 - No Duplicate Line Detection**
   - Generate documents with overlapping pattern candidates
   - Verify no line appears in multiple sections


### Unit Testing

**Unit Test Focus Areas**:

1. **Specific Examples**:
   - Test the exact block comment pattern from `contraceptive_methods.do`
   - Test single-line sections with various delimiter types
   - Test banner sections with matching delimiters
   - Test starred inline sections
   - Test numbered sections (valid standalone cases)

2. **Edge Cases**:
   - Block comment at start of file (line 0)
   - Block comment at end of file
   - Single-character delimiter counts (should map to level 1)
   - Very large delimiter counts (20+ characters)
   - Empty heading text after stripping
   - Heading text that is all delimiters

3. **List Item Patterns**:
   - The specific list pattern from `contraceptive_methods.do` (lines with "    * 0 not using", "    * 1 pill", etc. - note the indentation)
   - Numbered line with exactly 4 spaces (should not detect)
   - Numbered line with 3 spaces (should detect)
   - Numbered line with tab character (should not detect)
   - Numbered line at column 0 (should detect)

4. **Integration Tests**:
   - Document with all four pattern types
   - Document with overlapping pattern candidates
   - Document with block comments and regular banners
   - Large document (1000+ lines) with mixed patterns

5. **Regression Tests**:
   - Existing test cases for single-line sections
   - Existing test cases for banner sections
   - Existing test cases for starred inline sections
   - Existing test cases for numbered sections

**Test Organization**:
- Unit tests in `tests/unit/section-detector.test.ts`
- Property tests in `tests/property/section-detector.prop.test.ts`
- Integration tests in `tests/integration/section-detector-integration.test.ts`

