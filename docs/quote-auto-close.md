# Quote Auto-Close

The extension provides intelligent auto-closing for Stata's unique quoting conventions. Unlike VS Code's built-in auto-closing pairs, this feature handles Stata's overlapping delimiters correctly.

## Supported Patterns

| You Type   | Result         | Description                           |
| ---------- | -------------- | ------------------------------------- |
| `` ` ``    | `` `\|' ``     | Local macro reference                 |
| `` \`\` `` | `` \`\`\|'' `` | Nested local macro (double backticks) |
| `` `" ``   | `` `"\|"' ``   | Compound string                       |
| `"`        | `` `"\|"` ``   | Double-quoted string                  |

Note: `|` represents cursor position.

## Skip-Over Behavior

When you manually type a closing character that was auto-inserted, the extension skips over it instead of inserting a duplicate:

| Context            | You Type | Result             |
| ------------------ | -------- | ------------------ |
| `` `macro\|' ``    | `'`      | `` `macro'\| ``    |
| `"string\|"`       | `"`      | `"string"\|`       |
| `` `"string\|"' `` | `'`      | `` `"string"'\| `` |

This prevents common issues like ending up with `"string""` or `` `macro'' ``.

## How It Works

The extension uses a `onDidChangeTextDocument` listener rather than VS Code's `type` command interceptor. This approach:
- Does not conflict with other extensions
- Reacts after the character is inserted
- Checks context to determine appropriate closing characters

## Preserved Behaviors

Standard auto-closing pairs continue to work via VS Code's language configuration:
- `{` → `{|}`
- `[` → `[|]`
- `(` → `(|)`
