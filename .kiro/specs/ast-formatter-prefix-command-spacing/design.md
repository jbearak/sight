# Design Document: AST Formatter Prefix Command Spacing

## Overview

This design addresses critical bugs in the PrettyPrinter (AST formatter) that cause it to produce syntactically invalid Stata code. The formatter incorrectly handles spacing around colons, commas, and varlists, resulting in:
- Newlines inserted after prefix command colons instead of spaces
- Varlists dropped entirely from output
- Newlines inserted after commas before options
- Colons dropped from qualifier syntax

The root cause is that the PrettyPrinter's token spacing logic doesn't distinguish between different colon contexts (prefix separators vs qualifiers) and doesn't properly handle the relationship between commands, varlists, and options.

**Design Rationale**: Rather than patching individual cases, we'll implement a context-aware spacing system that understands the semantic role of each token based on its position in the AST. This ensures consistent behavior across all command structures.

## Architecture

### Current PrettyPrinter Structure

The PrettyPrinter (`src/pretty-printer/index.ts`) converts AST nodes back to source code by:
1. Traversing the AST recursively
2. Emitting tokens with appropriate spacing
3. Managing indentation depth and delimiter mode
4. Preserving trivia (comments, continuations)

The spacing logic currently uses a generic approach that doesn't account for the semantic context of tokens, leading to incorrect spacing decisions.

### Proposed Changes

We'll enhance the PrettyPrinter with:

1. **Context-Aware Spacing System**: Track the current formatting context (prefix command, main command, varlist, options) to determine appropriate spacing
2. **Colon Role Detection**: Distinguish between prefix colons (require space after) and qualifier colons (require space after)
3. **Varlist Preservation**: Ensure varlists are emitted before options
4. **Statement Terminator Control**: Only emit newlines at statement boundaries, not within command structures

## Components and Interfaces

### Enhanced PrettyPrinter

**Location**: `src/pretty-printer/index.ts`

**New Internal State**:
```typescript
class PrettyPrinter {
    // Existing state
    private output: string[];
    private indent_level: number;
    private delimiter_mode: 'cr' | 'semicolon';
    
    // New state for context tracking
    private in_prefix_command: boolean;
    private after_prefix_colon: boolean;
    private in_command_arguments: boolean;
}
```

**Key Methods to Modify**:

```typescript
// Main command node handler
private format_command_node(node: CommandNode): void {
    // Handle prefix commands with colons
    if (node.prefix) {
        this.in_prefix_command = true;
        this.format_prefix_commands(node.prefix);
        this.in_prefix_command = false;
    }
    
    // Emit command name
    this.emit_token(node.name);
    
    // Emit varlist if present
    if (node.varlist && node.varlist.length > 0) {
        this.in_command_arguments = true;
        this.emit_space();
        this.format_varlist(node.varlist);
        this.in_command_arguments = false;
    }
    
    // Emit options if present
    if (node.options && node.options.length > 0) {
        this.format_options(node.options);
    }
    
    // Emit statement terminator
    this.emit_statement_terminator();
}

// Prefix command handler
private format_prefix_commands(prefix: PrefixNode[]): void {
    for (const my_prefix of prefix) {
        this.emit_token(my_prefix.command);
        
        // Handle frame prefix with subcommand
        if (my_prefix.subcommand) {
            this.emit_space();
            this.emit_token(my_prefix.subcommand);
        }
        
        // Emit colon with space after (not newline)
        if (my_prefix.has_colon) {
            this.emit_token(':');
            this.after_prefix_colon = true;
            this.emit_space();  // Space, not newline
            this.after_prefix_colon = false;
        } else {
            this.emit_space();
        }
    }
}

// Varlist handler
private format_varlist(varlist: string[]): void {
    for (let i = 0; i < varlist.length; i++) {
        this.emit_token(varlist[i]);
        if (i < varlist.length - 1) {
            this.emit_space();
        }
    }
}

// Options handler
private format_options(options: OptionNode[]): void {
    // Emit comma before options
    this.emit_token(',');
    this.emit_space();  // Space, not newline
    
    for (let i = 0; i < options.length; i++) {
        this.format_option(options[i]);
        if (i < options.length - 1) {
            this.emit_space();
        }
    }
}

// Colon qualifier handler (e.g., unab varname: _all)
private format_colon_qualifier(node: ColonQualifierNode): void {
    this.emit_token(node.variable_name);
    this.emit_token(':');
    this.emit_space();  // Space after colon
    this.emit_token(node.expansion);
}

// Statement terminator control
private emit_statement_terminator(): void {
    // Only emit newline at end of complete statements
    if (!this.in_prefix_command && !this.after_prefix_colon) {
        if (this.delimiter_mode === 'cr') {
            this.emit_newline();
        } else {
            this.emit_token(';');
            this.emit_newline();
        }
    }
}

// Token emission helpers
private emit_space(): void {
    this.output.push(' ');
}

private emit_newline(): void {
    this.output.push('\n');
}

private emit_token(token: string): void {
    this.output.push(token);
}
```

