# Design Document: Frame Prefix Command Support

## Overview

This design addresses the incorrect handling of the `frame` prefix command in the Stata LSP. Currently, hovering over `frame` shows information for `framework` because the command database cache incorrectly maps `frame` as an abbreviation for `framework`. Additionally, subcommands like `create` in `frame create` are not recognized as frame-specific subcommands.

The solution involves:
1. Adding `frame` as a distinct prefix command in the command database
2. Removing the incorrect `frame` → `framework` abbreviation mapping
3. Implementing **metadata-driven** prefix-subcommand support in hover and completion (not hardcoded to `frame`)

## Architecture

The implementation touches three main components:

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  Command Database   │────▶│   Hover Provider    │────▶│   LSP Response      │
│  (builtin-commands) │     │   (hover.ts)        │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Cache (v18.json)   │     │  Subcommand Lookup  │
│  - Remove frame→    │     │  - frame create     │
│    framework abbrev │     │  - frame change     │
└─────────────────────┘     │  - frame drop, etc. │
                            └─────────────────────┘
```

## Components and Interfaces

### 1. Command Database Updates

#### 1.1 Add Frame Prefix Command to builtin-commands.ts

Add `frame` to the `PREFIX_COMMANDS` array with its subcommands stored as **subcommands metadata** (not overloaded as options):

```typescript
builtin_command(
    'frame',
    'frame',
    'frame subcommand [arguments]: command',
    'prefix',
    [],
    [
        subcommand('create', 'create'),
        subcommand('change', 'change'),
        subcommand('copy', 'copy'),
        subcommand('drop', 'drop'),
        subcommand('rename', 'rename'),
        subcommand('put', 'put'),
        subcommand('post', 'post'),
        subcommand('dir', 'dir'),
        subcommand('reset', 'reset'),
        subcommand('list', 'list'),
        subcommand('prefix', 'prefix'),
    ]
)
```

This allows the command database to represent prefix-subcommand structure without conflating it with option metadata.

#### 1.2 Update Cache to Remove Incorrect Abbreviation

The v18.json cache needs to be updated to:
1. Remove `frame` → `framework` from the abbreviations map
2. Add `frame` as a distinct command entry

### 2. Hover Provider Enhancement

#### 2.1 Subcommand Detection

Subcommand detection should be **token-based** when tokens are available, falling back to line heuristics only as a last resort.

Key rule:
- A hovered word is a subcommand only when it is the **immediate token after** a prefix command token within the current statement (after skipping standard prefixes like `by`, `quietly`, `capture`, etc. and handling `by varlist:`).

```typescript
interface SubcommandContext {
    prefix_command: string;
    subcommand: string;
}

