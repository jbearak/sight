---
Last Updated: 2026-01-01
Status: Active
Dependencies:
  - command-database-integration: [Core dependency]
Related Specs:
  - frame-prefix-command: [Related - triggered by this bug]
  - smcl-syntax-cleanup: [Related - SMCL extractor]
---

# Requirements Document

## Introduction

The SMCL extractor incorrectly extracts subcommands as standalone commands. When a help file documents a subcommand like `estat framework`, the extractor picks up `{cmdab:fra:mework}` and treats it as a standalone command "framework" with min_abbreviation=3.

### Root Cause

In `sem_estat_framework.sthlp`, the syntax line is:
```
{cmd:estat} {cmdab:fra:mework} [{cmd:,} {it:options}]
```

The `extract_cmdab_patterns()` function extracts `{cmdab:fra:mework}` without checking if it follows a prefix command like `{cmd:estat}`, `{cmd:mi}`, etc.

### Current Workaround

The bogus "framework" command was added to `NON_COMMAND_TOKENS` as a blocklist fix. This works but doesn't address the root cause - other subcommands may have the same problem.

## Glossary

- **Prefix_Command**: A Stata command that takes a subcommand (e.g., `estat`, `mi`, `frame`, `graph`)
- **Subcommand**: A command that follows a prefix command (e.g., `framework` in `estat framework`)
- **SMCL_Extractor**: The module that parses Stata help files to extract command metadata
- **cmdab_pattern**: SMCL tag `{cmdab:abbrev:rest}` indicating a command with abbreviation

## Requirements

### Requirement 1: Detect Subcommand Context

**User Story:** As a cache generator, I want the extractor to recognize when a `{cmdab:...}` pattern is a subcommand, so that subcommands are not extracted as standalone commands.

#### Acceptance Criteria

1. WHEN a `{cmdab:...}` pattern appears immediately after `{cmd:PREFIX}` where PREFIX is a known prefix command, THEN the SMCL_Extractor SHALL skip extraction of that pattern as a standalone command
2. THE SMCL_Extractor SHALL recognize these Prefix_Commands: `estat`, `mi`, `graph`, `sts`, `stcox`, `streg`, `me`, `sem`, `gsem`, `bayes`, `bayesmh`, `collect`, `dtable`, `etable`, `table`
3. WHEN a `{cmdab:...}` pattern appears at the start of a syntax line without a preceding Prefix_Command, THEN the SMCL_Extractor SHALL extract it as a standalone command

### Requirement 2: Remove Blocklist Entry

**User Story:** As a maintainer, I want to remove the "framework" blocklist entry once the root cause is fixed, so that the fix is structural rather than a workaround.

#### Acceptance Criteria

1. AFTER the subcommand detection is implemented, THE SMCL_Extractor SHALL remove "framework" from NON_COMMAND_TOKENS
2. WHEN processing sem_estat_framework.sthlp, THE cache generator SHALL NOT produce a "framework" command entry
3. THE test suite SHALL verify that "framework" is not extracted from sem_estat_framework.sthlp

### Requirement 3: Preserve Legitimate Commands

**User Story:** As a user, I want legitimate commands to still be extracted correctly, so that the fix doesn't break existing functionality.

#### Acceptance Criteria

1. WHEN a command name matches a subcommand name but appears as a standalone command in a different help file, THEN the SMCL_Extractor SHALL extract it as a standalone command
2. THE SMCL_Extractor SHALL continue to extract all commands from the current cache minus known false positives
3. THE monotonicity test SHALL verify the cache command count does not decrease unexpectedly after the fix