### AST Node Structure

The existing AST nodes already contain the necessary information:

```typescript
interface CommandNode {
    type: 'command';
    prefix?: PrefixNode[];  // Prefix commands (capture, quietly, frame, etc.)
    name: string;           // Command name
    varlist?: string[];     // Variable list
    options?: OptionNode[]; // Command options
    // ... other fields
}

interface PrefixNode {
    command: string;        // Prefix command name (capture, frame, etc.)
    subcommand?: string;    // Frame name or other subcommand
    has_colon: boolean;     // Whether this prefix uses colon syntax
}

interface OptionNode {
    name: string;
    value?: string;
}
```

**Design Decision**: We don't need to modify the AST structure. The existing nodes contain all necessary information. The bug is purely in the formatting logic, not the parsing.

## Data Models

### Formatting Context

```typescript
enum FormattingContext {
    TopLevel,           // Outside any command
    PrefixCommand,      // Inside a prefix command
    AfterPrefixColon,   // Immediately after a prefix colon
    CommandArguments,   // In command arguments/varlist
    CommandOptions      // In command options
}
```

This enum helps track where we are in the command structure to make correct spacing decisions.

### Spacing Rules

```typescript
interface SpacingRule {
    before_token: string;
    after_token: string;
    context: FormattingContext;
    spacing: 'space' | 'newline' | 'none';
}

const SPACING_RULES: SpacingRule[] = [
    // Prefix colon: always space after, never newline
    { before_token: ':', after_token: '*', context: FormattingContext.PrefixCommand, spacing: 'space' },
    
    // Qualifier colon: always space after
    { before_token: ':', after_token: '*', context: FormattingContext.CommandArguments, spacing: 'space' },
    
    // Comma before options: space after, never newline
    { before_token: ',', after_token: '*', context: FormattingContext.CommandOptions, spacing: 'space' },
    
    // Between command and varlist: space
    { before_token: 'command', after_token: 'varlist', context: FormattingContext.CommandArguments, spacing: 'space' },
    
    // Between varlist items: space
    { before_token: 'varlist', after_token: 'varlist', context: FormattingContext.CommandArguments, spacing: 'space' },
];
```

**Design Rationale**: Explicit spacing rules make the formatter's behavior predictable and testable. Each rule maps a context and token pair to the correct spacing.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Prefix Colon Spacing

*For any* command with a prefix command and colon, formatting should produce a space (not newline) after the colon, keeping the prefix and main command on the same line.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Colon Preservation

*For any* command with a colon qualifier (e.g., `unab varname: _all`), formatting should preserve the colon in the output with a space after it.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Varlist Preservation

*For any* command with a varlist, formatting should include all varlist items in the output with spaces between them.

**Validates: Requirements 3.1, 3.2, 4.1, 4.2, 4.3**

### Property 4: Option Comma Spacing

*For any* command with options, formatting should emit `, ` (comma followed by space, not newline) before the options.

**Validates: Requirements 3.3**

### Property 5: Frame Prefix Spacing

*For any* frame prefix command, formatting should add spaces between `frame`, the frame name, and after the colon.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 6: Statement Terminator Placement

*For any* complete command, formatting should only add a statement terminator (newline or semicolon) at the end of the complete command, not within the command structure.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 7: Prefix Chain Spacing

*For any* command with multiple prefix commands, formatting should add spaces between each prefix command and maintain all components on a single line.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 8: Round-Trip Consistency

*For any* valid Stata command with prefix commands, colons, varlists, or options, formatting then parsing should produce an AST equivalent to the original.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 9: Edge Case Handling

*For any* command with empty varlists, no arguments, or only options, formatting should handle them without adding spurious spaces or newlines.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 10: Command Structure Recognition

*For any* CommandNode with prefix, varlist, or options fields, formatting should correctly identify and process each component according to its semantic role.

**Validates: Requirements 10.1, 10.2, 10.3**

## Error Handling

### Invalid AST Structures

**Error**: CommandNode missing required fields
**Handling**: Skip formatting for that node, emit warning to logger, continue with next node

**Error**: Prefix node with `has_colon: true` but no subcommand for frame prefix
**Handling**: Emit prefix command without colon, log warning

### Malformed Varlists

**Error**: Varlist contains empty strings or null values
**Handling**: Filter out invalid entries, format remaining valid items

