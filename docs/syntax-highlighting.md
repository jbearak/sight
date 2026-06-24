# Syntax Highlighting

The LSP provides comprehensive syntax highlighting through TextMate grammar scopes. These scopes enable precise theming and editor features.

## Core Language Elements

| Element               | Scope                                         | Description                                     |
| --------------------- | --------------------------------------------- | ----------------------------------------------- |
| **Comments**          | `comment.block.stata`                         | Block comments (`/* */`)                        |
|                       | `comment.line.star.stata`                     | Star comments (`*`)                             |
|                       | `comment.line.double-slash.stata`             | Double-slash comments (`//`)                    |
|                       | `comment.line.triple-slash.stata`             | Triple-slash continuation (`///`)               |
| **Strings**           | `string.quoted.double.stata`                  | Double-quoted strings                           |
|                       | `string.quoted.compound.depth[1-6].stata`     | Compound strings with nesting                   |
| **Macros**            | `variable.other.macro.global.stata`           | Global macros (`$name`)                         |
|                       | `variable.other.macro.local.depth[1-6].stata` | Local macros with nesting                       |
| **Macro Definitions** | `variable.other.local.stata`                  | Local macro names at definition (`local foo`)   |
|                       | `variable.other.global.stata`                 | Global macro names at definition (`global bar`) |

## Keywords and Commands

| Category           | Scope                               | Examples                                                |
| ------------------ | ----------------------------------- | ------------------------------------------------------- |
| **Control Flow**   | `keyword.control.conditional.stata` | `if`, `else`                                            |
|                    | `keyword.control.flow.stata`        | `foreach`, `forvalues`, `while`, `do`, `run`, `include` |
|                    | `keyword.control.prefix.stata`      | `by`, `quietly`, `capture`                              |
| **Commands**       | `keyword.functions.data.stata`      | `gen`, `replace`, `use`, `save`                         |
|                    | `keyword.other.command.stata`       | `display`, `list`, `tab`                                |
|                    | `keyword.other.command.addon.stata` | `reghdfe`, `estout`                                     |
| **Macro Commands** | `keyword.macro.stata`               | `local`, `global`, `tempvar`, `tempname`, `tempfile`    |
|                    | `keyword.macro.extendedfcn.stata`   | Extended functions                                      |

## Data Types and Built-ins

| Element                | Scope                             | Examples                                                           |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| **Functions**          | `support.function.builtin.stata`  | Built-in functions                                                 |
| **Data Types**         | `support.type.stata`              | `byte`, `int`, `long`, `float`, `double`, `str1`-`str2045`, `strL` |
| **Built-in Variables** | `variable.language.stata`         | `_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`                   |
| **Missing Values**     | `constant.language.missing.stata` | `.`, `.a`-`.z`                                                     |

## Operators and Programs

| Element       | Scope                               | Examples             |
| ------------- | ----------------------------------- | -------------------- |
| **Operators** | `keyword.operator.arithmetic.stata` | `+`, `-`, `*`, `/`   |
|               | `keyword.operator.comparison.stata` | `==`, `!=`, `<`, `>` |
|               | `keyword.operator.logical.stata`    | `&`, `\|`, `!`       |
|               | `keyword.operator.assignment.stata` | `=`                  |
|               | `keyword.operator.interaction.stata` | `#`                 |
|               | `keyword.operator.factor.stata`     | `i.`, `c.`, `o.`, `b2.`, `ibn.`, `i(1/3).` |
| **Programs**  | `storage.type.function.stata`       | `program` keyword    |
|               | `entity.name.function.stata`        | Program names        |

## Mata Blocks

| Element           | Scope                            | Description            |
| ----------------- | -------------------------------- | ---------------------- |
| **Mata Context**  | `meta.embedded.block.mata.stata` | Entire Mata block      |
| **Mata Keywords** | `keyword.control.mata.stata`     | Mata-specific keywords |
| **Mata Types**    | `support.type.mata.stata`        | Mata data types        |

## Nesting Depth Feature

The grammar supports **6 levels of nesting depth** for compound strings and local macros, cycling through depth1-depth6:

