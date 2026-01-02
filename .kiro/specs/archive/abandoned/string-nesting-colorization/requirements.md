# Requirements Document

## Introduction

This document specifies requirements for enabling visual differentiation of nested string and macro depths in the Stata syntax highlighting, and fixing a Mata block detection issue. The TextMate grammar already assigns depth-based scope names (e.g., `string.quoted.compound.depth1.stata`), but VS Code themes don't automatically colorize these custom scopes differently. Additionally, the Mata block pattern incorrectly treats inline Mata statements (e.g., `mata: expression`) as starting a multi-line block that waits for `end`, causing subsequent Stata code to be incorrectly highlighted as Mata.

Note: VS Code does not support `editor.tokenColorCustomizations` in extension `configurationDefaults`. The extension must programmatically add these settings to user configuration on activation.

## Glossary

- **Token_Color_Customization**: VS Code's mechanism for overriding theme colors for specific TextMate scopes via user settings
- **Programmatic_Settings_Configuration**: Using the VS Code API to read and write user settings from extension code
- **Nesting_Depth**: The level of recursion when strings or macros contain other strings or macros (1-6, cycling)
- **Compound_String**: A Stata string delimited by backtick-double-quote and double-quote-apostrophe (`` `" "' ``)
- **Local_Macro**: A Stata macro referenced with backtick-apostrophe syntax (`` `name' ``)
- **Depth_Scope**: A TextMate scope name that includes depth information (e.g., `string.quoted.compound.depth2.stata`)
- **Mata_Block**: A multi-line block of Mata code starting with `mata` or `mata:` alone on a line and ending with `end` on its own line
- **Inline_Mata**: A single-line Mata statement like `mata: expression` or `mata expression` that does not require an `end` keyword
- **Theme_Selector**: A pattern like `[*Dark*]` or `[*Light*]` that targets specific theme types in token color customizations

## Requirements

### Requirement 1: Default Color Differentiation for Nested Strings

**User Story:** As a Stata developer, I want nested compound strings to display in different colors based on their nesting depth, so that I can visually parse complex string expressions.

#### Acceptance Criteria

1. WHEN a compound string at depth 1 is displayed THEN THE Extension SHALL apply a distinct color for `string.quoted.compound.depth1.stata`
2. WHEN a compound string at depth 2 is displayed THEN THE Extension SHALL apply a different color than depth 1 for `string.quoted.compound.depth2.stata`
3. WHEN a compound string at depth 3 is displayed THEN THE Extension SHALL apply a different color than depths 1-2 for `string.quoted.compound.depth3.stata`
4. THE Extension SHALL provide distinct colors for all six depth levels of compound strings
5. THE color scheme SHALL use a progression that makes nesting visually apparent (e.g., varying hues or saturation)
6. THE Extension SHALL provide separate color palettes optimized for dark themes and light themes

Note: VS Code's native bracket pair colorization only colorizes bracket characters, not content between them. Additionally, bracket colorization is disabled inside strings by default. Therefore, the TextMate grammar approach with `editor.tokenColorCustomizations` is the correct solution for colorizing nested string content.

### Requirement 2: Default Color Differentiation for Nested Macros

**User Story:** As a Stata developer, I want nested local macros to display in different colors based on their nesting depth, so that I can visually parse complex macro expressions.

#### Acceptance Criteria

1. WHEN a local macro at depth 1 is displayed THEN THE Extension SHALL apply a distinct color for `variable.other.macro.local.depth1.stata`
2. WHEN a local macro at depth 2 is displayed THEN THE Extension SHALL apply a different color than depth 1 for `variable.other.macro.local.depth2.stata`
3. WHEN a local macro at depth 3 is displayed THEN THE Extension SHALL apply a different color than depths 1-2 for `variable.other.macro.local.depth3.stata`
4. THE Extension SHALL provide distinct colors for all six depth levels of local macros
5. THE macro color scheme SHALL be visually distinct from the string color scheme
6. THE Extension SHALL provide separate macro color palettes optimized for dark themes and light themes

### Requirement 3: Automatic Settings Configuration

**User Story:** As a Stata developer, I want the nesting colors to work automatically when I install the extension, so that I don't have to manually configure settings.

#### Acceptance Criteria

1. WHEN the extension is activated for the first time THEN THE Extension SHALL check if depth color settings exist in user configuration
2. IF depth color settings do not exist THEN THE Extension SHALL programmatically add them to user settings using the VS Code API
3. THE Extension SHALL add color rules for dark themes using the `[*Dark*]` theme selector
4. THE Extension SHALL add color rules for light themes using the `[*Light*]` theme selector
5. THE Extension SHALL track whether settings have been configured to avoid overwriting user customizations on subsequent activations
6. WHEN a user has manually configured depth color settings THEN THE Extension SHALL NOT overwrite them
7. THE Extension SHALL use `vscode.workspace.getConfiguration()` and `configuration.update()` APIs for settings management

### Requirement 4: Theme Compatibility

**User Story:** As a Stata developer using various VS Code themes, I want the nesting colors to work with my chosen theme, so that I don't have to switch themes to see nesting differentiation.

#### Acceptance Criteria

1. THE Extension SHALL provide dark theme colors optimized for dark backgrounds (higher brightness, appropriate contrast)
2. THE Extension SHALL provide light theme colors optimized for light backgrounds (lower brightness, appropriate contrast)
3. WHEN a user switches between dark and light themes THEN THE appropriate color palette SHALL be applied automatically by VS Code
4. WHEN a user has custom `editor.tokenColorCustomizations` for Stata scopes THEN THE user's customizations SHALL take precedence over the extension defaults
5. THE Extension SHALL document how users can customize the nesting colors in the README
6. THE README SHALL include example configurations showing how to match nesting colors to the user's bracket pair colorization colors

### Requirement 5: Visual Clarity

**User Story:** As a Stata developer, I want the nesting colors to be clearly distinguishable, so that I can quickly identify nesting levels at a glance.

#### Acceptance Criteria

1. THE color progression for strings SHALL use colors that are easily distinguishable from each other
2. THE color progression for macros SHALL use colors that are easily distinguishable from each other
3. THE colors SHALL maintain sufficient contrast for readability against both dark and light backgrounds
4. THE colors SHALL follow a logical progression (e.g., warm to cool, or varying saturation)


### Requirement 6: Mata Block Detection Fix

**User Story:** As a Stata developer, I want Mata blocks to be correctly detected, so that Stata commands outside Mata blocks are properly highlighted.

#### Acceptance Criteria

1. WHEN `mata` (with or without colon) appears followed by code on the same line (inline Mata) THEN THE TextMate_Grammar SHALL highlight only that line as Mata and NOT wait for an `end` keyword
2. WHEN `mata` (with or without colon) appears at the end of a line (or followed only by whitespace) THEN THE TextMate_Grammar SHALL begin a multi-line Mata block that ends with `end`
3. WHEN `end` appears on its own line after a multi-line Mata block start THEN THE TextMate_Grammar SHALL end Mata block highlighting
4. WHEN Stata commands like `di`, `display`, `gen`, etc. appear after an inline Mata statement THEN THE TextMate_Grammar SHALL highlight them as Stata commands (not Mata)
5. THE inline Mata pattern SHALL take precedence over the multi-line Mata block pattern
