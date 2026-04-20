# Configuration

The extension supports the following configuration options. All settings are prefixed with `sight.` and can be configured in VS Code's Settings UI or in your `settings.json` file.

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

**Macro-creating options**: The analyzer recognizes `local()` and `global()` options on built-in commands (`levelsof`, `glevelsof`) and user-defined programs (via `c_local `option'` and `global `option'` patterns matching syntax declarations).

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
      "outOfScope": "information",
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
| `crossFile.diagnostics.outOfScope`      | severity             | `"information"` | Severity for out-of-scope symbol diagnostics                            |
| `crossFile.diagnostics.missingFile`     | severity             | `"warning"`     | Severity for missing directive file diagnostics                         |
| `crossFile.diagnostics.callSiteIdentification` | severity      | `"information"` | Severity for call site identification diagnostics                       |

Severity options: `"error"`, `"warning"`, `"information"`, `"off"` (alias: `"info"` for `"information"`)

VS Code settings take precedence over `.sight.json` when both are present.

## Example Configurations

### Disable All Diagnostics

```json
{
  "sight.diagnostics.enabled": false
}
```

### Treat Undefined Macros as Errors

```json
{
  "sight.diagnostics.severity.undefinedMacro": "error"
}
```

### Disable Indentation Diagnostics

```json
{
  "sight.diagnostics.indentation": false
}
```

### Add Custom ADO Paths

```json
{
  "sight.adoPaths": [
    "/path/to/custom/ado",
    "/another/ado/directory"
  ]
}
```

### Minimal Diagnostics (Errors Only)

```json
{
  "sight.diagnostics.severity.undefinedMacro": "error",
  "sight.diagnostics.severity.undefinedVariable": "off",
  "sight.diagnostics.severity.styleWarnings": "off"
}
```

## Tuning autocomplete behavior

These are standard VS Code controls, not Sight settings — but they're the most common knobs
people reach for when Sight's autocomplete feels too aggressive. The first three are `editor.*`
settings in `settings.json`.

- `editor.acceptSuggestionOnCommitCharacter` (default `true`) — when on, typing a "commit
  character" like `.`, `(`, or `:` *both* accepts the highlighted suggestion *and* inserts the
  character. Set to `false` if you'd rather those characters insert literally and only explicit
  keys (Tab / Enter) accept.
- `editor.acceptSuggestionOnEnter` (default `"on"`) — `"on"` accepts on Enter, `"off"` makes
  Enter always insert a newline, `"smart"` only accepts when the suggestion would change the
  code.
- `editor.quickSuggestionsDelay` (default `10` ms) — raise this (e.g., `500`) to delay the popup
  so it doesn't appear mid-keystroke. Or set `editor.quickSuggestions` to `"off"` entirely and
  use Ctrl+Space to trigger suggestions on demand.

**Stopping Tab from accepting suggestions** is a keybinding change, not a setting — VS Code
doesn't ship an `editor.acceptSuggestionOnTab` toggle. To unbind Tab from accepting (so it goes
back to inserting indentation even when the suggestion widget is open), add this to
`keybindings.json`:

```json
{
  "key": "tab",
  "command": "-acceptSelectedSuggestion",
  "when": "suggestWidgetVisible && textInputFocus && !editorReadonly"
}
```

The leading `-` removes Tab from that command specifically. Enter still accepts unless you also
set `editor.acceptSuggestionOnEnter` to `"off"`.

## See Also

Additional settings are documented alongside their features:
- [Formatting settings](formatting.md#configuration) - Indentation, line width, comment normalization
- [Send to Stata settings](send-to-stata.md#configuration-options) - Stata app, auto-save, cursor advancement, working directory
