# Configuration

The extension supports the following configuration options. All settings are prefixed with `sight.` and can be configured in VS Code's Settings UI or in your `settings.json` file.

## Contents

- [Diagnostics](#diagnostics)
  - [Forward Reference Detection](#forward-reference-detection)
- [Tuning autocomplete behavior](#tuning-autocomplete-behavior)
  - [Changing settings](#changing-settings)
  - [Stopping Tab from accepting suggestions](#stopping-tab-from-accepting-suggestions)
- [Indexing](#indexing)
- [ADO Paths](#ado-paths)
- [Comments](#comments)
- [Project Configuration File](#project-configuration-file)
- [See Also](#see-also)

## Diagnostics

Control how the LSP reports errors, warnings, and other diagnostics.

| Setting                                        | Type    | Default         | Description                                                                                                           |
| ---------------------------------------------- | ------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sight.diagnostics.enabled`                    | boolean | `true`          | Enable or disable all diagnostics                                                                                     |
| `sight.diagnostics.severity.undefinedMacro`    | enum    | `"warning"`     | Severity level for undefined macro references. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"`    |
| `sight.diagnostics.severity.undefinedVariable` | enum    | `"off"`         | [Experimental] Severity level for undefined variable references. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.styleWarnings`     | enum    | `"hint"`        | Severity level for style warnings. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"`                |
| `sight.diagnostics.severity.malformedOperator` | enum    | `"warning"`     | Severity for spaced compound operator diagnostics (e.g., `< =` → `<=`). Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.invalidOperatorSequence` | enum | `"error"`     | Severity for invalid operator sequence diagnostics (e.g., `< \|`). Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.severity.cStyleLogicalInControlFlow` | enum | `"information"` | Severity for C-style logical operators (`&&`, `\|\|`) in if/else if control flow statements. These work but are stylistically discouraged. Options: `"error"`, `"warning"`, `"information"`, `"hint"`, `"off"` |
| `sight.diagnostics.indentation`                | boolean | `false`         | Enable indentation diagnostics (missing indentation in blocks, unnecessary indentation after comments)                |

When the scope resolver can prove a referenced macro or variable exists but is
unreachable, Sight replaces the generic undefined-symbol diagnostic with a more
specific `OUT_OF_SCOPE_SYMBOL` message at the same severity. This applies when
the symbol is defined later in the same file, defined after the relevant call
site in another file, or excluded because local macros do not inherit through
`do`/`run`. If the underlying undefined diagnostic is disabled, the rewrite is
also suppressed.

<a name="why-indentation-diagnostics-disabled"></a>
> **Why Indentation Diagnostics Are Disabled by Default**
>
> Unlike Python, Stata ignores indentation - it's purely stylistic and doesn't affect code execution. Indentation diagnostics are disabled by default for several reasons:
>
> 1. **Stylistic, not semantic**: "Wrong" indentation won't break your code
> 2. **Legacy codebase noise**: Existing codebases may produce many warnings, causing alert fatigue
> 3. **Subjective preferences**: Teams may have different indentation conventions
> 4. **Opt-in philosophy**: Mature LSPs (TypeScript, ESLint) default stylistic rules to off
>
> To enable indentation diagnostics:
> - **VS Code**: Set `sight.diagnostics.indentation` to `true` in Settings
> - **Project config**: Add `"diagnostics": { "indentation": true }` to `.sight.json`

### Forward Reference Detection

The LSP detects "forward references" - using a macro before it's defined in execution order. Stata executes code sequentially, so a macro doesn't exist until the line defining it runs.

**Local macros** must be defined before use within the same file:
```stata
// Warning: `fruit' is not yet defined
local result: list fruit - other
local fruit apple banana
local other banana
```

**Global macros in the same file** must also be defined before use:
```stata
// Warning: file_global is not yet defined
local result: list file_global - other
global file_global value
```

**Global macros from other files** also produce warnings unless the LSP can determine the relationship. By default (`crossFile.backwardDependencies: "auto"`), the LSP scans the workspace at startup to discover which files call which, and automatically resolves parent–child symbol inheritance. It also follows `do`, `run`, and `include` commands within each file for forward resolution. For cases where auto-detection doesn't work (e.g., dynamic paths with macros), you can use explicit directives (`@lsp-done-by`, `@lsp-included-by`, `@lsp-do`, `@lsp-run`, `@lsp-include`). The workspace indexer provides globals for completions and go-to-definition, but does not suppress undefined macro warnings. See [Cross-File Awareness](cross-file.md) for details.

**First definition wins**: When a macro is defined multiple times, references before the first definition produce warnings, but references after the first definition do not (even if they appear before later redefinitions).

**Macro-creating options**: The analyzer recognizes `local()` and `global()` options on built-in commands (`levelsof`, `glevelsof`) and user-defined programs (via `` c_local `option' `` and `` global `option' `` patterns matching syntax declarations).

## Tuning autocomplete behavior

If autocomplete feels too aggressive, there are a few knobs to adjust.

- **When the completions menu appears.** By default it pops up almost instantly as you type.
  You can delay it, or turn automatic popups off entirely and trigger the menu manually with
  Ctrl+Space.
- **How completions get accepted.** By default both Enter and Tab accept the highlighted
  suggestion when the menu is open. You can turn off Enter (so Enter always inserts a newline),
  turn off Tab (so Tab always indents), or both.

### Changing settings

The first three knobs below are `editor.*` settings. Open the VS Code Settings UI either with
the keyboard (Cmd+, on macOS, Ctrl+, on Windows/Linux) or through the menu (Code → Settings →
Settings on macOS, File → Preferences → Settings on Windows/Linux). Paste the setting ID into
the search box at the top, then change the value inline.

| Setting | Default | What it does / how to change |
| --- | --- | --- |
| `editor.acceptSuggestionOnEnter` | `"on"` | `"on"` accepts on Enter; `"off"` makes Enter always insert a newline; `"smart"` only accepts when the suggestion would change the code. Set to `"off"` if you want Enter to always start a new line, even with the menu open. |
| `editor.quickSuggestionsDelay` | `10` ms | Raise this (e.g., `500`) to delay the popup so it doesn't appear mid-keystroke. Or set `editor.quickSuggestions` to `"off"` entirely and use Ctrl+Space to trigger suggestions on demand. |
| `editor.acceptSuggestionOnCommitCharacter` | `true` | Typing a "commit character" like `.`, `(`, or `:` *both* accepts the highlighted suggestion *and* inserts the character. Set to `false` if you'd rather those characters insert literally and only explicit keys (Tab / Enter) accept. |


### Stopping Tab from accepting suggestions

VS Code doesn't ship an `editor.acceptSuggestionOnTab` toggle — unbinding Tab is a keyboard
shortcut change rather than a setting. Open the Keyboard Shortcuts editor either with the
keyboard (Cmd+K Cmd+S on macOS, Ctrl+K Ctrl+S on Windows/Linux) or through the menu (Code →
Settings → Keyboard Shortcuts on macOS, File → Preferences → Keyboard Shortcuts on
Windows/Linux). Search for `acceptSelectedSuggestion` — the entry bound to Tab is the one you
want. Right-click it and choose **Remove Keybinding**. Tab will now indent even when the
completions menu is open, while Enter still accepts (unless you also changed
`editor.acceptSuggestionOnEnter`).

If you'd rather edit the JSON directly, open `keybindings.json` (from the Keyboard Shortcuts
editor, click the "Open Keyboard Shortcuts (JSON)" icon in the top right) and add:

```json
{
  "key": "tab",
  "command": "-acceptSelectedSuggestion",
  "when": "suggestWidgetVisible && textInputFocus && !editorReadonly"
}
```

The leading `-` removes Tab from that command specifically.

## Indexing

Configure workspace indexing behavior for cross-file features.

| Setting                           | Type    | Default  | Description                                      |
| --------------------------------- | ------- | -------- | ------------------------------------------------ |
| `sight.indexWorkspace`            | boolean | `true`   | Enable workspace-wide symbol indexing            |
| `sight.indexing.maxFileSizeBytes` | number  | `500000` | Maximum file size in bytes for indexing (~500KB) |

## ADO Paths

Configure additional search paths for ADO files.

| Setting          | Type  | Default | Description                              |
| ---------------- | ----- | ------- | ---------------------------------------- |
| `sight.adoPaths` | array | `[]`    | Additional paths to search for ADO files |

Example:

```json
{
  "sight.adoPaths": [
    "/path/to/custom/ado",
    "/another/ado/directory"
  ]
}
```

## Comments

Configure the line comment character used by VS Code's toggle comment shortcut.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `sight.lineCommentStyle` | string | `"//"` | Line comment character used by the toggle comment shortcut. In Stata, `//` can appear anywhere on a line while `*` must be at the start of a line. Options: `"//"`, `"*"` |

To use `*` for comment toggling instead of `//`:

```json
{
    "sight.lineCommentStyle": "*"
}
```

## Project Configuration File

You can also configure the LSP using a `.sight.json` file in your workspace root. This is useful for project-specific settings that should be shared with collaborators.

```json
{
  "diagnostics": {
    "indentation": false
  },
  "crossFile": {
    "backwardDependencies": "auto",
    "indexWorkspace": true,
    "maxIndexedFiles": 1000,
    "maxBackwardDepth": 10,
    "maxForwardDepth": 10,
    "maxChainDepth": 20,
    "assumeCallSite": "end",
    "diagnostics": {
      "missingFile": "warning",
      "callSiteIdentification": "information"
    }
  }
}
```

| Option                                  | Type                 | Default         | Description                                                             |
| --------------------------------------- | -------------------- | --------------- | ----------------------------------------------------------------------- |
| `diagnostics.indentation`               | boolean              | `false`         | Enable indentation diagnostics                                          |
| `crossFile.backwardDependencies`        | `"auto"` \| `"explicit"` | `"auto"`    | `"auto"`: discover parents from workspace scan; `"explicit"`: require directives |
| `crossFile.indexWorkspace`              | boolean              | `true`          | Enable workspace-wide file indexing                                     |
| `crossFile.maxIndexedFiles`             | number               | `1000`          | Maximum files to index                                                  |
| `crossFile.maxBackwardDepth`            | number               | `10`            | Maximum recursion depth for backward directive resolution               |
| `crossFile.maxForwardDepth`             | number               | `10`            | Maximum recursion depth for forward scope resolution                    |
| `crossFile.maxChainDepth`               | number               | `20`            | Maximum combined depth for forward + backward resolution                |
| `crossFile.maxCalleeRevalidations`      | number               | `10`            | Maximum number of open callee documents to revalidate per caller change |
| `crossFile.assumeCallSite`              | `"end"` \| `"start"` | `"end"`         | Where to assume call site when not specified and inference fails        |
| `crossFile.diagnostics.missingFile`     | severity             | `"warning"`     | Severity for missing directive file diagnostics                         |
| `crossFile.diagnostics.callSiteIdentification` | severity      | `"information"` | Severity for call site identification diagnostics                       |

Severity options: `"error"`, `"warning"`, `"information"`, `"off"` (alias: `"info"` for `"information"`)

VS Code settings take precedence over `.sight.json` when both are present.

## See Also

Additional settings are documented alongside their features:
- [Formatting settings](formatting.md#configuration) - Indentation, line width, comment normalization
- [Send to Stata settings](send-to-stata.md#configuration-options) - Stata app, auto-save, cursor advancement, working directory
