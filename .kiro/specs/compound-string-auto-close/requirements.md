# Requirements Document

## Introduction

This feature ensures proper auto-closing behavior for Stata's compound strings in both VS Code and Zed extensions, and documents the grammar revision update process in AGENTS.md. Stata uses compound strings (`` `"..."' ``) which require special handling beyond simple bracket pairs. The current implementation handles local macros (`` ` `` → `` `|' ``) but compound string auto-closing (`` `" `` → `` `"|"' ``) needs verification and potential fixes.

## Glossary

- **Compound_String**: A Stata string literal delimited by `` `" `` (open) and `` "' `` (close), allowing embedded quotes and macros
- **Local_Macro**: A Stata macro reference delimited by `` ` `` (open) and `` ' `` (close)
- **Auto_Close_System**: The component that automatically inserts closing characters when opening characters are typed
- **Skip_Over_Behavior**: When typing a closing character that already exists, the cursor moves past it instead of inserting a duplicate
- **Grammar_Revision**: The SHA commit reference in extension.toml that pins the tree-sitter-stata grammar version
- **VS_Code_Extension**: The Visual Studio Code extension in `client/` directory
- **Zed_Extension**: The Zed editor extension in `zed-extension/` directory

## Requirements

### Requirement 1: Compound String Auto-Close in VS Code

**User Story:** As a Stata developer using VS Code, I want compound strings to auto-close correctly, so that I can write compound string literals efficiently without manually typing the closing sequence.

#### Acceptance Criteria

1. WHEN a user types `` `" `` (backtick followed by double quote) THEN THE Auto_Close_System SHALL produce `` `"|"' `` with the cursor positioned between the quotes
2. WHEN a user types a nested compound string inside an existing compound string THEN THE Auto_Close_System SHALL produce the correct nested closing sequence `` `"`"|"'"' ``
3. WHEN a user types `` "' `` at the end of a compound string THEN THE Auto_Close_System SHALL skip over the existing `` "' `` instead of inserting duplicate characters
4. WHEN a user deletes the opening `` `" `` of a compound string THEN THE Auto_Close_System SHALL delete the corresponding `` "' `` closing sequence

### Requirement 2: Local Macro Auto-Close Preservation

**User Story:** As a Stata developer, I want local macro auto-closing to continue working correctly alongside compound string handling, so that both quoting styles work seamlessly.

#### Acceptance Criteria

1. WHEN a user types a single backtick `` ` `` THEN THE Auto_Close_System SHALL produce `` `|' `` with the cursor between backtick and apostrophe
2. WHEN a user types nested backticks `` `` `` THEN THE Auto_Close_System SHALL produce `` ``|'' `` with proper nested closing
3. WHEN a user types an apostrophe `` ' `` at the end of a local macro THEN THE Auto_Close_System SHALL skip over the existing apostrophe
4. WHEN a user deletes a backtick that has a paired apostrophe THEN THE Auto_Close_System SHALL delete the paired apostrophe

### Requirement 3: Zed Extension Auto-Close Configuration

**User Story:** As a Stata developer using Zed, I want auto-closing to work as well as possible within Zed's bracket pair limitations, so that I have a consistent editing experience.

#### Acceptance Criteria

1. THE Zed_Extension config.toml SHALL include the backtick-apostrophe bracket pair for local macro auto-closing
2. IF Zed's bracket pair system cannot handle compound strings THEN THE Zed_Extension documentation SHALL document this limitation
3. WHEN a user types a backtick in Zed THEN THE Zed_Extension SHALL auto-close with an apostrophe (`` `|' ``)
4. THE Zed_Extension SHALL NOT include bracket pairs that produce incorrect behavior for Stata syntax

### Requirement 4: Grammar Revision Update Documentation

**User Story:** As a developer maintaining the sight repository, I want clear documentation on how to update the tree-sitter-stata grammar revision, so that I can keep the Zed extension aligned with grammar changes.

#### Acceptance Criteria

1. THE AGENTS.md file SHALL include a section titled "Grammar Revision Update Process"
2. THE documentation SHALL explain when to update the grammar revision (after tree-sitter-stata changes)
3. THE documentation SHALL provide step-by-step instructions for updating the SHA in extension.toml
4. THE documentation SHALL describe the testing process after grammar updates
5. THE documentation SHALL explain the relationship between tree-sitter-stata and sight repositories
6. THE documentation SHALL reference the existing "Zed + Tree-sitter Alignment" section for troubleshooting

### Requirement 5: Test Coverage for Compound Strings

**User Story:** As a developer, I want comprehensive tests for compound string auto-closing, so that I can verify the behavior works correctly and catch regressions.

#### Acceptance Criteria

1. THE test suite SHALL include property tests for compound string auto-close behavior
2. THE test suite SHALL include property tests for skip-over behavior with compound string closing sequences
3. THE test suite SHALL include unit tests for edge cases (empty compound strings, nested compound strings)
4. WHEN tests are run THEN all existing quote-auto-close tests SHALL continue to pass
