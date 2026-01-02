# Requirements Document

## Introduction

This document specifies requirements for improving the compatibility of nested syntax coloring (depth colors) across VS Code themes. Currently, the Sight extension uses `[*Dark*]` and `[*Light*]` wildcard theme selectors to apply depth colors for nested compound strings and local macros. However, many popular VS Code themes don't contain "Dark" or "Light" in their names, causing the depth coloring feature to not work for users of those themes.

## Glossary

- **Depth_Color_System**: The system that applies distinct colors to nested compound strings and local macros at different nesting levels (depth 1-6)
- **Theme_Selector**: A VS Code configuration pattern that targets specific themes (e.g., `[*Dark*]`, `[Monokai]`, `[*]`)
- **TextMate_Rule**: A VS Code configuration object that maps a scope name to a foreground color
- **Color_Scheme_Type**: The classification of a theme as either "dark" or "light" based on its background luminance
- **Active_Theme**: The currently selected VS Code color theme

## Requirements

### Requirement 1: Universal Theme Coverage

**User Story:** As a Stata developer, I want depth colors to work regardless of which VS Code theme I use, so that I can benefit from nested syntax coloring with any theme.

#### Acceptance Criteria

1. WHEN the extension activates THEN the Depth_Color_System SHALL apply depth color rules that work with all VS Code themes
2. WHEN a user has a theme that doesn't contain "Dark" or "Light" in its name THEN the Depth_Color_System SHALL still apply appropriate depth colors
3. WHEN depth color rules are applied THEN the Depth_Color_System SHALL use colors appropriate for the Active_Theme's Color_Scheme_Type

### Requirement 2: Theme-Appropriate Color Selection

**User Story:** As a Stata developer, I want depth colors to be readable on my theme's background, so that I can easily distinguish nesting levels.

#### Acceptance Criteria

1. WHEN the Active_Theme is a dark theme THEN the Depth_Color_System SHALL apply the dark color palette
2. WHEN the Active_Theme is a light theme THEN the Depth_Color_System SHALL apply the light color palette
3. WHEN the user switches themes THEN the Depth_Color_System SHALL update colors to match the new theme's Color_Scheme_Type

### Requirement 3: Fallback Color Application

**User Story:** As a Stata developer, I want depth colors to have a reliable fallback mechanism, so that colors are always applied even if theme detection fails.

#### Acceptance Criteria

1. WHEN theme-specific selectors don't match THEN the Depth_Color_System SHALL apply colors using a universal fallback selector
2. WHEN the Color_Scheme_Type cannot be determined THEN the Depth_Color_System SHALL default to dark theme colors (most common theme type)
3. IF the fallback mechanism is used THEN the Depth_Color_System SHALL log a diagnostic message for debugging

### Requirement 4: Preserve Existing User Customizations

**User Story:** As a Stata developer who has customized my depth colors, I want my customizations to be preserved, so that I don't lose my preferred color settings.

#### Acceptance Criteria

1. WHEN the user has existing depth color rules THEN the Depth_Color_System SHALL NOT overwrite them
2. WHEN merging new color rules THEN the Depth_Color_System SHALL preserve user-defined rules for specific themes
3. WHEN the reset command is invoked THEN the Depth_Color_System SHALL replace all depth color rules with defaults

### Requirement 5: Dynamic Theme Change Handling

**User Story:** As a Stata developer, I want depth colors to update when I change themes, so that colors remain appropriate for my current theme.

#### Acceptance Criteria

1. WHEN the user changes the Active_Theme THEN the Depth_Color_System SHALL detect the theme change
2. WHEN a theme change is detected THEN the Depth_Color_System SHALL evaluate if color updates are needed
3. WHEN the new theme's Color_Scheme_Type differs from the previous THEN the Depth_Color_System SHALL apply appropriate colors
