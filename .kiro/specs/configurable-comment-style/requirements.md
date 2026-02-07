# Requirements Document

## Introduction

This feature adds a VS Code setting (`sight.lineCommentStyle`) that allows users to choose between `//` and `*` as the line comment character used by VS Code's built-in toggle comment shortcut. Currently, the line comment style is hardcoded to `//` in the static `language-configuration.json`. While the existing `sight.formatting.preferredCommentStyle` setting controls the LSP formatter's comment normalization, it serves a different purpose and includes `/* */` as a third option. The static `language-configuration.json` file cannot be overridden via user settings; it requires the programmatic `vscode.languages.setLanguageConfiguration()` API to change at runtime. This feature introduces a dedicated `sight.lineCommentStyle` setting and dynamically applies it to the VS Code language configuration so that the toggle comment shortcut uses the user's preferred line comment character.

## Glossary

- **Extension**: The Sight VS Code client extension (`client/src/extension.ts`)
- **Language_Configuration**: The VS Code language configuration for Stata, controlling comment characters, brackets, and indentation rules
- **Line_Comment_Style_Setting**: The VS Code setting `sight.lineCommentStyle` that controls which line comment character VS Code uses for comment toggling
- **Preferred_Comment_Style_Setting**: The existing VS Code setting `sight.formatting.preferredCommentStyle` that controls the LSP formatter's comment normalization
- **Configuration_API**: The `vscode.languages.setLanguageConfiguration()` VS Code API that programmatically overrides language configuration

## Requirements

### Requirement 1: Line Comment Style Setting

**User Story:** As a Stata developer, I want to choose between `//` and `*` as my line comment style, so that VS Code's comment toggling matches my preferred coding style.

#### Acceptance Criteria

1. THE Extension SHALL provide a `sight.lineCommentStyle` setting with allowed values `"//"` and `"*"`
2. THE Line_Comment_Style_Setting SHALL default to `"//"` for backward compatibility
3. WHEN the Extension activates, THE Extension SHALL read the `sight.lineCommentStyle` setting and apply the chosen comment style to the Stata Language_Configuration via the Configuration_API

### Requirement 2: Dynamic Configuration Update

**User Story:** As a Stata developer, I want my comment style preference to take effect immediately when I change the setting, so that I do not need to restart VS Code.

#### Acceptance Criteria

1. WHEN the `sight.lineCommentStyle` setting changes, THE Extension SHALL update the Stata Language_Configuration via the Configuration_API with the new line comment character
2. WHEN the Language_Configuration is updated, THE Extension SHALL preserve all other language configuration properties (brackets, auto-closing pairs, surrounding pairs, indentation rules, word pattern, block comment characters)

### Requirement 3: Comment Toggle Behavior

**User Story:** As a Stata developer, I want the toggle comment shortcut to insert comments using my configured style, so that toggling comments is consistent with my preference.

#### Acceptance Criteria

1. WHEN the Line_Comment_Style_Setting is set to `"//"`, THE Language_Configuration SHALL set `lineComment` to `"//"`
2. WHEN the Line_Comment_Style_Setting is set to `"*"`, THE Language_Configuration SHALL set `lineComment` to `"*"`
3. WHEN the user triggers the toggle comment action, THE Extension SHALL rely on VS Code's built-in comment toggling which uses the active Language_Configuration

### Requirement 4: Setting Registration

**User Story:** As a Stata developer, I want the comment style setting to appear in VS Code's settings UI with clear descriptions, so that I can discover and configure it easily.

#### Acceptance Criteria

1. THE Extension SHALL register `sight.lineCommentStyle` in the `contributes.configuration.properties` section of `client/package.json`
2. THE Line_Comment_Style_Setting SHALL include an enum with values `"//"` and `"*"`
3. THE Line_Comment_Style_Setting SHALL include descriptive enum descriptions explaining each option
4. THE Line_Comment_Style_Setting SHALL include a description explaining its purpose


### Requirement 5: Formatter Preferred Comment Style Linkage

**User Story:** As a Stata developer, I want the formatter's preferred comment style to default to my line comment style setting, so that both features stay in sync without extra configuration.

#### Acceptance Criteria

1. THE Preferred_Comment_Style_Setting SHALL add a `"line"` option that defers to the Line_Comment_Style_Setting value
2. THE Preferred_Comment_Style_Setting SHALL change its default from `"//"` to `"line"`
3. WHEN the Preferred_Comment_Style_Setting is set to `"line"`, THE Extension SHALL resolve the effective formatter comment style by reading the Line_Comment_Style_Setting value
4. WHEN the Preferred_Comment_Style_Setting is set to `"//"`, `"*"`, or `"/* */"`, THE Extension SHALL use that explicit value for formatter normalization regardless of the Line_Comment_Style_Setting

### Requirement 6: Documentation Update

**User Story:** As a Stata developer, I want the README to document the new line comment style setting, so that I can discover and understand how to configure it.

#### Acceptance Criteria

1. THE Extension SHALL document the `sight.lineCommentStyle` setting in the README settings table
2. THE Extension SHALL document the updated `sight.formatting.preferredCommentStyle` default and new `"line"` option in the README settings table
3. THE Extension SHALL include an example showing how to configure the line comment style in the README