```stata
local outer "Level 1 `inner' text"           // depth1
local inner "Level 2 `deeper' text"          // depth2
local deeper "Level 3 `deepest' text"        // depth3
// ... continues through depth6, then cycles back to depth1
```

This enables editors to apply distinct styling to each nesting level, improving readability of complex macro expansions.

### Automatic Color Configuration

On first activation, the extension automatically adds colors for each nesting depth to your VS Code settings. These colors work with **all VS Code themes**, including:

- Themes with "Dark" or "Light" in their names (e.g., "Dark+", "Light+")
- Themes without these keywords (e.g., "Monokai", "Dracula", "Nord", "Solarized")

The extension detects your current theme type (dark or light) and applies appropriate colors automatically. When you switch themes, the colors update to match.

> VS Code's architecture requires `editor.tokenColorCustomizations` to be present in your settings file for custom syntax scopes to have colors. Extensions cannot provide default colors for custom scopes through their manifest - the colors must exist in `settings.json` or all nesting levels would appear identical.

You can customize these colors by opening your VS Code settings and modifying the `editor.tokenColorCustomizations` section.

To reset depth colors to defaults, use the command palette: **Sight: Reset Depth Colors Configuration**

To use your VS Code theme's default string and variable colors instead of
Sight's depth-specific palette, set `sight.depthColors.enabled` to `false`
in your VS Code settings. Sight will remove the depth color rules it had
written, leaving any colors you hand-edited on those scopes in place.
Toggle it back on to restore the defaults; no window reload is needed.

### Default Nesting Colors

**String Depth Colors** (warm progression):

| Depth | Scope                                 | Dark Theme               | Light Theme              |
| ----- | ------------------------------------- | ------------------------ | ------------------------ |
| 1     | `string.quoted.compound.depth1.stata` | `#CE9178` (orange)       | `#A31515` (dark red)     |
| 2     | `string.quoted.compound.depth2.stata` | `#D4A373` (light orange) | `#986801` (brown)        |
| 3     | `string.quoted.compound.depth3.stata` | `#DCDCAA` (gold)         | `#6B8E23` (olive)        |
| 4     | `string.quoted.compound.depth4.stata` | `#B5CEA8` (yellow-green) | `#2E8B57` (forest green) |
| 5     | `string.quoted.compound.depth5.stata` | `#A8D4A8` (light green)  | `#008B8B` (teal)         |
| 6     | `string.quoted.compound.depth6.stata` | `#8ECDC8` (teal)         | `#4682B4` (steel blue)   |

**Macro Depth Colors** (cool progression):

| Depth | Scope                                     | Dark Theme               | Light Theme             |
| ----- | ----------------------------------------- | ------------------------ | ----------------------- |
| 1     | `variable.other.macro.local.depth1.stata` | `#9CDCFE` (light blue)   | `#001080` (dark blue)   |
| 2     | `variable.other.macro.local.depth2.stata` | `#7DCFEA` (sky blue)     | `#0000CD` (navy)        |
| 3     | `variable.other.macro.local.depth3.stata` | `#6DD4D4` (cyan)         | `#4169E1` (royal blue)  |
| 4     | `variable.other.macro.local.depth4.stata` | `#5DC9B0` (teal)         | `#6A5ACD` (slate blue)  |
| 5     | `variable.other.macro.local.depth5.stata` | `#B4A7D6` (light purple) | `#8A2BE2` (blue violet) |
| 6     | `variable.other.macro.local.depth6.stata` | `#C9A7DE` (lavender)     | `#9932CC` (dark orchid) |

### Customizing Nesting Colors

You can override the default colors in your VS Code settings. The extension automatically detects your theme type and applies colors to the current theme. To customize colors for specific themes, you can use theme selectors:

```json
{
  "editor.tokenColorCustomizations": {
    "[Monokai]": {
      "textMateRules": [
        {
          "scope": "string.quoted.compound.depth1.stata",
          "settings": { "foreground": "#FFD700" }
        },
        {
          "scope": "variable.other.macro.local.depth1.stata",
          "settings": { "foreground": "#87CEEB" }
        }
      ]
    },
    "[*Dark*]": {
      "textMateRules": [
        {
          "scope": "string.quoted.compound.depth1.stata",
          "settings": { "foreground": "#CE9178" }
        }
      ]
    },
    "[*Light*]": {
      "textMateRules": [
        {
          "scope": "string.quoted.compound.depth1.stata",
          "settings": { "foreground": "#B22222" }
        }
      ]
    }
  }
}
```

To match your theme's bracket pair colors, find your theme's bracket colors (`editorBracketHighlight.foreground1` through `foreground6`) and apply them to the depth scopes.
