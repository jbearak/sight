# Sight console (experimental)

`sight console` runs Stata's console (`stata-mp`, `stata-se`, ...) in your
terminal and puts a better front end on it:

- syntax highlighting as you type;
- Tab completion for commands, options, macros, variables and file paths;
- history kept across sessions;
- colored output: errors in red, notes and warnings in yellow, and
  commands echoed by a do-file highlighted like input.

Stata does the work. Sight passes it each line you enter, as if you'd
typed the line into plain console Stata, and colors what Stata prints.
Commands and Stata itself behave as usual.

> [!NOTE]
> The console is experimental. It has been tested against a stand-in
> that mimics console Stata. If something looks wrong with real Stata,
> see [Known limits](#known-limits) and
> [please report it](https://github.com/jbearak/sight/issues).

## Requirements

- macOS or Linux. Stata has no interactive console on Windows.
- Stata's console binary. Sight looks for `--stata PATH`, then
  `SIGHT_STATA_PATH`, then `stata-mp`, `stata-se`, `stata-be`, `stata-ic`
  and `stata` on your `PATH`, then (on macOS) the app bundles in
  `/Applications/Stata` and `/Applications/StataNow`.
- The native `sight` binary (Homebrew, GitHub releases), or Sight run
  with Bun 1.3.5 or later. The npm package runs under Node, which has no
  pseudo-terminal support, so there `sight console` exits with a message
  unless input is piped (see below).

## Usage

```text
sight console [OPTIONS] [-- STATA_ARGS...]
```

| Option | Effect |
|---|---|
| `--stata PATH` | Stata console binary to run |
| `--color-output streams\|off` | Color output (default `streams`) |
| `--no-color` | Same as `--color-output off` |
| `--no-history` | Don't read or write the history file |
| `--stata-echoes` | Stata echoes input itself; show each line once |

Stata starts with `-q` (no banner). Arguments after `--` replace that,
for example `sight console -- -q -b`. `NO_COLOR` turns colors off.

When input or output is not a terminal (`sight console < script.txt`),
Sight runs Stata directly with no front end and exits with Stata's exit
status.

## Editing

| Key | Does |
|---|---|
| `Enter` | Sends the line to Stata |
| `Tab` / `Shift+Tab` | Completes, or moves through the completion menu |
| `Up` / `Down`, `Ctrl+P` / `Ctrl+N` | Earlier and later history entries |
| `Home` / `End`, `Ctrl+A` / `Ctrl+E` | Start and end of the line |
| `Ctrl+B` / `Ctrl+F`, `Alt+B` / `Alt+F` | Back and forward a character or a word |
| `Ctrl+Left` / `Ctrl+Right` | Previous and next word |
| `Ctrl+K` / `Ctrl+U` | Cuts to the end or the start of the line |
| `Ctrl+W`, `Alt+Backspace` / `Alt+D` | Cuts the word before or after the cursor |
| `Ctrl+Y` | Pastes the text you last cut |
| `Ctrl+T` | Swaps two characters |
| `Ctrl+C` | Clears the line and interrupts Stata |
| `Ctrl+D` | At the `.` prompt with an empty line, sends `exit` |
| `Ctrl+L` | Clears the screen |
| `Esc` | Closes the completion menu, or discards staged pasted lines |

`Ctrl+D` sends `exit`, so Stata still refuses to quit when the data in
memory has changed (`exit, clear` quits anyway). Inside a block, such as
after `foreach ... {`, `Ctrl+D` does nothing, because `exit` would become
part of the block.

Interactive console Stata reads one line per command, so the editor is
single-line. Blocks work as in Stata: after `foreach x in a b {` Stata
shows numbered prompts (`  1. `) until the closing `}`.

### Completion

Completion is static, from the same engine that powers Sight's editor
completions. It knows Stata's commands and their options, and names
defined by lines you entered this session, such as `local`, `global`,
`generate` and `program define`. Lines that ended in an error are left
out. It doesn't ask Stata for anything, which would overwrite `r()`
results and show up in your log, so it doesn't know variables from data
you loaded with `use` or names created by do-files. Paths complete
relative to the directory you started the console in.

### Pasting

Pasting one line inserts it. When you paste several lines, the first goes
into the editor and the rest are staged. The editor shows how many remain.
After each command finishes, the next staged line is loaded into the
editor for you to run with `Enter`. Staged lines are never sent without
`Enter`, and they're discarded if a command fails or you press `Ctrl+C`
or `Esc`. To run many lines, put them in a do-file and run `do file.do`.

### Typing while Stata runs

What you type while Stata is busy is kept and sent when you press
`Enter`, as in plain console Stata. This is also how you answer Stata
when it asks for input without a normal prompt (for example
`display _request(name)`). At `--more--`, one keystroke answers it.

## History

History is saved to
`~/Library/Application Support/sight/console_history` on macOS and
`$XDG_DATA_HOME/sight/console_history` (default
`~/.local/share/sight/console_history`) on Linux. Set
`SIGHT_CONSOLE_HISTORY` to use another file. The file is readable only by
you. A line that starts with a space isn't saved. Only lines entered at
Stata, Mata, or Python prompts are saved; replies to input requests are
not.

## Colors

Colors use your terminal theme's 16 base colors, so they fit light and
dark themes. Stata's console prints plain text, so the colors come from
recognizing its output: an `r(NNN);` line and the message just before it
are red, `--Break--` is red, lines starting `note:` or `warning:` are
yellow, and do-file echo lines (`. cmd`, `  4. cmd`) are highlighted.
Output that already contains color codes is left alone.

## Known limits

- A line longer than 1000 bytes isn't sent, because the terminal's line
  buffer would cut it off. Put long commands in a do-file.
- The console decides that Stata is waiting at a prompt when Stata's
  output stops at a `. `, `: `, `>>> ` or numbered prompt for 50 ms.
  Output that happens to end that way only affects highlighting and
  staged pastes, never what is sent.
- If Stata turns terminal echo back on, Sight notices and shows each
  line once. If you still see lines twice, use `--stata-echoes`.

### Checking with real Stata

If you try the console, these are the behaviors not yet confirmed
against real Stata (they were checked against a stand-in):

1. Each line you enter shows once, not twice.
2. `Ctrl+C` stops a long command (`sleep 10000`) with `--Break--`.
3. `--more--` (after `set more on`) takes one keystroke.
4. Resizing the terminal changes Stata's line width.
5. `display _request(name)` takes your reply.
6. Mata (`mata`) and Python (`python`) prompts work.

## See also

- [CLI](cli.md)
- [Send to Stata](send-to-stata.md)
