# Design Document: Mata Block End Handling

## Overview

This design addresses two related bugs in the handling of Mata/Python block `end` statements:

1. **Indentation Diagnostic False Positive**: The `end` statement is incorrectly flagged as unnecessarily indented
2. **Formatter Code Deletion**: The formatter deletes the `end` statement and subsequent code

Both bugs stem from a mismatch between how context ranges and AST node ranges represent embedded blocks:
- **Context ranges** exclude the `end` delimiter line (range ends at line N-1 where `end` is on line N)
- **AST node ranges** include the `end` delimiter line (range ends at line N)

The fix involves:
1. Making the indentation analyzer recognize `embedded_block` AST nodes
2. Making the formatter include the `end` delimiter when extracting embedded block content

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Processing                          │
├─────────────────────────────────────────────────────────────────┤
│  Source Code                                                    │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────┐    ┌─────────┐    ┌──────────────┐                │
│  │  Lexer  │───▶│ Parser  │───▶│ Context      │                │
│  └─────────┘    └─────────┘    │ Tracker      │                │
│       │              │         └──────────────┘                │
│       │              │              │                           │
│       │              ▼              ▼                           │
│       │         ┌─────────┐   ┌──────────────┐                 │
│       │         │   AST   │   │ Context      │                 │
│       │         │ (nodes) │   │ Ranges       │                 │
│       │         └─────────┘   └──────────────┘                 │
│       │              │              │                           │
│       ▼              ▼              ▼                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              IndentationDiagnosticAnalyzer              │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ compute_expected_depths()                       │    │   │
│  │  │   - Walk AST nodes                              │    │   │
│  │  │   - Handle embedded_block nodes (NEW)           │    │   │
│  │  │   - Include end delimiter line at parent depth  │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    CodeFormatter                        │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ extract_block_content_with_delimiter() (NEW)    │    │   │
│  │  │   - Extract from start_line to end_line + 1     │    │   │
│  │  │   - Include the end delimiter line              │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Component 1: IndentationDiagnosticAnalyzer

#### Modified Method: `compute_expected_depths`

