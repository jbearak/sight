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

1. Copy [`neovim/sight-lsp-lazyvim.lua`](neovim/sight-lsp-lazyvim.lua) to `~/.config/nvim/lua/plugins/stata.lua`
2. Add the contents of [`neovim/sight-lazyvim-autocmds.lua`](neovim/sight-lazyvim-autocmds.lua) to `~/.config/nvim/lua/config/autocmds.lua`
3. Restart Neovim and run `:TSInstall stata`

### Standard Neovim Configuration (without lazy.nvim)

Copy [`neovim/sight-lsp.lua`](neovim/sight-lsp.lua) to `~/.config/nvim/lua/` or add its contents to your `init.lua`.

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

**Setup:**
1. Copy [`neovim/stata-send.lua`](neovim/stata-send.lua) to `~/.config/nvim/lua/stata-send.lua`
2. Add keybindings (see below)

Multi-line statements using `///` continuation are automatically detected.

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
