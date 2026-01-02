# Design Document: Command Name Expansion

## Overview

This feature wires the existing `CommandDatabase.expand_abbreviation()` method to the parser, so that abbreviated commands like `reg`, `gen`, `di` are expanded to their canonical forms (`regress`, `generate`, `display`) in the AST's `fullName` field while preserving the original text in `name`.

The infrastructure already exists:
- `CommandDatabase` has `expand_abbreviation()` method
- `builtin-commands.ts` has 100+ commands with `minAbbreviation` fields
- Parser has `fullName` fields with TODO comments

This is primarily a wiring task.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│ CommandDatabase │────▶│     Parser       │
│                 │     │                  │
│ expand_abbrev() │     │ - lookup command │
│                 │     │ - set fullName   │
└─────────────────┘     └──────────────────┘
         │
         │ initialized at startup
         ▼
┌─────────────────┐
│ builtin-commands│
│                 │
│ 100+ commands   │
│ with minAbbrev  │
└─────────────────┘
```

## Components and Interfaces

### Parser Changes

Inject `CommandDatabase` into parser and use it during command parsing:

```typescript
export class StataParser {
  private command_db: CommandDatabase;

  constructor(command_db?: CommandDatabase) {
    this.command_db = command_db ?? create_default_command_database();
  }

  private expand_command_name(name: string): string {
    const matches = this.command_db.expand_abbreviation(name);
    if (matches.length === 1) {
      return matches[0].name;
    }
    // Ambiguous or unknown: return original
    return name;
  }
}
```

Update `parseCommand()` to use expansion:

```typescript
// In parseCommand(), after getting command name:
const command_token = this.advance();
const commandName = command_token.value;
const fullName = this.expand_command_name(commandName);

// ... later in the return:
return {
  type: 'command',
  name: commandName,      // original: "reg"
  fullName: fullName,     // expanded: "regress"
  // ...
};
```

### Prefix Expansion

Update prefix parsing to expand abbreviations:

```typescript
// In prefix parsing:
const prefixToken = this.advance();
const prefix: PrefixNode = {
  type: 'prefix',
  name: prefixToken.value,                           // original: "qui"
  fullName: this.expand_command_name(prefixToken.value), // expanded: "quietly"
  range: prefixToken.range,
};
```

### Command Database Initialization

Create a factory function to initialize the database with builtin commands:

```typescript
// In src/commands/index.ts or new file
export function create_default_command_database(): CommandDatabase {
  const db = new CommandDatabase();
  db.register_all(BUILTIN_COMMANDS);
  return db;
}
```

## Data Models

No changes to data models. The existing `CommandNode`, `PrefixNode`, and `OptionNode` already have `name` and `fullName` fields.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Abbreviation Expansion

*For any* command or prefix that is a valid abbreviation of a known command, the parser SHALL set `fullName` to the canonical command name while preserving the original text in `name`.

**Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1**

### Property 2: Round-trip Preservation

*For any* Stata command (abbreviated or not), parsing then pretty-printing SHALL produce source text identical to the original input.

**Validates: Requirements 3.2, 3.4**

### Property 3: Unknown Commands Unchanged

*For any* command not in the dictionary, the parser SHALL set `fullName` equal to `name` (no expansion).

**Validates: Requirements 5.5**

## Error Handling

| Condition | Handling |
|-----------|----------|
| Ambiguous abbreviation (multiple matches) | Use original text as fullName, log debug message |
| Unknown command | Use original text as fullName |
| No command database provided | Use default database with builtin commands |

## Testing Strategy

### Property-Based Tests (fast-check)

1. **Abbreviation expansion property**: Generate random known abbreviations, verify fullName is canonical.

2. **Round-trip property**: Generate random commands (abbreviated and full), verify parse→print produces identical text.

3. **Unknown command property**: Generate random unknown command names, verify fullName equals name.

### Unit Tests

- `reg` → fullName = `regress`
- `gen` → fullName = `generate`
- `di` → fullName = `display`
- `qui` → fullName = `quietly`
- `cap` → fullName = `capture`
- `qui cap reg` → all three expanded
- `mycommand` (unknown) → fullName = `mycommand`
- `regress` (already canonical) → fullName = `regress`
