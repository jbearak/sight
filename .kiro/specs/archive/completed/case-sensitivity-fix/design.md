# Case Sensitivity Fix Design

## Overview

This document describes the changes needed to make the Stata LSP correctly handle Stata's case-sensitive nature.

## Files Requiring Changes

### Already Fixed

1. **src/parser/index.ts**
   - `checkWord()` - Changed from `toLowerCase()` comparison to exact match
   - `isPrefixCommand()` - Changed from `toLowerCase()` to exact match
   - `unab`/`args` command detection - Changed to exact match

2. **src/lexer/index.ts**
   - `is_mata_start_delimiter()` - Changed to exact match
   - `is_mata_inline_delimiter()` - Changed to exact match
   - `is_python_start_delimiter()` - Changed to exact match
   - `is_python_inline_delimiter()` - Changed to exact match
   - `is_end_delimiter()` - Changed to exact match

3. **src/analyzer/index.ts**
   - Program name storage - Changed to use original case
   - `extract_c_locals()` - Changed `c_local` detection to exact match
   - `detect_forward_call()` - Changed `do`/`run`/`include` detection to exact match
   - `process_command()` - Changed command name matching to exact match
   - `extract_matrix_symbol()` - Changed `define` detection to exact match
   - Variable-creating command skip logic - Changed to exact match

4. **src/context-tracker/index.ts**
   - `end` command detection - Changed to exact match
   - `end python`/`end mata` detection - Changed to exact match
   - `is_program_block_start()` - Changed to exact match
   - `find_program_block_end_lines()` - Changed to exact match
   - `detect_language_block()` - Changed all `mata`/`python`/`end` checks to exact match
   - `find_matching_end()` - Changed to exact match

5. **src/indexer/index.ts**
   - Program symbol storage - Changed to use original case
   - `find_symbol_definitions()` - Changed to use original case
   - `resolve_program()` - Changed to use original case

6. **src/utils/file-path-utils.ts**
   - `isFileCommand()` - Changed to exact match

### Tests Updated

1. **tests/unit/analyzer.test.ts**
   - Changed "case-insensitive" test to "case-sensitive"

2. **tests/unit/context-tracker.test.ts**
   - Changed "case insensitivity" describe block to "case sensitivity"
   - Updated tests to verify uppercase `MATA`/`PYTHON` are NOT detected

3. **tests/property/workspace-c-local-suppression.prop.test.ts**
   - Changed test to use matching case for program lookup

4. **tests/property/declaration-directive-symbol-registration.prop.test.ts**
   - Changed program registration tests to use original case

5. **tests/property/command-path-completion.prop.test.ts**
   - Changed to test lowercase-only detection
   - Added test verifying uppercase commands are NOT detected

## Files Still Needing Review

The following files have `toLowerCase()` calls that may need review:

### src/parser/index.ts (remaining)
- Line ~570: `function_names.has(name.toLowerCase())` - Extended macro function names
- Line ~1090: Option name duplicate detection - Can stay case-insensitive (internal)
- Line ~1169: `exp` keyword in syntax parsing
- Line ~1204: Argument type parsing (`anything`, `real`, etc.)
- Line ~1316: Type token parsing
- Line ~1334: `default` keyword detection
- Line ~1581: `in`/`of` keywords in foreach
- Line ~2017: `if`/`in` qualifier detection in expression parsing
- Line ~2082: `in` keyword in expression parsing
- Line ~2299: `else` keyword detection

### src/pretty-printer/index.ts
- Line ~209: `by` prefix detection for colon - Should be case-sensitive

### src/command-database/index.ts
- Command lookups - Can stay case-insensitive for user convenience (completion/hover)

### src/directive-parser/index.ts
- Line ~45: Parameter detection (`line=`, `match=`) - Can stay case-insensitive (our convention)
- Line ~557-576: Filename comparison - Can stay case-insensitive (filesystem)

### src/smcl-parser/*.ts
- SMCL directive handling - Can stay case-insensitive (SMCL's own rules)

## Implementation Strategy

1. Fix critical path first (parser, lexer, analyzer) - DONE
2. Fix context tracker - DONE
3. Fix indexer - DONE
4. Update tests - DONE
5. Review remaining files for any missed cases
6. Update AGENTS.md to document case sensitivity

## Verification

Run full test suite: `bun test`

All tests should pass after changes. The 7 tests that were explicitly testing case-insensitive behavior have been updated to test case-sensitive behavior instead.
