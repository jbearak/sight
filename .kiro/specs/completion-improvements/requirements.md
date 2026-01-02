---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Requirements superseded by completion-improvements-fixes due to incompatible changes
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - extended-macro-functions: [Core dependency]
Status: Superseded
Superseded By: completion-improvements-fixes
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

**⚠️ REQUIREMENTS SUPERSEDED**

The requirements in this specification have been superseded by incompatible changes implemented in completion-improvements-fixes. The implementation evolved beyond these original requirements.

**Original requirements below are preserved for historical reference only.**

## Introduction

This document specifies requirements for improving the auto-completion behavior in the Stata LSP. The current implementation has three issues: (1) duplicate commands in suggestions, (2) incorrect/truncated descriptions in the command cache, and (3) overly aggressive completion triggering that interferes with normal editing (e.g., pressing Enter to create new lines).

## Glossary

- **Completion_Provider**: The component that generates auto-complete suggestions based on cursor context
- **Command_Database**: The cache of Stata commands, options, and their metadata loaded from JSON files
- **Trigger_Character**: A character that, when typed, causes the LSP to request completions from the server
- **Command_Context**: The state where the cursor is at the start of a statement, expecting a command name
- **Option_Context**: The state where the cursor is after a comma in a command, expecting option names

## Requirements

### Requirement 1: Remove Duplicate Commands from Completions

**User Story:** As a developer, I want to see each command only once in the completion list, so that I can quickly find and select the command I need without confusion.

#### Acceptance Criteria

1. WHEN the Completion_Provider generates command completions, THE Completion_Provider SHALL include each command name at most once
2. WHEN a command has an abbreviation different from its full name, THE Completion_Provider SHALL NOT add a separate completion item for the abbreviation
3. WHEN the Command_Database contains duplicate entries for the same command, THE Command_Database SHALL deduplicate them during loading

### Requirement 2: Remove Descriptions from Command Cache

**User Story:** As a developer, I want command completions to show only the command name and syntax, so that the completion list is clean and the descriptions (which are currently incorrect/truncated) don't cause confusion.

#### Acceptance Criteria

1. THE Command_Database cache format SHALL NOT include description fields for commands
2. THE Command_Database cache format SHALL NOT include description fields for options
3. WHEN generating command completions, THE Completion_Provider SHALL NOT display descriptions in the detail field
4. WHEN generating option completions, THE Completion_Provider SHALL NOT display descriptions in the detail field
5. THE Command_Database SHALL retain command name, syntax, minimum abbreviation, and option names with their minimum abbreviations

### Requirement 3: Reduce Completion Trigger Aggressiveness

**User Story:** As a developer, I want auto-completion to only appear when I'm actively typing a command or identifier, so that I can use Enter to create new lines and Space to separate words without triggering unwanted completions.

#### Acceptance Criteria

1. WHEN the cursor is on an empty line with no characters typed, THE Completion_Provider SHALL return an empty completion list
2. WHEN the cursor is at the start of a line with only whitespace before it and no word prefix, THE Completion_Provider SHALL return an empty completion list
3. WHEN the user types a space character, THE Completion_Provider SHALL NOT trigger completions (handled by not including space in triggerCharacters)
4. WHEN the user has typed at least one alphanumeric character of a word, THE Completion_Provider SHALL provide relevant completions
5. WHEN the trigger character is a newline ('\n'), THE Completion_Provider SHALL return an empty completion list
6. THE LSP server SHALL NOT include '\n' (newline) in the triggerCharacters list
7. WHEN the cursor is immediately after a comma with no option name characters typed, THE Completion_Provider SHALL return an empty completion list
8. WHEN the user has typed at least one character after a comma, THE Completion_Provider SHALL provide option completions

**Note:** VS Code automatically triggers completion requests when typing alphanumeric characters. The server must filter these by checking if the user has actually started typing a word (non-empty prefix).

### Requirement 5: Prioritize Common Commands in Completion Order

**User Story:** As a developer, I want the most commonly-used Stata commands to appear first in the completion list, so that I can quickly access the commands I use most often without scrolling.

#### Acceptance Criteria

