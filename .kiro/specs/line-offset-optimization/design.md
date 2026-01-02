# Design Document: Line Offset Optimization

## Overview

This design replaces inefficient `content.split('\n')` patterns throughout the LSP codebase with O(1) lookups using the pre-computed `line_offsets` array available in `DocumentState`. The optimization provides consistent performance regardless of document size.

Currently, many providers split the entire document content into an array of lines just to access a single line or character. With a 10,000-line file, this creates a 10,000-element array on every completion request. Using `line_offsets`, we can compute the exact character offset in constant time.

## Architecture

The optimization introduces utility functions in a new module that all providers can use:

```
DocumentState.line_offsets[n] = character offset where line n begins
                    ↓
┌─────────────────────────────────────────────────────────────┐
│  src/utils/line-utils.ts (NEW)                              │
│  ├── get_line_text(doc, line_number) → string               │
│  ├── get_char_at_position(doc, position) → string | null    │
│  └── get_line_start_offset(doc, line_number) → number       │
└─────────────────────────────────────────────────────────────┘
                    ↓
        Used by all providers instead of split('\n')
```

## Components and Interfaces

### New Module: src/utils/line-utils.ts

```typescript
import { DocumentState } from '../document-store';
import { Position } from 'vscode-languageserver';

/**
 * Get the character offset where a line begins.
 * Uses line_offsets for O(1) lookup when available.
 * 
 * @param doc - Document state (must have content, may have line_offsets)
 * @param line_number - Zero-based line number
 * @returns Character offset, or 0 if line_number is 0 and line_offsets unavailable
 */
export function get_line_start_offset(
    doc: { content: string; line_offsets?: number[] },
    line_number: number
): number {
    if (doc.line_offsets && line_number < doc.line_offsets.length) {
        return doc.line_offsets[line_number];
    }
    // Fallback: compute offset by scanning (only for tests without line_offsets)
    if (line_number === 0) return 0;
    let offset = 0;
    let current_line = 0;
    while (current_line < line_number && offset < doc.content.length) {
        if (doc.content[offset] === '\n') {
            current_line++;
        }
        offset++;
    }
    return offset;
}

/**
 * Get the text of a single line (without newline).
 * Uses line_offsets for O(1) start position lookup.
 * 
 * @param doc - Document state
 * @param line_number - Zero-based line number
 * @returns Line text, or empty string if line doesn't exist
 */
export function get_line_text(
    doc: { content: string; line_offsets?: number[] },
    line_number: number
): string {
    const start = get_line_start_offset(doc, line_number);
    if (start >= doc.content.length) return '';
    
    const end = doc.content.indexOf('\n', start);
    return end === -1 
        ? doc.content.substring(start)  // Last line
        : doc.content.substring(start, end);
}

/**
 * Get the character at a specific position.
 * Uses line_offsets for O(1) lookup.
 * 
 * @param doc - Document state
 * @param position - LSP position (line, character)
 * @returns Character at position, or null if out of bounds
 */
export function get_char_at_position(
    doc: { content: string; line_offsets?: number[] },
    position: Position
): string | null {
    const line_start = get_line_start_offset(doc, position.line);
    const char_index = line_start + position.character;
    if (char_index < 0 || char_index >= doc.content.length) {
        return null;
    }
    return doc.content[char_index];
}
```

### Migration Pattern

Each `content.split('\n')` usage falls into one of these categories:

**Category A: Single line access**
```typescript
// Before
const lines = content.split('\n');
const line = lines[position.line];

// After
const line = get_line_text(doc, position.line);
```

**Category B: Single character access**
```typescript
// Before
const lines = content.split('\n');
const char = lines[position.line]?.[position.character];

// After
const char = get_char_at_position(doc, position);
```

**Category C: Line count**
```typescript
// Before
const line_count = content.split('\n').length;

// After
const line_count = doc.line_offsets?.length ?? content.split('\n').length;
```

**Category D: Iteration over all lines**
```typescript
// Keep as-is if truly iterating all lines
// Or refactor to use line_offsets if only accessing specific lines
```

## Data Models

No new data models. Uses existing:
- `DocumentState` with `line_offsets: number[]`
- `Position` from vscode-languageserver

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Graceful Fallback

*For any* document content and line number, when `line_offsets` is unavailable, the utility functions SHALL compute the correct offset and return the same result as if `line_offsets` were present.

**Validates: Requirements 1.2, 3.3**

### Property 2: Behavior Preservation

*For any* document content and position, the optimized line/character access SHALL return exactly the same result as the original `split('\n')` approach, including edge cases (empty lines, last line without newline, special characters, whitespace).

**Validates: Requirements 1.3, 2.2, 2.3**

## Error Handling

- Out-of-bounds line numbers return empty string (for `get_line_text`) or null (for `get_char_at_position`)
- Missing `line_offsets` triggers fallback computation
- Empty document returns empty string for any line access

## Testing Strategy

### Unit Tests

1. Test `get_line_start_offset` with and without `line_offsets`
2. Test `get_line_text` for first line, middle line, last line, empty lines
3. Test `get_char_at_position` for various positions including boundaries
4. Test edge cases: empty document, single line, line without trailing newline

### Property-Based Tests

Property tests will use fast-check to generate:
- Random document content with varying line counts and lengths
- Random positions within and outside document bounds
- Documents with and without `line_offsets`

Verify that utility function outputs match `split('\n')` approach for all inputs.

Each property test should run at minimum 100 iterations.

**Tag format:** Feature: line-offset-optimization, Property N: [property text]