### Inconsistent Option Structure

**Error**: Options array present but empty
**Handling**: Don't emit comma, continue formatting

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. **Prefix Colon Spacing**:
   - `capture frame this: that` → single line with space after colon
   - `frame bh: unab raw_vars_bh _all` → single line with space after colon
   - Multiple prefix commands with colons

2. **Colon Qualifier Preservation**:
   - `unab merp: _all` → colon preserved with space
   - `unab varlist: var*` → colon preserved

3. **Varlist and Options**:
   - `rename *, lower` → varlist preserved, comma space before options
   - `rename var1 var2, lower` → multiple varlist items with spaces
   - `summarize` → no varlist, no spurious spaces

4. **Edge Cases**:
   - Empty varlists
   - Commands with only options (no varlist)
   - Nested prefix commands
   - Frame prefix without colon

### Property-Based Tests

Property tests will verify universal properties across all inputs (minimum 100 iterations each):

1. **Property Test: Prefix Colon Never Newline**
   - Generate random commands with prefix commands and colons
   - Verify formatted output contains space (not newline) after colon
   - **Feature: ast-formatter-prefix-command-spacing, Property 1: Prefix Colon Spacing**

2. **Property Test: Colon Preservation**
   - Generate random commands with colon qualifiers
   - Verify formatted output contains the colon
   - **Feature: ast-formatter-prefix-command-spacing, Property 2: Colon Preservation**

3. **Property Test: Varlist Preservation**
   - Generate random commands with varlists
   - Verify all varlist items appear in formatted output
   - **Feature: ast-formatter-prefix-command-spacing, Property 3: Varlist Preservation**

4. **Property Test: Option Comma Spacing**
   - Generate random commands with options
   - Verify formatted output contains `, ` before options (not newline)
   - **Feature: ast-formatter-prefix-command-spacing, Property 4: Option Comma Spacing**

5. **Property Test: Round-Trip Consistency**
   - Generate random valid Stata commands
   - Format → Parse → verify AST equivalence
   - **Feature: ast-formatter-prefix-command-spacing, Property 8: Round-Trip Consistency**

6. **Property Test: Statement Terminator Placement**
   - Generate random commands with various structures
   - Verify newlines only appear at statement boundaries
   - **Feature: ast-formatter-prefix-command-spacing, Property 6: Statement Terminator Placement**

### Testing Framework

We'll use the existing test infrastructure:
- **Unit tests**: Bun test framework with explicit examples
- **Property tests**: fast-check library for randomized testing
- **Dual formatter testing**: All tests must run against both AST formatter and source-preserving formatter using helpers from `tests/property/helpers/formatter-test-utils.ts`

### Test Configuration

Each property test will:
- Run minimum 100 iterations (due to randomization)
- Reference its design document property in a comment
- Use the tag format: `Feature: ast-formatter-prefix-command-spacing, Property N: <property_text>`

## Implementation Notes

### Affected Files

1. **`src/pretty-printer/index.ts`**: Main implementation changes
   - Add context tracking state
   - Modify `format_command_node()` to handle prefix commands correctly
   - Add `format_prefix_commands()` helper
   - Add `format_varlist()` helper
   - Modify `format_options()` to use space (not newline) after comma
   - Update `emit_statement_terminator()` to respect context

2. **`src/pretty-printer/expression-spacing.ts`**: May need updates if expression spacing interacts with command spacing

3. **Tests**: New test files in `tests/property/` and `tests/unit/`

### Backward Compatibility

This change fixes bugs that produce invalid Stata code, so there's no backward compatibility concern. The formatter currently produces broken output, and this fix makes it produce valid output.

### Performance Considerations

The context tracking adds minimal overhead:
- A few boolean flags per command node
- No additional AST traversals
- No regex operations in hot paths

Expected performance impact: negligible (< 1% overhead).

### Integration with Source-Preserving Formatter

The source-preserving formatter (`src/formatter/source-preserving-formatter.ts`) may need similar fixes if it uses the PrettyPrinter for any reconstruction. We'll verify both formatters produce correct output.

## Open Questions

1. **Should we preserve user's original spacing style for prefix commands?**
   - Current design: Always normalize to single space
   - Alternative: Preserve multiple spaces if present in source
   - **Decision**: Normalize to single space for consistency (formatter's job is to normalize)

2. **How should we handle prefix commands without colons (e.g., `quietly summarize`)?**
   - Current design: Space after prefix command name
   - **Decision**: Confirmed - space after prefix command, no special handling needed

3. **Should varlist items always have single space separation?**
   - Current design: Yes, single space between items
   - **Decision**: Yes, consistent with Stata conventions