1. WHEN generating command completions, THE Completion_Provider SHALL rank user-defined programs above built-in commands
2. WHEN generating built-in command completions, THE Completion_Provider SHALL rank commands by priority tier
3. THE Command_Database SHALL categorize commands into priority tiers:
   - Tier 1 (highest): Core data manipulation and programming
     - Data: `generate`, `replace`, `drop`, `keep`, `rename`, `sort`, `order`, `merge`, `append`, `reshape`, `collapse`, `expand`, `contract`, `encode`, `decode`, `destring`, `tostring`, `egen`, `recode`, `label`, `notes`
     - Programming: `local`, `global`, `scalar`, `matrix`, `display`, `capture`, `quietly`, `noisily`, `return`, `program`, `end`, `if`, `else`, `foreach`, `forvalues`, `while`, `continue`, `break`, `exit`, `error`, `assert`, `confirm`, `do`, `run`, `include`, `unab`
     - Analysis: `summarize`, `describe`, `list`, `tabulate`, `table`, `count`, `codebook`, `inspect`, `compare`
     - I/O: `use`, `save`, `clear`, `set`, `sysuse`, `webuse`, `input`, `edit`, `browse`
   - Tier 2: Common estimation, graphics, and extended I/O
     - Estimation: `regress`, `logit`, `probit`, `logistic`, `ologit`, `oprobit`, `mlogit`, `poisson`, `nbreg`, `tobit`, `ivregress`, `xtreg`, `xtlogit`, `areg`, `rreg`, `qreg`, `xtset`, `tsset`, `predict`, `margins`, `marginsplot`, `test`, `lincom`, `nlcom`, `contrast`, `pwcompare`, `estimates`, `hausman`, `estat`
     - Graphics: `graph`, `twoway`, `scatter`, `line`, `histogram`, `kdensity`, `boxplot`, `bar`, `pie`, `dot`
     - I/O: `import`, `export`, `insheet`, `outsheet`, `infile`, `outfile`, `xmlsave`, `odbc`, `copy`, `type`, `log`, `cmdlog`
     - Data management: `duplicates`, `isid`, `levelsof`, `distinct`, `fillin`, `cross`, `stack`, `xpose`, `separate`
   - Tier 3: All other commands (alphabetical)
4. WITHIN each priority tier, THE Completion_Provider SHALL sort commands alphabetically
5. WHEN the user has typed a prefix, THE Completion_Provider SHALL filter to matching commands while preserving priority ordering

**Rationale:** Unlike Python/TypeScript where scope locality matters, Stata has a flat namespace with a stable set of core commands. Most Stata users frequently use the same fundamental commands for data manipulation, programming, and analysis. Prioritizing these reduces scrolling and improves productivity.

### Requirement 6: Follow LSP Best Practices for Completion Triggering

**User Story:** As a developer, I want the completion behavior to match established language servers like Python (Pylance) and R, so that the editing experience feels familiar and non-intrusive.

#### Acceptance Criteria

1. THE LSP server triggerCharacters SHALL include only: ':', '`', '"', '$' (characters that indicate specific Stata completion contexts)
2. THE LSP server triggerCharacters SHALL NOT include '\n' (newline), ',' (comma), or '.' (period)
3. WHEN completions are requested without a trigger character (user-invoked), THE Completion_Provider SHALL provide completions based on the current word prefix
4. WHEN the current word prefix is empty and no trigger character was used, THE Completion_Provider SHALL return an empty completion list
5. WHEN the trigger character is '$', THE Completion_Provider SHALL provide global macro completions

**Rationale for trigger characters:**
- `:` - Extended macro functions (e.g., `local result : list macA | macB`)
- `` ` `` - Local macro references (e.g., `` `macname' ``)
- `"` - Compound quote snippets (e.g., `` `"string"' ``)
- `$` - Global macro references (e.g., `$macname` or `${macname}`)

**Removed trigger characters:**
- `\n` - Causes completions on Enter key, preventing normal line creation
- `,` - Too aggressive; users should invoke completions manually after comma
- `.` - Not used for Stata-specific completion contexts
