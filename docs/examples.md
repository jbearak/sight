# Examples Gallery

Screenshots of Sight features in VS Code.

## Diagnostics

### Syntax error: else on same line as closing brace
<img width="683" height="390" src="../examples/else_on_same_line_as_closing_brace.png"/>

### Undefined local macro
Stata would evaluate `` `froot' `` to `""` because of the misspelling. In this example, it affects the displayed text. When combined with if-then-else statements, this leads to unexpected control flow.
<img width="683" height="390" src="../examples/undefined_local.png"/>

### Missing indentation

> **Note:** Indentation diagnostics are disabled by default. See [Configuration > Diagnostics](configuration.md#diagnostics) to enable them.

<img width="" height="345" src="../examples/missing_indentation.png"/>

## Completions

### Command completion
<img width="615" height="420" src="../examples/command_completion.png"/>

### Option completion
<img width="615" height="420" src="../examples/options_completion.png"/>

### Macro completion
<img width="651" height="449" src="../examples/macro_completion.png"/>

### Variable completion
<img width="696" height="533" src="../examples/variable_completion.png"/>

## Hover

<img width="607" height="546" src="../examples/variable_hover.png"/>

## Go to Definition

Command+click (Mac) or Control+click (Windows) to see symbol definitions across files.
<img width="671" height="386" src="../examples/command_click.png"/>

## Syntax Highlighting

Sight colorizes nesting depth of compound strings and local macros.

<img width="581" height="386" src="../examples/nested_locals_within_compound_strings_dark.png"/>
<img width="581" height="386" src="../examples/nested_locals_within_compound_strings_light.png"/>

## Send to Stata

Execute code in Stata directly from the editor.
<img width="641" height="565" src="../examples/send_to_stata_menu.png"/>
