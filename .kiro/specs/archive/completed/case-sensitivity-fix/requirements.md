# Case Sensitivity Fix Requirements

## Problem Statement

The Stata LSP was incorrectly treating Stata as case-insensitive in many places. However, Stata is **fully case-sensitive**:

- Commands: `display` works, `Display` is "unrecognized"
- Keywords: `if`, `in`, `foreach`, `end`, `mata`, `python` are lowercase only
- Variable names: `myVar` ≠ `myvar`
- Macro names: `myMacro` ≠ `mymacro`
- Program names: `MyProgram` ≠ `myprogram`

This caused bugs like `egen iF = sum(A)` being misparsed because `iF` was incorrectly matched as the `if` keyword.

## Requirements

### R1: Parser Case Sensitivity
- R1.1: `checkWord()` must use exact string comparison, not case-insensitive
- R1.2: Prefix command detection (`by`, `quietly`, `capture`, etc.) must be case-sensitive
- R1.3: Special command handling (`unab`, `args`) must be case-sensitive

### R2: Lexer Case Sensitivity
- R2.1: Embedded language delimiters (`mata`, `python`, `end`) must be case-sensitive
- R2.2: Token classification must preserve original case

### R3: Analyzer Case Sensitivity
- R3.1: Program names must be stored with original case (not lowercased)
- R3.2: Command name matching for variable extraction (`gen`, `egen`, etc.) must be case-sensitive
- R3.3: Forward call detection (`do`, `run`, `include`) must be case-sensitive

### R4: Context Tracker Case Sensitivity
- R4.1: Block detection (`mata`, `python`, `end`, `program`) must be case-sensitive
- R4.2: Malformed command detection must be case-sensitive

### R5: Indexer Case Sensitivity
- R5.1: Program symbol storage must use original case
- R5.2: Program resolution must use exact case matching

### R6: File Path Utilities
- R6.1: `isFileCommand()` must be case-sensitive for command names
- R6.2: File extension checking can remain case-insensitive (filesystem behavior)
- R6.3: LSP directive checking can remain case-insensitive (our convention)

## Out of Scope (Acceptable Case-Insensitivity)

These can remain case-insensitive:
- File extensions (`.do`, `.DO` - filesystem dependent)
- LSP directives (`@lsp-done-by` - our convention, not Stata)
- SMCL directives (Stata's markup language has its own rules)
- Command database lookups (for completion/hover - user convenience)
- Option name duplicate detection (internal tracking)

## Test Updates Required

Tests that explicitly tested case-insensitive behavior need updating:
- `tests/unit/analyzer.test.ts` - program extraction test
- `tests/unit/context-tracker.test.ts` - mata/python block detection
- `tests/property/workspace-c-local-suppression.prop.test.ts` - program lookup
- `tests/property/declaration-directive-symbol-registration.prop.test.ts` - program registration
- `tests/property/command-path-completion.prop.test.ts` - file command detection
