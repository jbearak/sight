# Implementation Tasks

## Task 1: Add Missing Command Highlighting

- [x] Add file execution commands (`do`, `run`, `include`) with scope `keyword.control.flow.stata`
- [x] Add data manipulation commands (`gen`, `generate`, `egen`, `use`, `save`, `saveold`) with scope `keyword.functions.data.stata`
- [x] Add output commands (`display`, `di`, `list`, `li`, `l`) with scope `keyword.other.command.stata`
- [x] Add tabulation commands (`tab`, `tabulate`, `tab1`, `tab2`) with scope `keyword.other.command.stata`
- [x] Add variable expansion commands (`unab`, `unabbrev`) with scope `keyword.other.command.stata`
- [x] Add macro commands (`local`, `global`, `tempvar`, `tempname`, `tempfile`) with scope `keyword.macro.stata`

## Task 2: Add Storage Type Highlighting

- [x] Add numeric types (`byte`, `int`, `long`, `float`, `double`) with scope `support.type.stata`
- [x] Add string types (`str1`-`str2045`, `strL`) with scope `support.type.stata`
- [x] Verify boundary cases (str2045 valid, str2046 invalid)

## Task 3: Add Missing Value Highlighting

- [x] Add system missing (`.`) with scope `constant.language.missing.stata`
- [x] Add extended missing (`.a`-`.z`) with scope `constant.language.missing.stata`
- [x] Ensure decimal numbers (e.g., `3.14`) are NOT matched as missing values

## Task 4: Add Built-in Variable Highlighting

- [x] Add system variables (`_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`) with scope `variable.language.stata`

## Task 5: Add Operator Highlighting

- [x] Add arithmetic operators (`+`, `-`, `*`, `/`, `^`) with scope `keyword.operator.arithmetic.stata`
- [x] Add comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`) with scope `keyword.operator.comparison.stata`
- [x] Add logical operators (`&`, `|`, `!`, `~`) with scope `keyword.operator.logical.stata`
- [x] Add assignment operator (`=`) with scope `keyword.operator.assignment.stata`
- [x] Ensure `*` at line start is still recognized as comment, not operator

## Task 6: Implement Nested Depth Highlighting

- [x] Create depth 1-6 patterns for compound strings (`string.quoted.compound.depth[1-6].stata`)
- [x] Create depth 1-6 patterns for local macros (`variable.other.macro.local.depth[1-6].stata`)
- [x] Implement cycling behavior (depth 7 → depth 1)
- [x] Update existing string patterns to use depth-aware versions

## Task 7: Add Add-on Command Highlighting

- [x] Add regression add-ons (`reghdfe`, `ivreghdfe`, `ivreg2`) with scope `keyword.other.command.addon.stata`
- [x] Add output add-ons (`outreg`, `estout`, `esttab`, `estadd`, `estpost`) with scope `keyword.other.command.addon.stata`
- [x] Add data manipulation add-ons (`gcollapse`, `gcontract`, `gegen`, `gisid`, `glevelsof`, `gquantiles`) with scope `keyword.other.command.addon.stata`
- [x] Add corresponding entries to command database cache

## Task 8: Add Mata Block Highlighting

- [x] Create Mata block detection pattern (`mata:` to `end`)
- [x] Add Mata keywords (`version`, `pragma`, `if`, `else`, `for`, `while`, `do`, `break`, `continue`, `goto`, `return`)
- [x] Add Mata types (`transmorphic`, `string`, `numeric`, `real`, `complex`, `pointer`, `matrix`, `vector`, `rowvector`, `colvector`, `scalar`)
- [x] Ensure Stata commands are NOT highlighted inside Mata blocks

## Task 9: Add Macro Extended Function Highlighting

- [x] Add macro extended functions (`: type`, `: format`, `: word count`, etc.) with scope `keyword.macro.extendedfcn.stata`

## Task 10: Add Program Definition Highlighting

- [x] Highlight `program` keyword as `storage.type.function.stata`
- [x] Highlight program name as `entity.name.function.stata`
- [x] Handle `program define`, `program drop`, `program list` variants

## Task 11: Update README Documentation

- [x] Add "Syntax Highlighting" section to README
- [x] Document all scope categories with examples
- [x] Document nesting depth feature
- [x] Document theme customization options

## Task 12: Create Test Cases

- [x] Update test for command highlighting (grammar-database-sync.test.ts)
- [x] Update test for grammar pattern order (textmate-grammar-star-comments.test.ts)
- [ ] Create test file for nesting depth (1-7 levels) - manual verification
- [ ] Create test file for missing values vs decimals - manual verification
- [ ] Create test file for storage types - manual verification
- [ ] Create test file for operators in various contexts - manual verification
- [ ] Create test file for Mata blocks - manual verification

## Task 13: Verify and Validate

- [x] Run grammar tests (2011 pass)
- [x] TypeScript compiles without errors
- [ ] Manual verification in VS Code
- [x] Cross-reference add-on commands with command database
- [ ] Performance testing with large Stata files

## Task 14: Disable Auto-Sync

- [x] Remove auto-sync from generate-cache.ts
- [x] Update AGENTS.md to document grammar is manually maintained
- [x] Add note that sync-grammar.ts was deleted
