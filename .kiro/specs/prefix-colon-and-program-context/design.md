# Design Document: Prefix Colon and Program Context Fixes

## Overview

This design addresses three related parser bugs that cause false positive diagnostics:

1. **Prefix Command Colon Syntax**: The parser doesn't recognize `quietly:`, `capture:`, etc. with colons
2. **Context-Aware Statement Keyword Detection**: The parser incorrectly interprets "program" and other keywords as statement starters when they appear as command arguments
3. **Prefix Commands with Statement Keywords**: The parser incorrectly tries to parse `capture program drop` as a program definition

All three bugs stem from the same root cause: the parser's `parseStatement()` method checks for statement keywords (like `program`, `local`, `if`) before considering whether those keywords might be part of a regular command.

## Architecture

The fix involves modifying the parser's statement dispatch logic in `src/parser/index.ts`:

```
┌─────────────────────────────────────────────────────────────────┐
│                      parseStatement()                            │
├─────────────────────────────────────────────────────────────────┤
│  1. Collect leading trivia                                       │
│  2. Check for directives (DELIMIT_DIRECTIVE, MATA_START, etc.)  │
│  3. NEW: Check if first WORD is a prefix command                │
│     - If yes: delegate to parseCommand() which handles prefixes │
│  4. Check for statement keywords (program, local, if, etc.)     │
│     - Only if NOT preceded by prefix command                    │
│  5. Default: parseCommand()                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified: `StataParser.parseStatement()`

Current behavior:
- Checks `checkWord('program')` at statement start
- If true, calls `parseProgramDefinition()`
- This fails when "program" follows a prefix command

New behavior:
- First check if the current token is a prefix command
- If it is, delegate to `parseCommand()` which already handles prefix parsing
- Only check for statement keywords if NOT starting with a prefix command

### Modified: `StataParser.parseCommand()`

Current behavior:
- Handles prefix commands in a loop
- Only consumes colon for `by` prefix
- After prefixes, expects a WORD token for command name

New behavior:
- Consume colon after ANY prefix command (not just `by`)
- Continue to handle the rest of the command normally

### Modified: `StataParser.isPrefixCommand()`

No changes needed - already correctly identifies prefix commands.

## Data Models

No new data models required. The existing `PrefixNode` and `CommandNode` types are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Prefix commands with colons parse without errors

*For any* prefix command (`quietly`, `capture`, `noisily`, `qui`, `cap`, `noi`) followed by a colon and a valid command, parsing SHALL produce no errors and SHALL correctly identify the prefix and command.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Statement keywords after command names are treated as identifiers

*For any* valid Stata command followed by a statement keyword (`program`, `local`, `global`, `if`, `foreach`, `forvalues`, `while`) as an argument, parsing SHALL NOT interpret the keyword as starting a new statement block.

**Validates: Requirements 2.2, 2.5, 2.6**

### Property 3: Prefix commands followed by statement keywords parse as regular commands

*For any* prefix command followed by a statement keyword, parsing SHALL treat the statement keyword as a command name (not as a statement-starting keyword) and SHALL NOT create a block structure.

**Validates: Requirements 3.3, 3.5**

## Error Handling

The changes should reduce false positive errors, not introduce new error conditions. The parser should:

1. Continue to report genuine syntax errors (e.g., `program define` without a name)
2. Stop reporting false positives for:
   - `quietly: command` (was: "Expected command name")
   - `capture program drop name` (was: "Missing end for program definition")
   - `gen program = 1` (was: "Expected define after program")

## Testing Strategy

### Unit Tests

Unit tests should cover specific examples from the requirements:

1. `quietly: display "hello"` - parses without error
2. `capture: gen x = 1` - parses without error
3. `qui: noi: display "test"` - chained prefixes with colons
4. `capture program drop myprogram` - parses as prefixed command
5. `gen program = 1` - parses without error
6. `getmata (program survey level)=matrix` - parses without error

### Property-Based Tests

Property-based tests should use fast-check to generate:

1. Random prefix commands with colons followed by random valid commands
2. Random commands with statement keywords as arguments
3. Random prefix commands followed by statement keywords

Each property test should run minimum 100 iterations and be tagged with the property it validates.

**Test Configuration:**
- Framework: fast-check (already used in the project)
- Minimum iterations: 100 per property
- Tag format: `Feature: prefix-colon-and-program-context, Property N: <property_text>`
