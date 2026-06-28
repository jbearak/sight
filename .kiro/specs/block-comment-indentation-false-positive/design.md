# Design Document: Block Comment Indentation False Positive Fix

## Overview

This design addresses a false positive in the `IndentationDiagnosticAnalyzer` where lines inside block comments (`/* ... */`) that don't start with `*` are incorrectly flagged with indentation diagnostics. The fix adds block comment region tracking to exclude all lines within block comments from indentation analysis.

## Architecture

The fix modifies the existing `IndentationDiagnosticAnalyzer` class in `src/providers/indentation-diagnostics.ts`. The change is localized to this single file and doesn't affect other components.

```
┌─────────────────────────────────────────────────────────────┐
│                 IndentationDiagnosticAnalyzer               │
├─────────────────────────────────────────────────────────────┤
│  analyze()                                                  │
│    ├── getStataRanges()                                     │
│    ├── compute_block_comment_lines() ← NEW                  │
│    ├── find_comment_indentation_issues()                    │
│    │     └── Skip lines in block_comment_lines              │
│    └── find_block_indentation_issues()                      │
│          └── Skip lines in block_comment_lines              │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified: IndentationDiagnosticAnalyzer

Add a new private method to compute which lines are inside block comments:

```typescript
/**
 * Computes a Set of line numbers that are inside block comments.
 * A line is considered "inside" a block comment if:
 * - It contains the opening /* (from /* to end of line)
 * - It is entirely within an open block comment
 * - It contains the closing */ (from start of line to */)
 */
private compute_block_comment_lines(lines: string[]): Set<number> {
    const block_comment_lines = new Set<number>();
    let in_block_comment = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let j = 0;
        
        while (j < line.length) {
            if (!in_block_comment) {
                // Look for /*
                if (line[j] === '/' && line[j + 1] === '*') {
                    in_block_comment = true;
                    block_comment_lines.add(i);
                    j += 2;
                    continue;
                }
            } else {
                // Already in block comment - this line is inside
                block_comment_lines.add(i);
                
                // Look for */
                if (line[j] === '*' && line[j + 1] === '/') {
                    in_block_comment = false;
                    j += 2;
                    continue;
                }
            }
            j++;
        }
        
        // If we're still in a block comment at end of line, mark this line
        if (in_block_comment) {
            block_comment_lines.add(i);
        }
    }
    
    return block_comment_lines;
}
```

### Modified: analyze() method

Update to compute block comment lines and pass to diagnostic methods:

```typescript
analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = document.content.split('\n');

    if (config.diagnostics.indentation === false) {
        return diagnostics;
    }

    const stataRanges = this.getStataRanges(document);
    const block_comment_lines = this.compute_block_comment_lines(lines);  // NEW
    
    for (const range of stataRanges) {
        diagnostics.push(...this.find_comment_indentation_issues(lines, range, block_comment_lines));
        diagnostics.push(...this.find_block_indentation_issues(document, lines, range, block_comment_lines));
    }

    return diagnostics;
}
```

### Modified: find_comment_indentation_issues()

Add parameter and skip lines inside block comments:

```typescript
private find_comment_indentation_issues(
    lines: string[], 
    range: { start: number; end: number },
    block_comment_lines: Set<number>  // NEW parameter
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    for (let i = range.start; i < range.end && i < lines.length - 1; i++) {
        // Skip lines inside block comments
        if (block_comment_lines.has(i) || block_comment_lines.has(i + 1)) {
            continue;
        }
        
        // ... rest of existing logic
    }
    
    return diagnostics;
}
```

### Modified: find_block_indentation_issues()

Add parameter and skip lines inside block comments:

```typescript
private find_block_indentation_issues(
    document: DocumentState, 
    lines: string[], 
    range: { start: number; end: number },
    block_comment_lines: Set<number>  // NEW parameter
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    for (let i = range.start; i <= range.end && i < lines.length; i++) {
        // Skip lines inside block comments
        if (block_comment_lines.has(i)) {
            continue;
        }
        
        // ... rest of existing logic (also skip inner lines in block comments)
    }
    
    return diagnostics;
}
```

## Data Models

No new data models are required. The implementation uses a `Set<number>` to track line numbers inside block comments, which is efficient for membership checks.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Block comment line exclusion

*For any* Stata source code containing a block comment with any content and any indentation pattern, the `IndentationDiagnosticAnalyzer` should produce zero indentation diagnostics for lines that are inside the block comment boundaries.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Post-block-comment diagnostic resumption

*For any* Stata source code where a block comment is followed by code with intentional indentation issues, the `IndentationDiagnosticAnalyzer` should produce appropriate diagnostics for the code lines after the block comment closes.

**Validates: Requirements 1.4**

### Property 3: Nested delimiter handling

*For any* block comment containing nested `/*` sequences within its content, the `IndentationDiagnosticAnalyzer` should track comment depth and identify the block comment as ending only at the matching `*/` (Stata block comments nest, matching the lexer and TextMate grammar).

**Validates: Requirements 2.3**

## Error Handling

- If `lines` array is empty, `compute_block_comment_lines` returns an empty Set
- If a block comment is never closed (unbalanced), all lines from `/*` to end of file are marked as inside block comment
- The existing lexer already reports unbalanced block comment errors, so this analyzer doesn't need to duplicate that

## Testing Strategy

### Unit Tests

1. Test `compute_block_comment_lines` with various inputs:
   - Single-line block comment: `/* comment */`
   - Multi-line block comment with `*` prefixed lines
   - Multi-line block comment with non-`*` prefixed lines (the bug case)
   - Multiple block comments in one file
   - Unclosed block comment

2. Test the full analyzer with the specific reproduction case from the bug report

### Property-Based Tests

Use fast-check to generate:
- Random block comment content with varying indentation
- Random code before and after block comments
- Verify no diagnostics inside block comments
- Verify diagnostics resume after block comments

**Property Test Configuration:**
- Minimum 100 iterations per property test
- Tag format: **Feature: block-comment-indentation-false-positive, Property N: [property text]**
