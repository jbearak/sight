# Design Document: Option Name Expansion

## Overview

This feature extends the parser to expand abbreviated option names to their canonical forms using command-specific option dictionaries. Unlike command expansion (which is global), option expansion requires knowing which command the option belongs to.

The infrastructure exists:
- `OptionInfo` has `minAbbreviation` field
- `CommandInfo` has `options` array
- `OptionNode` has `fullName` field with TODO comment

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│ CommandDatabase │────▶│     Parser       │
│                 │     │                  │
│ lookup(cmd)     │     │ 1. parse command │
│   .options[]    │     │ 2. lookup cmd    │
│                 │     │ 3. expand opts   │
└─────────────────┘     └──────────────────┘
```

The parser:
1. Parses command name and expands it (from command-name-expansion feature)
2. Looks up the command in the database to get its valid options
3. For each option token, expands using that command's option list
4. Falls back to common options if command unknown

## Components and Interfaces

### CommandDatabase Extension

Add method to expand option abbreviations:

```typescript
export class CommandDatabase {
  // ... existing methods ...

  /**
   * Expand an option abbreviation for a specific command.
   * @param command_name - The canonical command name
   * @param option_abbrev - The option abbreviation to expand
   * @returns The canonical option name, or original if not found
   */
  expand_option(command_name: string, option_abbrev: string): string {
    const cmd = this.lookup(command_name);
    if (!cmd) {
      return this.expand_common_option(option_abbrev);
    }

    const normalized = option_abbrev.toLowerCase();
    for (const opt of cmd.options) {
      const opt_name = opt.name.toLowerCase();
      const min_abbrev = opt.minAbbreviation.toLowerCase();
      
      // Check if abbrev is valid: at least minAbbrev length and prefix of name
      if (normalized.length >= min_abbrev.length && 
          opt_name.startsWith(normalized)) {
        return opt.name;
      }
    }

    // Fall back to common options
    return this.expand_common_option(option_abbrev);
  }

  /**
   * Expand common options that apply to many commands.
   */
  private expand_common_option(option_abbrev: string): string {
    const common_options: Record<string, string> = {
      'rob': 'robust',
      'nocons': 'noconstant',
      'noc': 'noconstant',
      'det': 'detail',
      'd': 'detail',
      'l': 'level',
      // Add more as needed
    };
    return common_options[option_abbrev.toLowerCase()] ?? option_abbrev;
  }
}
```

### Parser Changes

Update option parsing to use expansion:

```typescript
// In parseCommand(), after parsing options:
private parseOptions(command_full_name: string): OptionNode[] {
  const options: OptionNode[] = [];
  
  while (this.check('COMMA')) {
    this.advance(); // consume comma
    
    if (!this.check('WORD')) break;
    
    const optionToken = this.advance();
    const optionName = optionToken.value;
    const fullName = this.command_db.expand_option(
      command_full_name, 
      optionName
    );
    
    const option: OptionNode = {
      type: 'option',
      name: optionName,      // original: "rob"
      fullName: fullName,    // expanded: "robust"
      range: optionToken.range,
    };
    
    // Parse option argument if present
    if (this.check('LPAREN')) {
      option.argument = this.parseOptionArgument();
    }
    
    options.push(option);
  }
  
  return options;
}
```

## Data Models

No changes to data models. `OptionNode` already has `name` and `fullName` fields.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Command-Specific Option Expansion

*For any* option on a known command, if the option is a valid abbreviation of one of that command's options, the parser SHALL set `fullName` to the canonical option name.

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**

### Property 2: Common Option Fallback

*For any* option on an unknown command, the parser SHALL expand common options (robust, detail, level, etc.) using the common option dictionary.

**Validates: Requirements 2.3, 2.4**

### Property 3: Unknown Options Unchanged

*For any* option not in the command's option list or common options, the parser SHALL set `fullName` equal to `name`.

**Validates: Requirements 5.5**

### Property 4: Round-trip Preservation

*For any* command with options, parsing then pretty-printing SHALL produce source text identical to the original input.

**Validates: Requirements 3.2, 3.4**

## Error Handling

| Condition | Handling |
|-----------|----------|
| Unknown command | Use common options only |
| Unknown option | Use original text as fullName |
| Ambiguous option | Use first match (most common) |

## Testing Strategy

### Property-Based Tests (fast-check)

1. **Command-specific expansion**: Generate commands with known options, verify expansion uses command's option list.

2. **Common option fallback**: Generate unknown commands with common options, verify expansion works.

3. **Unknown option property**: Generate unknown option names, verify fullName equals name.

4. **Round-trip property**: Generate commands with options, verify parse→print identity.

### Unit Tests

- `regress y x, rob` → option fullName = `robust`
- `summarize x, d` → option fullName = `detail`
- `regress y x, nocons` → option fullName = `noconstant`
- `mycommand, rob` → option fullName = `robust` (common option)
- `regress y x, foo` → option fullName = `foo` (unknown)