private get_subcommand_context(
    document: DocumentState,
    position: Position,
    word: string
): SubcommandContext | null {
    // Prefer document.tokens-based detection.
    // Identify the hovered WORD token at position.
    // Find statement start (after STATEMENT_TERMINATOR).
    // Skip standard prefixes; handle by varlist:.
    // Verify hovered token is immediately after the prefix command token.
    // Verify prefix_command has subcommands via command_db metadata.
}
```

#### 2.2 Subcommand Hover Information

Provide hover information specific to prefix-subcommand combinations, sourced from the command database’s **subcommands metadata**:

```typescript
private get_subcommand_hover(
    prefix_command: string,
    subcommand: string
): MarkupContent | null {
    // Look up the prefix command’s subcommands metadata in the CommandDatabase.
    // Prefer prefix-subcommand interpretation over standalone command hover.
    // Return formatted hover information.
}
```

### 3. Prefix Commands with Subcommands

Avoid hardcoding the set of prefix commands with subcommands in providers.

Instead:
- The Command_Database should expose whether a command has subcommands (`has_subcommands(name)`)
- And provide the subcommands list (`get_subcommands(name)`)

This makes the behavior generic for any prefix command with subcommands (e.g., `frame`, `mi`, future additions) without provider-specific lists.

## Data Models

### Frame Subcommand Metadata

Each frame subcommand has specific syntax:

| Subcommand | Syntax | Description |
|------------|--------|-------------|
| create | `frame create framename` | Create a new empty frame |
| change | `frame change framename` | Switch to a different frame |
| copy | `frame copy source dest` | Copy a frame |
| drop | `frame drop framename [framename ...]` | Delete one or more frames |
| rename | `frame rename oldname newname` | Rename a frame |
| put | `frame put varlist [if] [in], into(framename)` | Copy variables to a frame |
| post | `frame post framename (exp) (exp) ...` | Post results to a frame |
| dir | `frame dir` | List all frames |
| reset | `frame reset` | Reset all frames |

### Hover Content Structure

For subcommands, the hover content should include:
- The full command name (e.g., "frame create")
- Syntax
- Brief description
- Link to Stata documentation

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Frame Command Lookup Returns Frame, Not Framework

*For any* lookup of the string "frame" in the command database, the result SHALL be the `frame` prefix command, NOT the `framework` command.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Prefix Subcommand Hover Returns Subcommand-Specific Info

*For any* subcommand that follows a prefix command with subcommands (e.g., `frame create`, `mi estimate`), hovering over the subcommand SHALL return information specific to that prefix-subcommand combination, NOT information for a standalone command of the same name.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2**

### Property 3: Parser Produces Correct AST for Frame Commands

*For any* valid frame command syntax (`frame name { ... }` or `frame subcommand args`), the parser SHALL produce the correct AST node type (frame block node or command node with frame handling).

**Validates: Requirements 4.1, 4.2**

### Property 4: Existing Prefix Commands Continue to Work

*For any* existing prefix command (`by`, `quietly`, `capture`, `noisily`, etc.), the parser and hover provider SHALL continue to function correctly without regression.

**Validates: Requirements 4.3**

## Error Handling

### Invalid Frame Subcommands

When a word follows `frame` that is not a recognized subcommand:
- The hover provider should fall back to showing frame prefix command info
- No error should be raised; the LSP should gracefully handle unknown subcommands

### Missing Frame Name

When `frame` is followed by a brace without a frame name:
- The parser should handle this as a syntax error
- Existing error handling should apply

### Cache Loading Failures

If the command database cache fails to load:
- The builtin-commands.ts fallback should provide frame command info
- The LSP should continue to function with reduced functionality

## Testing Strategy

### Dual Testing Approach

- **Unit tests**: Verify specific examples and edge cases
- **Property tests**: Verify universal properties across all inputs

### Unit Tests

1. **Command Database Tests**
   - Verify `frame` lookup returns frame command, not framework
   - Verify frame command has expected subcommands as subcommands metadata
   - Verify `framework` is still accessible via its own lookup

2. **Hover Provider Tests**
   - Verify hover over `frame` in `frame create myframe` returns frame info
   - Verify hover over `create` in `frame create myframe` returns frame create info
   - Verify hover over `create` standalone returns create command info (not frame create)

3. **Parser Tests**
   - Verify `frame myframe { ... }` produces frame block node
   - Verify `frame create myframe` produces command node

### Property-Based Tests

**Test Configuration:**
- Framework: fast-check (already used in the project)
- Minimum iterations: 100 per property
- Tag format: **Feature: frame-prefix-command, Property N: {property_text}**

**Property Test 1: Frame Command Lookup**
```typescript
// Feature: frame-prefix-command, Property 1: Frame Command Lookup Returns Frame, Not Framework
fc.assert(fc.property(
    fc.constant('frame'),
    (input) => {
        const result = command_db.lookup(input);
        return result !== undefined && 
               result.name === 'frame' && 
               result.name !== 'framework';
    }
));
```

**Property Test 2: Frame Subcommand Hover**
```typescript
// Feature: frame-prefix-command, Property 2: Frame Subcommand Hover Returns Subcommand-Specific Info
const subcommands = ['create', 'change', 'copy', 'drop', 'rename', 'put', 'post', 'dir', 'reset'];
fc.assert(fc.property(
    fc.constantFrom(...subcommands),
    fc.string().filter(s => /^[a-z][a-z0-9_]*$/.test(s)),
    (subcommand, framename) => {
        const document = `frame ${subcommand} ${framename}`;
        const hover = get_hover_at_position(document, { line: 0, character: 6 + subcommand.length / 2 });
        // Hover should mention "frame" and the subcommand, not standalone command
        return hover !== null && 
               hover.value.includes('frame') && 
               !hover.value.includes('See Stata documentation: `help create`');
    }
));
```

**Property Test 3: Parser AST Correctness**
```typescript
// Feature: frame-prefix-command, Property 3: Parser Produces Correct AST for Frame Commands
fc.assert(fc.property(
    fc.string().filter(s => /^[a-z][a-z0-9_]*$/.test(s)),
    (framename) => {
        const document = `frame ${framename} {\n    display "test"\n}`;
        const { nodes } = parse_document(document);
        return nodes.some(n => n.type === 'frame');
    }
));
```

**Property Test 4: Existing Prefix Commands**
```typescript
// Feature: frame-prefix-command, Property 4: Existing Prefix Commands Continue to Work
const existing_prefixes = ['by', 'quietly', 'capture', 'noisily', 'qui', 'cap', 'noi'];
fc.assert(fc.property(
    fc.constantFrom(...existing_prefixes),
    fc.constantFrom('summarize', 'regress', 'display'),
    (prefix, command) => {
        const document = `${prefix}: ${command} var1`;
        const { errors } = parse_document(document);
        return errors.length === 0;
    }
));
```

