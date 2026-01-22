# Neovim Setup for Sight

This guide explains how to configure Neovim to use the Sight language server and tree-sitter grammar for Stata syntax highlighting.

## Prerequisites

- Neovim 0.8+ (for native LSP support)
- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) plugin
- [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter) plugin
- Sight language server installed (see [Installation](#installing-the-language-server))

## Installing the Language Server

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

## LazyVim / lazy.nvim Configuration

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

## Standard Neovim Configuration (without lazy.nvim)

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

## Complete Example Configuration (Standard Neovim)

Here's a complete example combining both LSP and tree-sitter setup for standard Neovim (without lazy.nvim):

```lua
-- Stata filetype detection
vim.filetype.add({
  extension = {
    ["do"] = 'stata',
    ado = 'stata',
    mata = 'stata',
    doh = 'stata',
  },
})

-- Tree-sitter parser configuration
local parser_config = require('nvim-treesitter.parsers').get_parser_configs()
parser_config.stata = {
  install_info = {
    url = 'https://github.com/jbearak/tree-sitter-stata',
    files = { 'src/parser.c', 'src/scanner.c' },
    branch = 'main',
  },
  filetype = 'stata',
}

-- Tree-sitter setup
require('nvim-treesitter.configs').setup({
  highlight = {
    enable = true,
  },
})

-- LSP configuration
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

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

lspconfig.sight.setup({})
```

## Verifying the Setup

1. Open a `.do` file in Neovim
2. Check LSP status with `:LspInfo` - you should see `sight` attached
3. Verify syntax highlighting is working (keywords should be colored)
4. Test features like go-to-definition (`gd`), hover (`K`), and completions

## Send to Stata (macOS)

Neovim can send code to the Stata GUI application using AppleScript. Add the following to your configuration to enable this functionality.

### LazyVim / lazy.nvim Configuration

Add this to your `~/.config/nvim/lua/plugins/stata.lua` file (or create a separate file like `~/.config/nvim/lua/plugins/stata-send.lua`):

```lua
-- Send to Stata configuration for macOS
-- Provides Ctrl+Enter to send current line/selection to Stata

return {
  {
    "neovim/nvim-lspconfig",
    ft = { "stata" },
    config = function()
      -- Register :Sight* user commands
      require("stata-send").setup()
    end,
    keys = {
      -- Ctrl+Enter: Do line or selection
      {
        "<C-CR>",
        function() require("stata-send").send("do") end,
        mode = { "n", "v", "i" },
        ft = "stata",
        desc = "Stata: Do line or selection",
      },
      -- Shift+Ctrl+Enter: Do entire file
      {
        "<S-C-CR>",
        function() require("stata-send").send_file("do") end,
        mode = { "n", "v", "i" },
        ft = "stata",
        desc = "Stata: Do file",
      },
      -- Alt+Ctrl+Enter: Include line or selection
      {
        "<M-C-CR>",
        function() require("stata-send").send("include") end,
        mode = { "n", "v", "i" },
        ft = "stata",
        desc = "Stata: Include line or selection",
      },
      -- Alt+Shift+Ctrl+Enter: Include entire file
      {
        "<M-S-C-CR>",
        function() require("stata-send").send_file("include") end,
        mode = { "n", "v", "i" },
        ft = "stata",
        desc = "Stata: Include file",
      },
    },
  },
}
```

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

-- Get the current line or visual selection
local function get_text()
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    -- Visual mode: get selection
    vim.cmd('normal! "vy')
    return vim.fn.getreg("v")
  else
    -- Normal mode: get current line
    return vim.api.nvim_get_current_line()
  end
end

-- Get lines from start of file to current line
local function get_upward_lines()
  local current_line = vim.fn.line(".")
  local lines = vim.api.nvim_buf_get_lines(0, 0, current_line, false)
  return table.concat(lines, "\n")
end

-- Get lines from current line to end of file
local function get_downward_lines()
  local current_line = vim.fn.line(".") - 1  -- 0-indexed
  local last_line = vim.fn.line("$")
  local lines = vim.api.nvim_buf_get_lines(0, current_line, last_line, false)
  return table.concat(lines, "\n")
end

-- Create a temporary .do file with the given content
local function create_temp_file(content)
  local tmpfile = vim.fn.tempname() .. ".do"
  local file = io.open(tmpfile, "w")
  if file then
    file:write(content)
    file:close()
    return tmpfile
  end
  return nil
end

-- Send line or selection to Stata
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
  vim.cmd("silent! write")

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

  send_raw_command(stata_app, 'cd `"' .. dir .. "\"'")
end

-- Change Stata's working directory to the workspace root
function M.cd_workspace()
  local stata_app = find_stata_app()
  if not stata_app then
    vim.notify("Stata not found in /Applications/Stata/", vim.log.levels.ERROR)
    return
  end

  local dir = vim.fn.getcwd()
  send_raw_command(stata_app, 'cd `"' .. dir .. "\"'")
end

-- Register user commands
function M.setup()
  vim.api.nvim_create_user_command("SightDo", function()
    M.send("do")
  end, { desc = "Sight: Do line or selection" })

  vim.api.nvim_create_user_command("SightDoUpwardLines", function()
    M.send_upward("do")
  end, { desc = "Sight: Do upward lines" })

  vim.api.nvim_create_user_command("SightDoDownwardLines", function()
    M.send_downward("do")
  end, { desc = "Sight: Do downward lines" })

  vim.api.nvim_create_user_command("SightDoFile", function()
    M.send_file("do")
  end, { desc = "Sight: Do file" })

  vim.api.nvim_create_user_command("SightInclude", function()
    M.send("include")
  end, { desc = "Sight: Include line or selection" })

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

### Standard Neovim Configuration (without lazy.nvim)

Add the following to your Neovim configuration after setting up the LSP:

```lua
-- Send to Stata setup (macOS)
-- Register user commands and keybindings
require("stata-send").setup()

vim.api.nvim_create_autocmd("FileType", {
  pattern = "stata",
  callback = function()
    local send = require("stata-send")

    -- Ctrl+Enter: Do line or selection
    vim.keymap.set({ "n", "v", "i" }, "<C-CR>", function() send.send("do") end,
      { buffer = true, desc = "Stata: Do line or selection" })

    -- Shift+Ctrl+Enter: Do entire file
    vim.keymap.set({ "n", "v", "i" }, "<S-C-CR>", function() send.send_file("do") end,
      { buffer = true, desc = "Stata: Do file" })

    -- Alt+Ctrl+Enter: Include line or selection
    vim.keymap.set({ "n", "v", "i" }, "<M-C-CR>", function() send.send("include") end,
      { buffer = true, desc = "Stata: Include line or selection" })

    -- Alt+Shift+Ctrl+Enter: Include entire file
    vim.keymap.set({ "n", "v", "i" }, "<M-S-C-CR>", function() send.send_file("include") end,
      { buffer = true, desc = "Stata: Include file" })
  end,
})
```

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

### Keyboard Shortcuts

| Action | Shortcut | Neovim Key |
|--------|----------|------------|
| Do line or selection | Ctrl+Enter | `<C-CR>` |
| Do file | Shift+Ctrl+Enter | `<S-C-CR>` |
| Include line or selection | Alt+Ctrl+Enter | `<M-C-CR>` |
| Include file | Alt+Shift+Ctrl+Enter | `<M-S-C-CR>` |

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