The method needs to handle `embedded_block` AST nodes by:
1. Setting the start line depth to the current depth
2. Setting the end line depth to the current depth (same as start)
3. NOT recursing into the embedded block content (it's a different language)

```typescript
compute_expected_depths(
    document: DocumentState,
    range: { start: number; end: number }
): Map<number, number> {
    // ... existing code ...
    
    const walk_node = (node: StataNode): void => {
        const start_line = node.range.start.line;
        const end_line = node.range.end.line;
        
        // Only process lines within the specified range
        if (start_line >= range.start && start_line <= range.end) {
            if (!expected_depths.has(start_line)) {
                expected_depths.set(start_line, current_depth);
            }
        }
        
        // NEW: Handle embedded_block nodes
        if (node.type === 'embedded_block') {
            // The end line (containing 'end') should be at the same depth as the start
            if (end_line !== start_line && end_line >= range.start && end_line <= range.end) {
                if (!expected_depths.has(end_line)) {
                    expected_depths.set(end_line, current_depth);
                }
            }
            // Don't recurse into embedded block content
            return;
        }
        
        // ... existing block node handling ...
    };
    
    // ... rest of method ...
}
```

### Component 2: CodeFormatter

#### Modified Method: `extract_block_content`

The method needs to include the end delimiter line when extracting embedded block content:

```typescript
private extract_block_content(
    doc: DocumentLike,
    context_range: ContextRange
): string {
    const the_start_line = context_range.range.start.line;
    // Include the end delimiter line (context range excludes it, but we need it)
    const the_end_line = context_range.end_delimiter 
        ? context_range.end_delimiter.range.start.line 
        : context_range.range.end.line;
    const the_line_count = get_line_count(doc);
    const the_block_lines: string[] = [];

    for (let i = the_start_line; i <= the_end_line && i < the_line_count; i++) {
        the_block_lines.push(get_line_text(doc, i));
    }

    return the_block_lines.join('\n');
}
```

#### Modified Method: `replace_range_in_content`

The method needs to use the correct range that includes the end delimiter:

```typescript
private format_with_embedded_preservation(
    document: DocumentState,
    options: FormattingOptions,
    context_ranges: ContextRange[],
    server_config?: StataLSPConfig
): TextEdit[] {
    // ... existing code ...

    for (const my_range of the_sorted_ranges) {
        // ... existing code ...
        
        // Calculate the actual range to replace (including end delimiter)
        const actual_end_line = my_range.end_delimiter 
            ? my_range.end_delimiter.range.start.line 
            : my_range.range.end.line;
        const actual_range = {
            start: my_range.range.start,
            end: { line: actual_end_line, character: Number.MAX_SAFE_INTEGER }
        };

        // Replace the block with placeholder using the actual range
        my_modified_content = this.replace_range_in_content(
            my_modified_content,
            actual_range,
            my_placeholder
        );

        my_placeholder_counter++;
    }
    
    // ... rest of method ...
}
```

### Component 3: IndentationAnalyzer (Formatter)

The `IndentationAnalyzer` in `src/formatter/indentation-analyzer.ts` needs to recognize `embedded_block` AST nodes as block structures.

#### Modified Method: `is_block_node`

Add `embedded_block` to the list of recognized block types:

```typescript
private is_block_node(node: StataNode): boolean {
    return node.type === 'program' ||
           node.type === 'if' ||
           node.type === 'else' ||
           node.type === 'foreach' ||
           node.type === 'forvalues' ||
           node.type === 'while' ||
           node.type === 'frame' ||
           node.type === 'embedded_block' ||  // NEW: recognize embedded blocks
           (node.type === 'command' && (node as any).name === '{');
}
```

#### Modified Method: `walk_node`

Add handling for `embedded_block` nodes before the general block node processing:

```typescript
private walk_node(node: StataNode): void {
    // Process leading trivia before the node
    this.process_node_trivia(node);

    // NEW: Handle embedded_block nodes specially
    if (node.type === 'embedded_block') {
        this.process_embedded_block_node(node);
        return;
    }

    if (this.is_block_node(node)) {
        if (node.type === 'command' && (node as any).name === '{') {
            this.process_command_brace_block(node);
        } else {
            this.process_block_node(node as ControlFlowNode | ProgramNode);
        }
    } else {
        this.process_regular_node(node);
    }
}
```

#### New Method: `process_embedded_block_node`

Handle embedded blocks by setting start and end line depths without recursing into content:

```typescript
private process_embedded_block_node(node: StataNode): void {
    const start_line = node.range.start.line;
    const end_line = node.range.end.line;

    // Set indentation for the start line (mata/python) at current depth
    const start_delta_info = this.calculate_indent_delta(start_line, this.current_depth);
    this.set_indentation(start_line, this.current_depth, false, true, false, false, 
        start_delta_info.delta, start_delta_info.original_indent);

    // Set indentation for the end line (end) at current depth (same as start)
    if (end_line !== start_line) {
        const end_delta_info = this.calculate_indent_delta(end_line, this.current_depth);
        this.set_indentation(end_line, this.current_depth, false, false, true, false, 
            end_delta_info.delta, end_delta_info.original_indent);
    }

    // Do NOT recurse into embedded block content - it's a different language
}
```

## Data Models

### ContextRange (existing, for reference)

```typescript
interface ContextRange {
    context: LanguageContext;
    range: Range;  // Excludes end delimiter line
    parent_context?: LanguageContext;
    start_delimiter: {
        command: string;
        range: Range;
    };
    end_delimiter?: {  // Contains the actual end delimiter position
        command: string;
        range: Range;
    };
    is_single_line: boolean;
}
```

The key insight is that `context_range.range.end.line` excludes the end delimiter, but `context_range.end_delimiter.range.start.line` gives us the actual line containing `end`.

### EmbeddedLanguageBlockNode (existing, for reference)

```typescript
interface EmbeddedLanguageBlockNode {
    type: 'embedded_block';
    language: 'mata' | 'python';
    start_command: string;
    end_command?: string;
    content: string;
    content_range: Range;
    is_single_line: boolean;
    range: Range;  // Includes end delimiter line
}
```

The AST node's `range.end.line` includes the end delimiter line, unlike the context range.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: End delimiter indentation correctness

*For any* Stata document containing a Mata or Python block where the `end` statement is indented at the same level as the opening `mata` or `python` keyword, the IndentationDiagnosticAnalyzer SHALL NOT emit an unnecessary indentation diagnostic for the `end` line.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Formatter round-trip preservation for embedded blocks

*For any* valid Stata document containing Mata or Python blocks, formatting the document SHALL produce output that contains all original statements including the `end` delimiter and any code following the embedded block.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2**

### Property 3: Formatter embedded block indentation correctness

*For any* Stata document containing a Mata or Python block at any nesting depth, the formatter SHALL NOT add extra indentation to the opening delimiter (`mata` or `python`) beyond what is expected for its nesting level.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

## Error Handling

### IndentationDiagnosticAnalyzer

- If an `embedded_block` node has no end delimiter (unclosed block), the analyzer should still set the start line depth correctly
- If the AST is malformed, fall back to existing behavior (no expected depth for the line)

### CodeFormatter

- If `context_range.end_delimiter` is undefined (unclosed block), fall back to using `context_range.range.end.line`
- If extraction fails, return original content unchanged (existing graceful degradation)

## Testing Strategy

### Unit Tests

1. Test `compute_expected_depths` with embedded blocks at various nesting levels
2. Test `extract_block_content` includes end delimiter line
3. Test formatter preserves code after embedded blocks

### Property-Based Tests

1. **End delimiter indentation correctness**: Generate random Stata documents with Mata/Python blocks at various nesting depths, verify no false positive diagnostics on properly indented `end` statements
2. **Formatter round-trip preservation**: Generate random Stata documents with embedded blocks and code after them, verify all statements are preserved after formatting

### Test Configuration

- Minimum 100 iterations per property test
- Test both Mata and Python blocks
- Test nested blocks (embedded block inside if/foreach/etc.)
- Test multiple embedded blocks in same document
- Test code before and after embedded blocks
