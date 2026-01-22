# Neovim Setup for Sight

This guide explains how to configure Neovim to use the Sight language server and tree-sitter grammar for Stata syntax highlighting.

## Contents

- [Prerequisites](#prerequisites)
- [Language Server](#language-server)
  - [Installing the Language Server](#installing-the-language-server)
  - [LazyVim / lazy.nvim](#lazyvim--lazynvim-configuration)
  - [Standard Neovim](#standard-neovim-configuration-without-lazynvim)
- [Tree-sitter](#tree-sitter-configuration)
- [Send to Stata](#send-to-stata-macos)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Neovim 0.8+ (for native LSP support)
- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) plugin
- [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter) plugin
- Sight language server installed (see [Installation](#installing-the-language-server))


## Language Server
### Installing the Language Server

Install the Sight language server globally:

```bash
# Using bun
bun install -g github:jbearak/sight

# Using npm
npm install -g github:jbearak/sight
```

Verify the installation:

```bash
sight-language-server --help
```

### LazyVim / lazy.nvim Configuration

If you use [LazyVim](https://www.lazyvim.org/) or [lazy.nvim](https://github.com/folke/lazy.nvim), create a plugin file at `~/.config/nvim/lua/plugins/stata.lua`:

```lua
-- Sight LSP and tree-sitter configuration for Stata

return {
  {
    "neovim/nvim-lspconfig",
    event = "BufReadPre *.do,*.ado,*.mata,*.doh",
    config = function()
      local lspconfig = require("lspconfig")
      local configs = require("lspconfig.configs")

      -- Register the Sight language server
      if not configs.sight then
        configs.sight = {
          default_config = {
            cmd = { "sight-language-server", "--stdio" },
            filetypes = { "stata" },
            root_dir = function(fname)
              return lspconfig.util.root_pattern(".sight.json", ".git")(fname)
                or lspconfig.util.path.dirname(fname)
            end,
            settings = {},
          },
        }
      end

      -- Setup the server
      lspconfig.sight.setup({
        settings = {
          sight = {
            diagnostics = {
              enabled = true,
              indentation = false,
            },
          },
        },
      })
    end,
  },
}
```

Then add filetype detection and tree-sitter parser config to `~/.config/nvim/lua/config/autocmds.lua`:

```lua
-- Stata filetype detection
vim.filetype.add({
  extension = {
    ["do"] = "stata",
    ado = "stata",
    mata = "stata",
    doh = "stata",
  },
})

-- Tree-sitter parser configuration for Stata
vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  callback = function()
    local ok, parser_config = pcall(function()
      return require("nvim-treesitter.parsers").get_parser_configs()
    end)
    if ok then
      parser_config.stata = {
        install_info = {
          url = "https://github.com/jbearak/tree-sitter-stata",
          files = { "src/parser.c", "src/scanner.c" },
          branch = "main",
        },
        filetype = "stata",
      }
    end
  end,
})

-- Stata-specific auto-pairs for macros and compound quotes
vim.api.nvim_create_autocmd("FileType", {
  pattern = "stata",
  callback = function()
    -- ` produces `' (local macro delimiters)
    vim.keymap.set("i", "`", "`'<Left>", { buffer = true })
    -- `" produces `""' (compound string quotes)
    vim.keymap.set("i", '`"', '`""\'<Left><Left>', { buffer = true })
  end,
})
```

After adding this configuration, restart Neovim and run `:TSInstall stata` to install the tree-sitter parser.

### Standard Neovim Configuration (without lazy.nvim)

Add the following to your Neovim configuration (e.g., `~/.config/nvim/init.lua` or a separate file in `~/.config/nvim/lua/`):

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- Register Stata filetype
vim.filetype.add({
  extension = {
    ["do"] = 'stata',
    ado = 'stata',
    mata = 'stata',
    doh = 'stata',
  },
})

-- Define the Sight language server configuration
if not configs.sight then
  configs.sight = {
    default_config = {
      cmd = { 'sight-language-server', '--stdio' },
      filetypes = { 'stata' },
      root_dir = function(fname)
        return lspconfig.util.root_pattern('.sight.json', '.git')(fname)
          or lspconfig.util.path.dirname(fname)
      end,
      settings = {},
    },
  }
end

-- Enable the server
lspconfig.sight.setup({
  -- Optional: customize settings
  settings = {
    sight = {
      diagnostics = {
        enabled = true,
        indentation = false,
      },
    },
  },
})
```

## Tree-sitter Configuration

For syntax highlighting, install and configure tree-sitter-stata:

### 1. Add the parser to nvim-treesitter

Add this to your configuration:

```lua
local parser_config = require('nvim-treesitter.parsers').get_parser_configs()

parser_config.stata = {
  install_info = {
    url = 'https://github.com/jbearak/tree-sitter-stata',
    files = { 'src/parser.c', 'src/scanner.c' },
    branch = 'main',
  },
  filetype = 'stata',
}
```

### 2. Install the parser

Run in Neovim:

```vim
:TSInstall stata
```

### 3. Enable highlighting

Ensure tree-sitter highlighting is enabled in your config:

```lua
require('nvim-treesitter.configs').setup({
  highlight = {
    enable = true,
  },
})
```

## Send to Stata (macOS)

Neovim can send code to the Stata GUI application using AppleScript.

**Setup requires two steps:**
1. Create the `stata-send` module (the core logic)
2. Configure keybindings (LazyVim or standard Neovim)

### The stata-send Module

Create the file `~/.config/nvim/lua/stata-send.lua`:

```lua
-- stata-send.lua
-- Send code to Stata on macOS via AppleScript

local M = {}

-- Stata application variants in order of preference
local stata_apps = { "StataMP", "StataSE", "StataBE", "Stata" }

-- Find the first available Stata application
local function find_stata_app()
  for _, app in ipairs(stata_apps) do
    local path = "/Applications/Stata/" .. app .. ".app"
    if vim.fn.isdirectory(path) == 1 then
      return app
    end
  end
  return nil
end

-- Escape a string for use in AppleScript
local function escape_applescript(str)
  return str:gsub("\\", "\\\\"):gsub('"', '\\"')
end

-- Send a command to Stata via AppleScript
local function send_to_stata(stata_app, command, filepath)
  local escaped_path = escape_applescript(filepath)
  local applescript = string.format(
    'tell application "%s" to DoCommandAsync "%s \\"%s\\""',
    stata_app,
    command,
    escaped_path
  )
  -- Escape single quotes for shell
  local shell_safe = applescript:gsub("'", "'\\''")
  local cmd = string.format("osascript -e '%s'", shell_safe)

  vim.fn.jobstart(cmd, {
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        vim.notify("Stata error: " .. table.concat(data, "\n"), vim.log.levels.ERROR)
      end
    end,
  })
end

-- Send a raw Stata command (for cd)
local function send_raw_command(stata_app, stata_command)
  local escaped_cmd = escape_applescript(stata_command)
  local applescript = string.format(
    'tell application "%s" to DoCommandAsync "%s"',
    stata_app,
    escaped_cmd
  )
  local shell_safe = applescript:gsub("'", "'\\''")
  local cmd = string.format("osascript -e '%s'", shell_safe)

  vim.fn.jobstart(cmd, {
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        vim.notify("Stata error: " .. table.concat(data, "\n"), vim.log.levels.ERROR)
      end
    end,
  })
end

-- Check if a line ends with /// continuation
local function ends_with_continuation(line)
  if type(line) ~= "string" then
    return false
  end
  return line:match("%s*///%s*$") ~= nil
end

-- Detect the full statement bounds around a line (handles /// continuations)
-- Returns start_line, end_line (1-indexed, inclusive)
local function detect_statement(line)
  local start_line = line
  local end_line = line
  local line_count = vim.api.nvim_buf_line_count(0)

  -- Search backwards for statement start
  while start_line > 1 do
    local prev_line_result = vim.api.nvim_buf_get_lines(0, start_line - 2, start_line - 1, false)
    local prev_line = prev_line_result[1] or ""
    if not ends_with_continuation(prev_line) then
      break
    end
    start_line = start_line - 1
  end

  -- Search forwards for statement end
  while end_line < line_count do
    local current_line_result = vim.api.nvim_buf_get_lines(0, end_line - 1, end_line, false)
    local current_line = current_line_result[1] or ""
    if not ends_with_continuation(current_line) then
      break
    end
    end_line = end_line + 1
  end

  return start_line, end_line
end

-- Get upward bounds (from start of file to current statement end)
local function get_upward_bounds(line)
  local line_count = vim.api.nvim_buf_line_count(0)
  local end_line = line

  -- If cursor line has continuation, extend to include complete statement
  while end_line < line_count do
    local current_line_result = vim.api.nvim_buf_get_lines(0, end_line - 1, end_line, false)
    local current_line = current_line_result[1] or ""
    if not ends_with_continuation(current_line) then
      break
    end
    end_line = end_line + 1
  end

  return 1, end_line
end

-- Get downward bounds (from current statement start to end of file)
local function get_downward_bounds(line)
  local line_count = vim.api.nvim_buf_line_count(0)
  local start_line = line

  -- If cursor is on a continuation line, find statement start
  while start_line > 1 do
    local prev_line_result = vim.api.nvim_buf_get_lines(0, start_line - 2, start_line - 1, false)
    local prev_line = prev_line_result[1] or ""
    if not ends_with_continuation(prev_line) then
      break
    end
    start_line = start_line - 1
  end

  return start_line, line_count
end

-- Get the current line or visual selection
local function get_text()
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    -- Visual mode: get selection
    local start_pos = vim.fn.getpos("v")
    local end_pos = vim.fn.getpos(".")
    local start_line = start_pos[2]
    local end_line = end_pos[2]
    if start_line > end_line then
      start_line, end_line = end_line, start_line
    end
    local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
    -- Exit visual mode
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "n", false)
    return table.concat(lines, "\n")
  else
    -- Normal mode: detect full statement around current line
    local current_line = vim.fn.line(".")
    local start_line, end_line = detect_statement(current_line)
    local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
    return table.concat(lines, "\n")
  end
end

-- Get lines from a range (for command with range support)
local function get_range_text(line1, line2)
  local lines = vim.api.nvim_buf_get_lines(0, line1 - 1, line2, false)
  return table.concat(lines, "\n")
end

-- Get lines from start of file to current statement
local function get_upward_lines()
  local current_line = vim.fn.line(".")
  local start_line, end_line = get_upward_bounds(current_line)
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return table.concat(lines, "\n")
end

-- Get lines from current statement to end of file
local function get_downward_lines()
  local current_line = vim.fn.line(".")
  local start_line, end_line = get_downward_bounds(current_line)
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return table.concat(lines, "\n")
end

-- Create a temporary .do file with the given content
local function create_temp_file(content)
  local tmpfile = vim.fn.tempname() .. ".do"

  local file, err = io.open(tmpfile, "w")
  if not file then
    vim.notify(
      "Failed to create temporary file: " .. (err or "unknown error"),
      vim.log.levels.ERROR
    )
    return nil
  end

  local success, write_err = pcall(function()
    file:write(content)
  end)
  file:close()

  if not success then
    vim.fn.delete(tmpfile)
    vim.notify(
      "Failed to write to temporary file: " .. (write_err or "unknown error"),
      vim.log.levels.ERROR
    )
    return nil
  end

  return tmpfile
end

-- Send line or selection to Stata (for keybindings)
function M.send(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_text()
  if not text or text == "" then
    vim.notify("No text to send", vim.log.levels.WARN)
    return
  end

  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send range to Stata (for commands with range support)
function M.send_range(command, line1, line2)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_range_text(line1, line2)
  if not text or text == "" then
    vim.notify("No text to send", vim.log.levels.WARN)
    return
  end

  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send from start of file to current line
function M.send_upward(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_upward_lines()
  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send from current line to end of file
function M.send_downward(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local text = get_downward_lines()
  local tmpfile = create_temp_file(text)
  if tmpfile then
    send_to_stata(stata_app, command, tmpfile)
  else
    vim.notify("Failed to create temporary file", vim.log.levels.ERROR)
  end
end

-- Send entire file to Stata
function M.send_file(command)
  command = command or "do"
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  -- Save the file first
  local ok, err = pcall(vim.cmd, "write")
  if not ok then
    vim.notify("Failed to save file: " .. tostring(err), vim.log.levels.ERROR)
    return
  end

  local filepath = vim.fn.expand("%:p")
  if filepath == "" then
    vim.notify("No file to send", vim.log.levels.WARN)
    return
  end

  send_to_stata(stata_app, command, filepath)
end

-- Change Stata's working directory to the file's directory
function M.cd_file()
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local dir = vim.fn.expand("%:p:h")
  if dir == "" then
    vim.notify("No file directory available", vim.log.levels.WARN)
    return
  end

  local escaped_dir = escape_applescript(dir)
  send_raw_command(stata_app, 'cd `"' .. escaped_dir .. "\"'")
end

-- Change Stata's working directory to the workspace root
function M.cd_workspace()
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local dir = vim.fn.getcwd()
  local escaped_dir = escape_applescript(dir)
  send_raw_command(stata_app, 'cd `"' .. escaped_dir .. "\"'")
end

-- Register user commands
function M.setup()
  vim.api.nvim_create_user_command("SightDo", function(opts)
    M.send_range("do", opts.line1, opts.line2)
  end, { desc = "Sight: Do line or selection", range = true })

  vim.api.nvim_create_user_command("SightDoUpwardLines", function()
    M.send_upward("do")
  end, { desc = "Sight: Do upward lines" })

  vim.api.nvim_create_user_command("SightDoDownwardLines", function()
    M.send_downward("do")
  end, { desc = "Sight: Do downward lines" })

  vim.api.nvim_create_user_command("SightDoFile", function()
    M.send_file("do")
  end, { desc = "Sight: Do file" })

  vim.api.nvim_create_user_command("SightInclude", function(opts)
    M.send_range("include", opts.line1, opts.line2)
  end, { desc = "Sight: Include line or selection", range = true })

  vim.api.nvim_create_user_command("SightIncludeFile", function()
    M.send_file("include")
  end, { desc = "Sight: Include file" })

  vim.api.nvim_create_user_command("SightCdFile", function()
    M.cd_file()
  end, { desc = "Sight: CD to file directory" })

  vim.api.nvim_create_user_command("SightCdWorkspace", function()
    M.cd_workspace()
  end, { desc = "Sight: CD to workspace directory" })
end

return M
```

Multi-line statements using `///` continuation are automatically detected. For example, if you have:

```stata
regress y x1 x2 ///
    x3 x4 ///
    x5
```

Pressing Ctrl+Enter on any of these three lines will send all three lines together.

### Keybinding Configuration

**LazyVim / lazy.nvim:** Add to `~/.config/nvim/lua/plugins/stata-send.lua`:

```lua
return {
  {
    "neovim/nvim-lspconfig",
    ft = { "stata" },
    config = function()
      require("stata-send").setup()
    end,
    keys = {
      { "<C-CR>", function() require("stata-send").send("do") end, mode = { "n", "v", "i" }, ft = "stata", desc = "Stata: Do line or selection" },
      { "<S-C-CR>", function() require("stata-send").send_file("do") end, mode = { "n", "v", "i" }, ft = "stata", desc = "Stata: Do file" },
      { "<M-C-CR>", function() require("stata-send").send("include") end, mode = { "n", "v", "i" }, ft = "stata", desc = "Stata: Include line or selection" },
      { "<M-S-C-CR>", function() require("stata-send").send_file("include") end, mode = { "n", "v", "i" }, ft = "stata", desc = "Stata: Include file" },
    },
  },
}
```

**Standard Neovim:** Add to your init.lua:

```lua
require("stata-send").setup()

vim.api.nvim_create_autocmd("FileType", {
  pattern = "stata",
  callback = function()
    local send = require("stata-send")
    vim.keymap.set({ "n", "v", "i" }, "<C-CR>", function() send.send("do") end, { buffer = true, desc = "Stata: Do line or selection" })
    vim.keymap.set({ "n", "v", "i" }, "<S-C-CR>", function() send.send_file("do") end, { buffer = true, desc = "Stata: Do file" })
    vim.keymap.set({ "n", "v", "i" }, "<M-C-CR>", function() send.send("include") end, { buffer = true, desc = "Stata: Include line or selection" })
    vim.keymap.set({ "n", "v", "i" }, "<M-S-C-CR>", function() send.send_file("include") end, { buffer = true, desc = "Stata: Include file" })
  end,
})
```

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Do line or selection | Ctrl+Enter |
| Do file | Shift+Ctrl+Enter |
| Include line or selection | Alt+Ctrl+Enter |
| Include file | Alt+Shift+Ctrl+Enter |

### User Commands

All commands are available via `:Sight<Tab>`:

| Command | Description |
|---------|-------------|
| `:SightDo` | Execute current line or visual selection |
| `:SightDoUpwardLines` | Execute from start of file to current line |
| `:SightDoDownwardLines` | Execute from current line to end of file |
| `:SightDoFile` | Execute entire file |
| `:SightInclude` | Include current line or visual selection |
| `:SightIncludeFile` | Include entire file |
| `:SightCdFile` | Change Stata's working directory to file's directory |
| `:SightCdWorkspace` | Change Stata's working directory to workspace root |

## Troubleshooting

### LSP not starting

- Ensure `sight-language-server` is in your PATH: `which sight-language-server`
- Check `:LspLog` for error messages
- Verify the filetype is detected: `:set filetype?` should show `stata`

### No syntax highlighting

- Run `:TSInstallInfo` and check if `stata` is installed
- Try reinstalling: `:TSInstall! stata`
- Check `:TSModuleInfo` to verify highlight module is enabled

### Parser compilation errors

If the tree-sitter parser fails to compile, ensure you have a C compiler installed:
- macOS: `xcode-select --install`
- Linux: `sudo apt install build-essential` (Debian/Ubuntu)
